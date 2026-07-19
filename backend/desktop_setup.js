const { exec, spawn } = require('child_process');
const fs = require('fs');
const path = require('path');

// APP_SOURCE_DIR: where the bundled app code lives.
// - Dev (not packaged): project root (electron_main.js dir)
// - Production (packaged): inside app.asar (resources/app)
const APP_SOURCE_DIR = path.join(__dirname, '..');

// Ordered highest-to-lowest; each entry's `min` is the minimum driver-reported
// CUDA Version (from `nvidia-smi`'s header) required for that PyTorch CUDA
// wheel build to actually work.
const CUDA_BUILD_TAGS = [
  { tag: 'cu124', min: 12.4 },
  { tag: 'cu121', min: 12.1 },
  { tag: 'cu118', min: 11.8 },
];

const BLACKWELL_BUILD_TAGS = [
  { tag: 'cu128', min: 12.8 },
  { tag: 'cu126', min: 12.6 },
  { tag: 'cu124', min: 12.4 },
];

// torchaudio's compiled native extension (_torchaudio) is tightly ABI-coupled
// to the exact torch version it was built against -- a mismatched pair loads
// but crashes (WinError 127 / missing exported symbols) the moment torchaudio
// touches torch's ops. Leaving the install unpinned lets `uv pip install
// torch torchaudio` resolve them independently, which can land on a
// mismatched pair if the PyTorch wheel index has any timing skew between the
// two packages' latest releases. Pinning both to this single version closes
// that gap; used both to pin the install and to self-heal venvs already stuck
// with a mismatched pair (see verifyVenv).
const EXPECTED_TORCH_VERSION = '2.6.0';

// External processes (spawned uv.exe/python.exe) can't read paths inside the
// app.asar archive — only Electron's own patched fs can do that transparently.
// Files under asarUnpack (backend/**, requirements.txt, assets/ref_audio/**)
// also exist for real on disk under app.asar.unpacked; this rewrites an in-asar
// path to that real path. No-op in dev / outside a packaged app (no 'app.asar'
// substring present in the path).
function toExternalPath(p) {
  return p.replace('app.asar', 'app.asar.unpacked');
}

// Bundled uv binary — replaces the old system-Python/portable-Python/pip
// bootstrapping entirely. `uv venv --managed-python` downloads and pins its own
// CPython 3.12 build, so every customer gets an identical, self-contained
// interpreter instead of whatever (if anything) happens to be on their PATH.
const UV_EXE = toExternalPath(path.join(APP_SOURCE_DIR, 'assets', 'bin', 'uv.exe'));

// A helper to run commands and return promise
function runCmd(cmd, options = {}) {
  return new Promise((resolve) => {
    exec(cmd, options, (error, stdout, stderr) => {
      resolve({
        success: !error,
        stdout: stdout ? stdout.trim() : '',
        stderr: stderr ? stderr.trim() : '',
        error
      });
    });
  });
}

class DesktopSetup {
  constructor(userDataDir, onProgress, onPromptDriver, onLog) {
    this.userDataDir = userDataDir;
    this.venvDir = path.join(userDataDir, '.venv');
    this.pythonExe = process.platform === 'win32'
      ? path.join(this.venvDir, 'Scripts', 'python.exe')
      : path.join(this.venvDir, 'bin', 'python');
    this.onProgress = onProgress || (() => {});
    this.onPromptDriver = onPromptDriver || (() => {});
    // Raw log line callback (terminal-style output for the splash screen's log panel)
    // — separate from onProgress, which only carries a single-line percent+status.
    this.onLog = onLog || (() => {});
  }

  // Main entry point
  async start() {
    this.onProgress(5, "Đang kiểm tra môi trường AI hiện tại...");

    // Fresh log for this setup run -- ensurePythonEnv/installPyTorch/installRequirements
    // each append to it below (flags: 'a'), so clearing once here (instead of each
    // step opening with 'w') is the only place a stale log from a previous run
    // could otherwise linger.
    fs.mkdirSync(this.userDataDir, { recursive: true });
    try {
      fs.writeFileSync(path.join(this.userDataDir, 'install_log.txt'), '');
    } catch (_) { /* best-effort; steps below still work without a log file */ }

    // Check venv validity before initUserData()/the disk-space check below --
    // it depends on neither (just fs.existsSync(this.pythonExe) + an import check).
    const isVenvValid = await this.verifyVenv();

    // Disk space check: only a fresh install (uv downloading a managed Python +
    // torch + all requirements + model weights) needs real headroom. A venv that
    // already passes verifyVenv() only ever needs a small requirements re-sync,
    // so returning users on tight disk space aren't blocked for no reason.
    if (!isVenvValid && !this.checkDiskSpace()) {
      return false;
    }

    // 0. Init userData dirs (copy data/ and assets/ from bundle on first run)
    await this.initUserData();

    // 1. If virtual environment already exists and works, skip straight to
    // requirements re-sync + model check.
    if (isVenvValid) {
      // Venv has all required packages, but requirements.txt itself may have
      // changed since this venv was last set up (e.g. a version bump shipped in
      // an app update) -- re-sync it automatically so users are never stuck on
      // stale packages just because verifyVenv()'s import check still passes.
      const currentHash = this.getRequirementsHash();
      const storedHash = this.getStoredRequirementsHash();
      if (currentHash && currentHash !== storedHash) {
        this.onProgress(75, "Đang cập nhật thư viện...");
        const reqsInstalled = await this.installRequirements();
        if (!reqsInstalled) return false;
      }

      // Venv OK, but still need to check model cache
      this.onProgress(85, "Đang kiểm tra mô hình AI...");
      const modelOk = await this.isModelCached();
      if (!modelOk) {
        // Model not cached yet — download it
        await this.downloadModel();
      }
      const vieneuOk = await this.isVieneuModelCached();
      if (!vieneuOk) {
        await this.downloadVieneuModel();
      }
      this.onProgress(100, "Môi trường AI sẵn sàng!");
      return true;
    }

    // 2. Scan hardware (GPU detection)
    this.onProgress(10, "Đang kiểm tra card đồ họa NVIDIA GPU...");
    const gpuInfo = await this.detectNvidiaGpu();
    
    if (gpuInfo.hasGpu) {
      this.onProgress(15, `Phát hiện GPU: ${gpuInfo.cardName}`);
      const hasDriver = await this.checkNvidiaDriver();
      if (!hasDriver) {
        // Stop here and prompt user to download driver
        const userChoice = await this.promptDriverDownload(gpuInfo.cardName);
        if (userChoice === 'download') {
          this.onProgress(20, "Đang mở trình duyệt để tải Driver NVIDIA...");
          // Open official NVIDIA download site
          const { shell } = require('electron');
          shell.openExternal('https://www.nvidia.com/Download/index.aspx');
          
          this.onProgress(25, "Đợi người dùng cài đặt Driver. Hãy khởi động lại app sau khi hoàn thành.");
          return false; // Exit setup, wait for driver
        } else {
          // User chose to skip and use CPU
          gpuInfo.hasGpu = false;
        }
      }
    } else {
      this.onProgress(15, "Không phát hiện GPU NVIDIA. Hệ thống sẽ tự động cấu hình chạy bằng CPU.");
    }

    // 3. Ensure Python is available (uv-managed venv)
    this.onProgress(20, "Đang chuẩn bị môi trường Python...");
    const pythonReady = await this.ensurePythonEnv();
    if (!pythonReady) {
      this.onProgress(0, "❌ Lỗi: Không thể khởi tạo Python interpreter.");
      return false;
    }

    // 4. Install dependencies (PyTorch CUDA vs CPU)
    if (gpuInfo.hasGpu) {
      this.onProgress(30, "Đang tải và cài đặt thư viện AI (PyTorch GPU - CUDA)...");
      const torchInstalled = await this.installPyTorch(true);
      if (!torchInstalled) return false;
    } else {
      this.onProgress(30, "Đang tải và cài đặt thư viện AI (PyTorch CPU)...");
      const torchInstalled = await this.installPyTorch(false);
      if (!torchInstalled) return false;
    }

    // 5. Install other package requirements
    this.onProgress(70, "Đang cài đặt các thư viện bổ trợ...");
    const reqsInstalled = await this.installRequirements();
    if (!reqsInstalled) return false;

    // 6. Download model weights (if not yet cached)
    this.onProgress(88, "Đang kiểm tra mô hình AI...");
    await this.downloadModel();
    await this.downloadVieneuModel();

    this.onProgress(100, "Thiết lập môi trường AI thành công!");
    return true;
  }

  // Disk space needed for a full fresh install: uv-managed Python (~30MB) + torch
  // (~2-3GB CUDA wheel) + requirements + the OmniVoice/VieNeu model downloads
  // later (~3.5GB combined). 15GB is a safety margin, not a tight estimate --
  // catching "obviously not enough disk" up front beats dying halfway through a
  // multi-gigabyte download with a confusing error.
  checkDiskSpace() {
    const MIN_FREE_BYTES = 15 * 1024 * 1024 * 1024;
    try {
      fs.mkdirSync(this.userDataDir, { recursive: true });
      const stats = fs.statfsSync(this.userDataDir);
      const freeBytes = stats.bsize * stats.bavail;
      if (freeBytes < MIN_FREE_BYTES) {
        const freeGb = (freeBytes / (1024 * 1024 * 1024)).toFixed(1);
        this.onProgress(0, `❌ Lỗi: Cần ít nhất 15GB dung lượng trống để cài đặt, hiện chỉ còn ${freeGb}GB.`);
        return false;
      }
      return true;
    } catch (err) {
      // Can't determine free space (e.g. platform without statfsSync) -- don't
      // block setup over a check we couldn't even perform.
      console.warn('[Setup] Could not check disk space:', err.message);
      return true;
    }
  }

  // Merges shipped/built-in voices with the existing userData voices.json:
  // shipped voices always win (refreshes descriptions/tags/etc. shipped in an
  // app update), while any existing voice whose id ISN'T in the shipped
  // catalog (i.e. the customer's own clones, ids like clone_<slug>_<ts>) is
  // preserved as-is.
  static mergeVoices(shipped, existing) {
    const shippedIds = new Set(shipped.map(v => v.id));
    const userAdded = (existing || []).filter(v => !shippedIds.has(v.id));
    return [...shipped, ...userAdded];
  }

  // Copy bundled data/ and assets/ to userData dir on first run
  async initUserData() {
    const dataDestDir = path.join(this.userDataDir, 'data');
    const assetsDestDir = path.join(this.userDataDir, 'assets');

    // Create required dirs
    fs.mkdirSync(dataDestDir, { recursive: true });
    fs.mkdirSync(path.join(assetsDestDir, 'ref_audio'), { recursive: true });
    fs.mkdirSync(path.join(assetsDestDir, 'samples'), { recursive: true });
    fs.mkdirSync(path.join(this.userDataDir, 'outputs'), { recursive: true });

    // Sync voices.json on EVERY run (not just first run): shipped/built-in
    // voices are always refreshed to the latest bundled version (so metadata
    // fixes like translated descriptions reach existing installs), while the
    // customer's own cloned voices (ids not present in the shipped catalog)
    // are preserved untouched. See mergeVoices().
    const voicesJsonDest = path.join(dataDestDir, 'voices.json');
    const voicesJsonSrc = path.join(APP_SOURCE_DIR, 'backend', 'data', 'voices.json');
    if (fs.existsSync(voicesJsonSrc)) {
      try {
        const shipped = JSON.parse(fs.readFileSync(voicesJsonSrc, 'utf-8'));
        let existing = [];
        try {
          existing = JSON.parse(fs.readFileSync(voicesJsonDest, 'utf-8'));
        } catch (_) {
          existing = []; // missing or corrupt dest file -- proceed with just the shipped voices
        }
        const merged = DesktopSetup.mergeVoices(shipped, existing);
        fs.writeFileSync(voicesJsonDest, JSON.stringify(merged, null, 2), 'utf-8');
        console.log(`[Setup] Synced voices.json (${shipped.length} built-in, ${merged.length - shipped.length} user-added preserved)`);
      } catch (err) {
        // Never let a sync failure block app startup or corrupt/delete the
        // destination file -- leave whatever was already on disk untouched.
        console.warn('[Setup] Could not sync voices.json:', err.message);
      }
    }

    // Copy history.json template if not yet present
    const historyJsonDest = path.join(dataDestDir, 'history.json');
    if (!fs.existsSync(historyJsonDest)) {
      fs.writeFileSync(historyJsonDest, '[]', 'utf-8');
      console.log('[Setup] Initialized history.json in userData');
    }

    // Copy bundled assets/ref_audio and assets/samples to userData/assets (first run)
    // Only copy files not already present (so user data is preserved on app update)
    const copyDirContents = (srcDir, destDir) => {
      if (!fs.existsSync(srcDir)) return;
      const entries = fs.readdirSync(srcDir);
      for (const entry of entries) {
        const srcPath = path.join(srcDir, entry);
        const destPath = path.join(destDir, entry);
        if (!fs.existsSync(destPath)) {
          try {
            fs.copyFileSync(srcPath, destPath);
          } catch (e) {
            console.warn(`[Setup] Could not copy ${entry}:`, e.message);
          }
        }
      }
    };

    const srcRefAudio = path.join(APP_SOURCE_DIR, 'assets', 'ref_audio');
    const srcSamples = path.join(APP_SOURCE_DIR, 'assets', 'samples');
    copyDirContents(srcRefAudio, path.join(assetsDestDir, 'ref_audio'));
    copyDirContents(srcSamples, path.join(assetsDestDir, 'samples'));
  }

  // Verify if venv exists and works
  async verifyVenv() {
    if (!fs.existsSync(this.pythonExe)) return false;

    // Test torch (installed separately from requirements.txt) AND fastapi/soundfile/omnivoice/vieneu
    // (only ever installed via requirements.txt) — checking torch alone let a venv that had
    // requirements.txt fail/skip (e.g. old builds where it wasn't even bundled) report as "valid"
    // forever, since torch install is a separate step that had already succeeded.
    const res = await runCmd(`"${this.pythonExe}" -c "import torch; import torchaudio; import importlib.metadata; importlib.metadata.version('torchcodec'); import fastapi; import soundfile; import omnivoice; import vieneu; print('PyTorch OK'); print('CUDA:', torch.cuda.is_available()); print('TORCH_CUDA_BUILD:', torch.version.cuda is not None); print('TORCH_CUDA_VERSION:', torch.version.cuda); print('TORCH_VERSION:', torch.__version__); print('TORCHAUDIO_VERSION:', torchaudio.__version__)"`);
    if (!res.success || !res.stdout.includes('PyTorch OK')) return false;
    console.log(`Verified working venv. PyTorch CUDA available: ${res.stdout.includes('CUDA: True')}`);

    // The import check above only proves torch *works* -- it doesn't prove the
    // installed build (CUDA vs CPU) still matches what this machine's CURRENT
    // driver supports. A venv seeded before this check existed, or on a machine
    // that has since had a driver downgrade/GPU swap, could pass the import
    // check forever while crashing (WinError 127) the moment inference actually
    // runs. `torch.version.cuda is not None` is a build-time property (True for
    // CUDA wheels, None for CPU wheels) so it's unaffected by whether a working
    // GPU happens to be present right now -- unlike torch.cuda.is_available().
    const isCudaBuild = res.stdout.includes('TORCH_CUDA_BUILD: True');
    // Actual installed CUDA runtime version (e.g. 12.1), not just "has CUDA or not" --
    // a boolean alone would let a `cu124` venv pass as "valid" on a machine whose driver
    // has since dropped to only supporting `cu118`, since both are just "some CUDA build".
    const versionMatch = res.stdout.match(/TORCH_CUDA_VERSION:\s*(\S+)/);
    const installedCudaVersion = versionMatch && versionMatch[1] !== 'None' ? parseFloat(versionMatch[1]) : null;

    const gpuInfo = await this.detectNvidiaGpu();
    const isBlackwell = gpuInfo.hasGpu && /(rtx\s*50)/i.test(gpuInfo.cardName);
    const tags = isBlackwell 
      ? BLACKWELL_BUILD_TAGS
      : CUDA_BUILD_TAGS;
    const expectedTorch = isBlackwell ? '2.7.0' : EXPECTED_TORCH_VERSION;

    let driverCudaVersion = await this.detectCudaCapability();
    // A currently-healthy CUDA venv shouldn't get torn down over one transient
    // nvidia-smi hiccup (GPU waking from sleep, driver mid-reset, permission blip) --
    // this now runs on every launch, not just first install. Only retry in this
    // direction: installed build is CUDA but this check says the driver vanished.
    if (isCudaBuild && driverCudaVersion == null) {
      driverCudaVersion = await this.detectCudaCapability();
    }
    const shouldBeCudaTag = this.pickCudaIndexTag(driverCudaVersion, tags);
    const shouldBeCuda = shouldBeCudaTag != null;

    let mismatch = shouldBeCuda !== isCudaBuild;
    let mismatchReason = `installed build is ${isCudaBuild ? 'CUDA' : 'CPU'}, but current machine should be ${shouldBeCuda ? `CUDA (${shouldBeCudaTag})` : 'CPU'}`;
    if (!mismatch && shouldBeCuda && isCudaBuild) {
      // Both sides say "CUDA" -- but is it the RIGHT CUDA tier for this driver?
      // Each CUDA_BUILD_TAGS entry's `min` is also the exact torch.version.cuda
      // that tag's wheel reports, so compare the installed runtime version against
      // the expected tag's version rather than just "CUDA present: yes/no".
      const expectedTag = tags.find(b => b.tag === shouldBeCudaTag);
      if (expectedTag && (installedCudaVersion == null || installedCudaVersion !== expectedTag.min)) {
        mismatch = true;
        mismatchReason = `installed build is CUDA ${installedCudaVersion ?? 'unknown'}, but current driver should use CUDA (${shouldBeCudaTag} / ${expectedTag.min})`;
      }
    }
    // torch/torchaudio must be an exact matching pair (see EXPECTED_TORCH_VERSION
    // comment) -- a venv installed before the pin was added, or one still holding
    // leftovers from an unpinned index-skew install, could otherwise pass the
    // import check above forever while crashing (WinError 127) the moment
    // torchaudio touches torch's ops. Compare only the base version (before any
    // '+cuXXX'/'+cpu' local-version suffix), since that suffix is expected to
    // vary by machine (CUDA vs CPU build) and isn't part of the pin.
    const torchVersion = (res.stdout.match(/TORCH_VERSION:\s*(\S+)/)?.[1] ?? '').split('+')[0];
    const torchaudioVersion = (res.stdout.match(/TORCHAUDIO_VERSION:\s*(\S+)/)?.[1] ?? '').split('+')[0];
    if (!mismatch && (torchVersion !== expectedTorch || torchaudioVersion !== expectedTorch)) {
      mismatch = true;
      mismatchReason = `installed torch==${torchVersion || 'unknown'} / torchaudio==${torchaudioVersion || 'unknown'}, expected matching pair ${expectedTorch}`;
    }

    if (mismatch) {
      this.onLog(`Venv torch build mismatch: ${mismatchReason} -- reinstalling to self-heal.`);
      return false;
    }

    return true;
  }

  // sha256 of the currently-bundled requirements.txt content — used to detect
  // when a newer app version ships different pinned packages, so we know to
  // re-run pip install without requiring the user to delete anything.
  getRequirementsHash() {
    const crypto = require('crypto');
    const reqsFile = toExternalPath(path.join(APP_SOURCE_DIR, 'requirements.txt'));
    if (!fs.existsSync(reqsFile)) return null;
    const content = fs.readFileSync(reqsFile, 'utf-8');
    return crypto.createHash('sha256').update(content).digest('hex');
  }

  // Marker file stored inside the venv itself recording which requirements.txt
  // hash was last successfully installed there.
  getStoredRequirementsHash() {
    const markerFile = path.join(this.venvDir, '.requirements_hash');
    if (!fs.existsSync(markerFile)) return null;
    try {
      return fs.readFileSync(markerFile, 'utf-8').trim();
    } catch {
      return null;
    }
  }

  saveRequirementsHash(hash) {
    const markerFile = path.join(this.venvDir, '.requirements_hash');
    try {
      fs.writeFileSync(markerFile, hash, 'utf-8');
    } catch (err) {
      console.error('[Setup] Could not write requirements hash marker:', err.message);
    }
  }

  // Check if OmniVoice model weights are already in HuggingFace cache
  async isModelCached() {
    // huggingface_hub caches to ~/.cache/huggingface/hub/models--k2-fsa--OmniVoice
    // We check via Python to follow HF_HOME env if set
    const checkScript = [
      'import os',
      'from pathlib import Path',
      'hf_home = os.environ.get("HF_HOME") or os.path.join(Path.home(), ".cache", "huggingface")',
      'model_dir = os.path.join(hf_home, "hub", "models--k2-fsa--OmniVoice")',
      'has_snapshots = os.path.isdir(os.path.join(model_dir, "snapshots"))',
      'print("CACHED" if has_snapshots else "NOT_CACHED")',
    ].join('; ');
    const res = await runCmd(`"${this.pythonExe}" -c "${checkScript}"`);
    const cached = res.success && res.stdout.includes('CACHED');
    console.log(`[Setup] OmniVoice model cached: ${cached}`);
    return cached;
  }

  // Download OmniVoice model from HuggingFace with progress streaming
  async downloadModel() {
    const modelCached = await this.isModelCached();
    if (modelCached) {
      console.log('[Setup] Model already cached, skipping download.');
      return;
    }

    this.onProgress(88, "📡 Đang tải mô hình AI OmniVoice (~3.3GB) — cần kết nối internet...");

    // Python script: snapshot_download with tqdm progress printed to stdout as JSON lines
    const downloadScript = `
import sys, json
from huggingface_hub import snapshot_download
from huggingface_hub.file_download import hf_hub_download
import os

MODEL_ID = 'k2-fsa/OmniVoice'

try:
    # Use tqdm=False to suppress tqdm, handle progress ourselves
    from tqdm.auto import tqdm as original_tqdm
    import tqdm as tqdm_module

    class ProgressPrinter(tqdm_module.tqdm):
        def update(self, n=1):
            super().update(n)
            if self.total and self.total > 0:
                pct = int(100 * self.n / self.total)
                print(json.dumps({'type': 'progress', 'pct': pct, 'n': self.n, 'total': self.total, 'desc': self.desc or ''}), flush=True)

    tqdm_module.tqdm = ProgressPrinter

    snapshot_download(MODEL_ID, local_dir=None)
    print(json.dumps({'type': 'done'}), flush=True)
except Exception as e:
    print(json.dumps({'type': 'error', 'msg': str(e)}), flush=True)
    sys.exit(1)
`;
    const scriptPath = path.join(this.userDataDir, '_download_model.py');
    fs.writeFileSync(scriptPath, downloadScript, 'utf-8');

    return new Promise((resolve) => {
      const child = spawn(`"${this.pythonExe}" "${scriptPath}"`, { shell: true });

      child.stdout.on('data', (data) => {
        const lines = data.toString().split('\n').filter(Boolean);
        for (const line of lines) {
          try {
            const msg = JSON.parse(line);
            if (msg.type === 'progress') {
              // Map download progress 88% → 97% (leave 97-99% for VieNeu model)
              const mapped = Math.round(88 + (msg.pct / 100) * 9);
              const mb = msg.total > 0 ? `${Math.round(msg.n / 1024 / 1024)}MB / ${Math.round(msg.total / 1024 / 1024)}MB` : '';
              const desc = msg.desc ? `${msg.desc} ` : '';
              this.onProgress(mapped, `📥 Tải mô hình AI: ${desc}${mb} (${msg.pct}%)`);
            } else if (msg.type === 'done') {
              this.onProgress(97, "Mô hình AI OmniVoice đã tải xong!");
            } else if (msg.type === 'error') {
              console.error('[Setup] Model download error:', msg.msg);
              this.onProgress(88, `⚠️ Tải mô hình lỗi: ${msg.msg}`);
            }
          } catch (_) {
            // Non-JSON line, ignore
          }
        }
      });

      child.stderr.on('data', (data) => {
        console.error('[Model Download stderr]', data.toString());
      });

      child.on('close', (code) => {
        try { fs.unlinkSync(scriptPath); } catch (_) {}
        if (code !== 0) {
          console.error('[Setup] Model download process exited with code', code);
        }
        resolve(); // Continue even if download failed (user can retry by restarting app)
      });
    });
  }

  // Check if VieNeu-TTS ONNX model files are already in HuggingFace cache
  async isVieneuModelCached() {
    const checkScript = [
      'import os',
      'from pathlib import Path',
      'hf_home = os.environ.get("HF_HOME") or os.path.join(Path.home(), ".cache", "huggingface")',
      'v3_dir = os.path.join(hf_home, "hub", "models--pnnbao-ump--VieNeu-TTS-v3-Turbo")',
      'codec_dir = os.path.join(hf_home, "hub", "models--OpenMOSS-Team--MOSS-Audio-Tokenizer-Nano-ONNX")',
      'has_v3 = os.path.isdir(os.path.join(v3_dir, "snapshots"))',
      'has_codec = os.path.isdir(os.path.join(codec_dir, "snapshots"))',
      'print("CACHED" if (has_v3 and has_codec) else "NOT_CACHED")',
    ].join('; ');
    const res = await runCmd(`"${this.pythonExe}" -c "${checkScript}"`);
    const cached = res.success && res.stdout.includes('CACHED');
    console.log(`[Setup] VieNeu model cached: ${cached}`);
    return cached;
  }

  // Download VieNeu-TTS ONNX model files (2 HF repos, 11 files) with progress streaming
  async downloadVieneuModel() {
    const modelCached = await this.isVieneuModelCached();
    if (modelCached) {
      console.log('[Setup] VieNeu model already cached, skipping download.');
      return;
    }

    this.onProgress(97, "📡 Đang tải mô hình AI VieNeu-TTS — cần kết nối internet...");

    // Python script: hf_hub_download per file (11 files across 2 repos), progress printed as JSON lines
    const downloadScript = `
import sys, json
from huggingface_hub import hf_hub_download

V3_REPO = 'pnnbao-ump/VieNeu-TTS-v3-Turbo'
CODEC_REPO = 'OpenMOSS-Team/MOSS-Audio-Tokenizer-Nano-ONNX'
FILES = [
    (V3_REPO, 'onnx/vieneu_prefill.onnx'),
    (V3_REPO, 'onnx/vieneu_decode_step.onnx'),
    (V3_REPO, 'onnx/vieneu_acoustic_cached.onnx'),
    (V3_REPO, 'onnx/vieneu_backbone_shared.data'),
    (V3_REPO, 'onnx/vieneu_v3_heads.npz'),
    (V3_REPO, 'config.json'),
    (V3_REPO, 'tokenizer.json'),
    (CODEC_REPO, 'moss_audio_tokenizer_decode_full.onnx'),
    (CODEC_REPO, 'moss_audio_tokenizer_decode_shared.data'),
    (CODEC_REPO, 'moss_audio_tokenizer_encode.onnx'),
    (CODEC_REPO, 'moss_audio_tokenizer_encode.data'),
]

try:
    total = len(FILES)
    for i, (repo, fn) in enumerate(FILES, 1):
        hf_hub_download(repo, fn, repo_type='model')
        pct = int(100 * i / total)
        print(json.dumps({'type': 'progress', 'pct': pct, 'n': i, 'total': total, 'desc': fn}), flush=True)
    print(json.dumps({'type': 'done'}), flush=True)
except Exception as e:
    print(json.dumps({'type': 'error', 'msg': str(e)}), flush=True)
    sys.exit(1)
`;
    const scriptPath = path.join(this.userDataDir, '_download_vieneu_model.py');
    fs.writeFileSync(scriptPath, downloadScript, 'utf-8');

    return new Promise((resolve) => {
      const child = spawn(`"${this.pythonExe}" "${scriptPath}"`, { shell: true });

      child.stdout.on('data', (data) => {
        const lines = data.toString().split('\n').filter(Boolean);
        for (const line of lines) {
          try {
            const msg = JSON.parse(line);
            if (msg.type === 'progress') {
              // Map download progress 97% → 99%
              const mapped = Math.round(97 + (msg.pct / 100) * 2);
              this.onProgress(mapped, `📥 Tải model VieNeu-TTS: ${msg.desc} (${msg.n}/${msg.total})`);
            } else if (msg.type === 'done') {
              this.onProgress(99, "Mô hình AI VieNeu-TTS đã tải xong!");
            } else if (msg.type === 'error') {
              console.error('[Setup] VieNeu model download error:', msg.msg);
              this.onProgress(97, `⚠️ Tải mô hình VieNeu lỗi: ${msg.msg}`);
            }
          } catch (_) {
            // Non-JSON line, ignore
          }
        }
      });

      child.stderr.on('data', (data) => {
        console.error('[VieNeu Model Download stderr]', data.toString());
      });

      child.on('close', (code) => {
        try { fs.unlinkSync(scriptPath); } catch (_) {}
        if (code !== 0) {
          console.error('[Setup] VieNeu model download process exited with code', code);
        }
        resolve(); // Continue even if download failed (user can retry by restarting app)
      });
    });
  }

  // Scan command stdout (one GPU name per line) for an NVIDIA card
  findNvidiaCard(stdout) {
    const lines = stdout.split('\n').map(l => l.trim()).filter(Boolean);
    for (const line of lines) {
      if (/nvidia/i.test(line)) {
        return line;
      }
    }
    return null;
  }

  async detectNvidiaGpu() {
    if (this._cachedGpuInfo) return this._cachedGpuInfo;
    if (process.platform !== 'win32') {
      this._cachedGpuInfo = { hasGpu: false, cardName: '' };
      return this._cachedGpuInfo;
    }

    let info = { hasGpu: false, cardName: '' };
    // Primary: PowerShell Get-CimInstance (wmic is removed on modern Windows)
    const psRes = await runCmd('powershell -NoProfile -Command "Get-CimInstance Win32_VideoController | Select-Object -ExpandProperty Name"');
    if (psRes.success) {
      const cardName = this.findNvidiaCard(psRes.stdout);
      info = cardName ? { hasGpu: true, cardName } : { hasGpu: false, cardName: '' };
    } else {
      // Fallback: wmic (only reached if PowerShell itself failed to run)
      const wmicRes = await runCmd('wmic path win32_VideoController get name');
      if (wmicRes.success) {
        const cardName = this.findNvidiaCard(wmicRes.stdout);
        if (cardName) info = { hasGpu: true, cardName };
      }
    }
    this._cachedGpuInfo = info;
    return info;
  }

  // Check if driver is properly linked (nvidia-smi check)
  async checkNvidiaDriver() {
    const res = await runCmd('nvidia-smi');
    return res.success;
  }

  // Parses the "CUDA Version: X.Y" field nvidia-smi prints in its own header --
  // this is the MAXIMUM CUDA version the currently installed driver supports
  // (drivers are backward-compatible with older CUDA runtime builds, never
  // forward-compatible with newer ones). Newer nvidia-smi builds label this
  // field "CUDA UMD Version:" instead -- match both. Returns a float like
  // 12.8, or null if nvidia-smi isn't available / the field can't be parsed.
  async detectCudaCapability() {
    const res = await runCmd('nvidia-smi');
    if (!res.success) return null;
    const match = res.stdout.match(/CUDA(?: UMD)? Version:\s*([\d.]+)/);
    if (!match) return null;
    return parseFloat(match[1]);
  }

  // Picks the highest PyTorch CUDA wheel build the driver can run, so
  // older-driver customers still get real GPU acceleration instead of being
  // forced to CPU or a build that silently fails to initialize CUDA at runtime.
  pickCudaIndexTag(driverCudaVersion, tags = CUDA_BUILD_TAGS) {
    if (driverCudaVersion == null) return null;
    const match = tags.find(b => driverCudaVersion >= b.min);
    return match ? match.tag : null;
  }

  // Trigger UI prompt for driver download
  promptDriverDownload(cardName) {
    return new Promise((resolve) => {
      this.onPromptDriver(cardName, (action) => {
        resolve(action);
      });
    });
  }

  // Env applied to every uv invocation (venv creation, torch install,
  // requirements install). UV_MANAGED_PYTHON forces uv to only ever use a
  // uv-managed Python build -- it never scans/falls back to system PATH, so
  // every customer gets the exact same interpreter regardless of what (if
  // anything) is installed on their machine. UV_PYTHON_INSTALL_DIR/UV_CACHE_DIR
  // are pinned under userDataDir so both are self-contained and on the same
  // disk as the venv itself (uv hardlinks from cache into the venv instead of
  // copying, which only works within the same drive).
  getUvEnv() {
    return {
      ...process.env,
      UV_MANAGED_PYTHON: '1',
      UV_PYTHON_INSTALL_DIR: path.join(this.userDataDir, 'uv-python'),
      UV_CACHE_DIR: path.join(this.userDataDir, 'uv-cache'),
      UV_NO_PROGRESS: '1',
    };
  }

  // Single spawn implementation shared by every uv command (venv create, torch
  // install, requirements install). uv writes its progress/log output to
  // stderr, not stdout, so both streams are captured and forwarded the same way.
  runUvStreamed(args, { logStream, onLine } = {}) {
    this.onLog(`> uv ${args.join(' ')}`);
    if (logStream) logStream.write(`> uv ${args.join(' ')}\n`);

    return new Promise((resolve) => {
      // Array-form spawn (no shell:true) -- avoids cmd.exe as a middleman and
      // needs no manual quoting for paths with spaces. stdin closed ('ignore')
      // so uv can never block forever waiting on a prompt it will never receive
      // (the same class of hang fixed for the old pip spawn below).
      const child = spawn(UV_EXE, args, { stdio: ['ignore', 'pipe', 'pipe'], env: this.getUvEnv() });

      let buffer = '';
      let settled = false;
      const finish = (result) => {
        if (settled) return;
        settled = true;
        // Flush a trailing partial line (no final newline) so the last thing uv
        // printed before exiting isn't silently dropped.
        if (buffer) {
          if (logStream) logStream.write(`${buffer}\n`);
          this.onLog(buffer);
          if (onLine) onLine(buffer);
          buffer = '';
        }
        resolve(result);
      };

      const handleChunk = (data) => {
        const text = data.toString();
        buffer += text;
        const lines = buffer.split('\n');
        buffer = lines.pop(); // keep last (possibly incomplete) line in buffer

        for (const rawLine of lines) {
          const line = rawLine.replace(/\r$/, '');
          if (!line) continue;
          if (logStream) logStream.write(`${line}\n`);
          this.onLog(line);
          if (onLine) onLine(line);
        }
      };

      // uv writes its progress/log output to stderr, not stdout.
      child.stdout.on('data', handleChunk);
      child.stderr.on('data', handleChunk);

      // Same spawn-error gap fixed for the old pip spawn: without this, a bad
      // uv path (ENOENT/EACCES) throws unhandled on the EventEmitter and can
      // crash the whole Electron main process, or leave this Promise
      // unresolved forever.
      child.on('error', (err) => {
        const msg = `Lỗi khởi chạy uv: ${err.message}`;
        console.error('[uv]', msg);
        this.onLog(msg);
        if (logStream) logStream.write(`${msg}\n`);
        finish(false);
      });

      child.on('close', (code) => {
        this.onLog(`(uv exited with code ${code})`);
        finish(code === 0);
      });
    });
  }

  // Ensure python interpreter is ready: create a uv-managed Python 3.12 venv in
  // userDataDir. uv downloads its own pinned CPython 3.12 build the first time
  // (~30MB) instead of relying on whatever (if anything) is on the system PATH
  // -- every customer ends up with an identical, self-contained interpreter.
  async ensurePythonEnv() {
    // Only reached when verifyVenv() failed, so any existing venv here is
    // broken or a leftover from a previous failed (or older, pip-based) setup
    // attempt -- always start clean.
    if (fs.existsSync(this.venvDir)) {
      fs.rmSync(this.venvDir, { recursive: true, force: true });
    }

    this.onProgress(22, "Đang chuẩn bị Python 3.12 (uv)...");
    const logFilePath = path.join(this.userDataDir, 'install_log.txt');
    const logStream = fs.createWriteStream(logFilePath, { flags: 'a' });
    logStream.on('error', (err) => {
      console.error('[Setup] Could not write install log file:', err.message);
    });

    const args = ['venv', this.venvDir, '--python', '3.12', '--managed-python', '--no-progress'];
    const ok = await this.runUvStreamed(args, { logStream });
    logStream.end();
    return ok;
  }

  // Install PyTorch CUDA vs CPU via uv
  async installPyTorch(isCuda) {
    const gpuInfo = await this.detectNvidiaGpu();
    const isBlackwell = gpuInfo.hasGpu && /(rtx\s*50)/i.test(gpuInfo.cardName);
    const expectedTorch = isBlackwell ? '2.7.0' : EXPECTED_TORCH_VERSION;
    const tags = isBlackwell 
      ? BLACKWELL_BUILD_TAGS
      : CUDA_BUILD_TAGS;

    // Pinned (not bare 'torch'/'torchaudio') so both packages always resolve to
    // the exact matching pair -- see EXPECTED_TORCH_VERSION comment above.
    const args = ['pip', 'install', `torch==${expectedTorch}`, `torchaudio==${expectedTorch}`, '--python', this.pythonExe];
    if (isCuda) {
      const driverCudaVersion = await this.detectCudaCapability();
      const cudaTag = this.pickCudaIndexTag(driverCudaVersion, tags);
      if (cudaTag) {
        args.push('--index-url', `https://download.pytorch.org/whl/${cudaTag}`);
        this.onLog(`Detected driver CUDA capability: ${driverCudaVersion} -> using PyTorch build ${cudaTag}`);
      } else {
        // Driver too old for any supported CUDA build (or capability couldn't be
        // detected) -- fall back to a CPU-only torch install rather than
        // attempting an incompatible CUDA build that would fail or silently
        // never actually use the GPU.
        this.onLog(`Driver CUDA capability ${driverCudaVersion} too old for any supported build -- falling back to CPU torch.`);
        isCuda = false;
      }
    }

    const logFilePath = path.join(this.userDataDir, 'install_log.txt');
    const logStream = fs.createWriteStream(logFilePath, { flags: 'a' });
    logStream.on('error', (err) => {
      console.error('[PyTorch Install] Could not write install log file:', err.message);
    });

    const progressInfo = isCuda ? "PyTorch CUDA" : "PyTorch CPU";
    const ok = await this.runUvStreamed(args, {
      logStream,
      onLine: () => this.onProgress(45, `Đang cài đặt ${progressInfo} (uv)...`),
    });
    logStream.end();
    return ok;
  }

  // Install dependencies in requirements.txt via uv
  async installRequirements() {
    // requirements.txt lives in the app bundle source, not in userData
    const reqsFile = toExternalPath(path.join(APP_SOURCE_DIR, 'requirements.txt'));

    if (!fs.existsSync(reqsFile)) {
      console.log("No requirements.txt found, skipping.");
      return true;
    }

    // Full raw log (every uv output line) — written to userData so there's a
    // real artifact to inspect after the fact, not just whatever scrolled past
    // on the splash screen.
    const logFilePath = path.join(this.userDataDir, 'install_log.txt');
    const logStream = fs.createWriteStream(logFilePath, { flags: 'a' });
    // An unwritable userDataDir (permissions, disk full, AV lock) would otherwise
    // throw an unhandled 'error' on this stream and crash the whole Electron main
    // process — worse than the hang this is meant to help diagnose.
    logStream.on('error', (err) => {
      console.error('[Requirements Install] Could not write install log file:', err.message);
    });

    // uv doesn't print pip-style "Collecting <pkg>" lines to parse a per-package
    // percentage from -- it prints coarse phase summaries instead ("Resolved N
    // packages", "Installed N packages", ...). Rather than a fragile parse, leave
    // the progress %/status to the caller (fresh install: 70%, re-sync: 75%) and
    // let the raw output stream through onLog to the splash screen's log panel,
    // which already shows full detail.
    const args = ['pip', 'install', '-r', reqsFile, '--python', this.pythonExe];
    
    // Add extra-index-url if CUDA is available, so uv can resolve transitive dependencies
    // (like omnivoice's dependency on torch) without downgrading our pre-installed CUDA packages.
    // unsafe-best-match tells uv to consider ALL versions from ALL indexes for every package,
    // not just versions from the first index that happens to contain it. Without this, packages
    // like certifi/urllib3 that exist on both PyPI and the PyTorch wheel index get locked to
    // the (outdated) PyTorch-index version, breaking pinned requirements.
    const gpuInfo = await this.detectNvidiaGpu();
    if (gpuInfo.hasGpu) {
      const isBlackwell = /(rtx\s*50)/i.test(gpuInfo.cardName);
      const driverCudaVersion = await this.detectCudaCapability();
      const tags = isBlackwell ? BLACKWELL_BUILD_TAGS : CUDA_BUILD_TAGS;
      const cudaTag = this.pickCudaIndexTag(driverCudaVersion, tags);
      if (cudaTag) {
        args.push('--extra-index-url', `https://download.pytorch.org/whl/${cudaTag}`);
        args.push('--index-strategy', 'unsafe-best-match');
      }
    }

    const ok = await this.runUvStreamed(args, { logStream });
    if (!ok) {
      logStream.end();
      return false;
    }

    // Install torchcodec with --no-deps to prevent it from ever downgrading
    // or conflicting with the pre-installed torch version (especially on Blackwell).
    // Installed from standard PyPI (since PyTorch wheel index lacks Windows wheels).
    this.onProgress(72, "Đang cấu hình thư viện media...");
    const isBlackwell = gpuInfo.hasGpu && /(rtx\s*50)/i.test(gpuInfo.cardName);
    const expectedCodec = isBlackwell ? 'torchcodec==0.15.0' : 'torchcodec==0.14.0';
    const codecArgs = ['pip', 'install', expectedCodec, '--no-deps', '--python', this.pythonExe];
    const codecOk = await this.runUvStreamed(codecArgs, { logStream });
    logStream.end();

    if (codecOk) {
      this.saveRequirementsHash(this.getRequirementsHash());
    }
    return codecOk;
  }

}

module.exports = DesktopSetup;
