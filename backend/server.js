const path = require('path');
require('dotenv').config({ path: path.join(__dirname, '..', '.env') });

const express = require('express');
const cors = require('cors');
const fs = require('fs');
const crypto = require('crypto');
const { execFile } = require('child_process');
const multer = require('multer');
const translateRouter = require('./translate');
const settingsRouter = require('./settings');
const licenseManager = require('./license_manager');

const app = express();

const DEMO_MODE = process.env.DEMO_MODE === '1';
const APP_AUTH_TOKEN = process.env.APP_AUTH_TOKEN;

async function checkLicense(req, res, next) {
  if (DEMO_MODE) return next();
  const license = await licenseManager.getSavedLicense();
  if (!license.licensed) {
    return res.status(402).json({
      success: false,
      error: 'Ứng dụng chưa được kích hoạt bản quyền hoặc đã hết hạn sử dụng. Vui lòng kích hoạt.',
      machineId: license.machineId
    });
  }
  next();
}
const PORT = process.env.PORT || 8891;

// server.js lives in backend/ — assets, outputs and the frontend build sit one level up at repo root
const ROOT_DIR = path.join(__dirname, '..');

// External processes (spawned pip.exe/python.exe) can't read paths inside the
// app.asar archive — only Electron's own patched fs can do that transparently.
// Files under asarUnpack (backend/**, requirements.txt, assets/ref_audio/**)
// also exist for real on disk under app.asar.unpacked; this rewrites an in-asar
// path to that real path. No-op in dev / outside a packaged app (no 'app.asar'
// substring present in the path).
function toExternalPath(p) {
  return p.replace('app.asar', 'app.asar.unpacked');
}

// USER_DATA_DIR: writable runtime directory.
// - When run from Electron: set by electron_main.js via process.env before require()
//   - Dev mode  → project root (repo dir, same as ROOT_DIR)
//   - Packaged  → app.getPath('userData') e.g. C:\Users\<user>\AppData\Roaming\Voice Studio
// - When run standalone (node backend/server.js): falls back to ROOT_DIR
const USER_DATA_DIR = process.env.USER_DATA_DIR || ROOT_DIR;

// DATA_DIR: voices.json and history.json.
// - Standalone (npm start): data/ lives next to server.js in backend/data/
// - Electron dev / packaged: data/ lives in USER_DATA_DIR/data/ (copied on first run by desktop_setup)
const DATA_DIR = process.env.USER_DATA_DIR
  ? path.join(USER_DATA_DIR, 'data')
  : path.join(__dirname, 'data');

const VOICES_PATH = path.join(DATA_DIR, 'voices.json');
const HISTORY_PATH = path.join(DATA_DIR, 'history.json');
const REF_AUDIO_DIR = path.join(USER_DATA_DIR, 'assets', 'ref_audio');
const OUTPUTS_DIR = path.join(USER_DATA_DIR, 'outputs');

fs.mkdirSync(DATA_DIR, { recursive: true });
fs.mkdirSync(OUTPUTS_DIR, { recursive: true });
fs.mkdirSync(REF_AUDIO_DIR, { recursive: true });

// Resolve a voice's relative refAudio path against USER_DATA_DIR first (cloned voices),
// falling back to ROOT_DIR (built-in bundled voices) — mirrors the /assets static middleware below.
function resolveAssetPath(relPath) {
  const userPath = path.join(USER_DATA_DIR, relPath);
  if (fs.existsSync(userPath)) return userPath;
  return toExternalPath(path.join(ROOT_DIR, relPath));
}


app.use(cors());
app.use(express.json());

// Only this app's own renderer knows APP_AUTH_TOKEN (delivered via IPC, never
// exposed over the network) -- blocks LAN devices or an ngrok tunnel from
// reaching /api/* even though the server binds only 127.0.0.1 (that alone
// doesn't stop ngrok, which tunnels localhost by design). Unset in dev
// (`npm start`, no Electron) and in the Docker demo build (DEMO_MODE) --
// both must keep working unauthenticated, so skip the check when the env
// var was never set rather than treating empty/undefined as a valid token.
app.use('/api', (req, res, next) => {
  if (!APP_AUTH_TOKEN) return next();
  if (req.headers['x-app-token'] !== APP_AUTH_TOKEN) {
    return res.status(403).json({ success: false, error: 'Forbidden' });
  }
  next();
});

// Same APP_AUTH_TOKEN as the /api middleware above, but delivered via query
// string -- <audio src>/<a download>/<img src> are plain browser GETs, không
// gắn header tuỳ chỉnh được như fetch(). Đặt TRƯỚC express.static nên request
// thiếu/sai token bị chặn 403 ngay, không rơi xuống static 404. Cùng cơ chế
// bỏ qua khi APP_AUTH_TOKEN chưa set (dev/Docker DEMO_MODE) như /api.
function checkStaticToken(req, res, next) {
  if (!APP_AUTH_TOKEN) return next();
  if (req.query.token !== APP_AUTH_TOKEN) {
    return res.status(403).json({ success: false, error: 'Forbidden' });
  }
  next();
}
app.use('/outputs', checkStaticToken);
app.use('/assets', checkStaticToken);

app.use('/outputs', express.static(OUTPUTS_DIR));
// Serve assets from both userData (user files) and bundle source (bundled samples)
app.use('/assets', express.static(path.join(USER_DATA_DIR, 'assets')));
app.use('/assets', express.static(path.join(ROOT_DIR, 'assets')));

const upload = multer({ dest: REF_AUDIO_DIR, limits: { fileSize: 20 * 1024 * 1024 } });

app.use('/api/translate', checkLicense, translateRouter);
app.use('/api/settings', settingsRouter);

// --- NOTIFICATIONS SYSTEM ---
let notifications = [
  {
    id: "system-ready",
    title: "Hệ thống sẵn sàng",
    description: "Ứng dụng Voice Studio đã được khởi động hoàn tất.",
    time: new Date().toISOString(),
    unread: true,
    type: "info"
  },
  {
    id: "voices-loaded",
    title: "Đã tải thư viện giọng nói",
    description: "Đã nạp thành công 92 giọng nói mặc định.",
    time: new Date().toISOString(),
    unread: true,
    type: "volume"
  }
];

function addNotification({ title, description, type }) {
  notifications.unshift({
    id: `noti-${Date.now()}-${Math.random().toString(36).substr(2, 9)}`,
    title,
    description,
    time: new Date().toISOString(),
    unread: true,
    type
  });
  if (notifications.length > 50) {
    notifications = notifications.slice(0, 50);
  }
}

// GET /api/notifications
app.get('/api/notifications', (req, res) => {
  res.json(notifications);
});

// POST /api/notifications/read/:id
app.post('/api/notifications/read/:id', (req, res) => {
  const noti = notifications.find(n => n.id === req.params.id);
  if (noti) {
    noti.unread = false;
  }
  res.json({ success: true });
});

// POST /api/notifications/read-all
app.post('/api/notifications/read-all', (req, res) => {
  notifications.forEach(n => n.unread = false);
  res.json({ success: true });
});

function addSynthesizeNoti(result, text, voice) {
  if (result.success) {
    const preview = text.length > 40 ? `${text.slice(0, 40)}...` : text;
    addNotification({
      title: "Sinh âm thanh thành công",
      description: `Đoạn văn bản "${preview}" đã được chuyển thành giọng nói "${voice.name}" thành công.`,
      type: "success"
    });
  } else {
    addNotification({
      title: "Sinh âm thanh thất bại",
      description: `Lỗi khi sinh giọng "${voice.name}": ${result.error || 'Lỗi không xác định'}`,
      type: "info"
    });
  }
}

// --- LICENSE API ---
app.get('/api/license/status', async (req, res) => {
  res.json(await licenseManager.getSavedLicense());
});

app.post('/api/license/activate', async (req, res) => {
  const { licenseKey } = req.body;
  const result = await licenseManager.saveLicenseKey(licenseKey);
  res.json(result);
});

// --- PYTHON RUNTIME SERVER CONFIG ---
const { spawn } = require('child_process');
const http = require('http');

const PYTHON_PORT = 8893;
let pythonServerProcess = null;

// Python exe lives in the userData venv (writable, persistent across app updates) on desktop.
// Falls back to the system 'python3' when no venv exists (e.g. Docker/Linux containers).
function resolvePythonPath() {
  const venvPython = path.join(USER_DATA_DIR, '.venv', 'Scripts', 'python.exe');
  return fs.existsSync(venvPython) ? venvPython : 'python3';
}

function startPythonServer() {
  const pythonPath = resolvePythonPath();
  const serverScriptPath = toExternalPath(path.join(__dirname, 'tts_server.py'));

  console.log(`🚀 Starting Python TTS server at port ${PYTHON_PORT}...`);
  console.log(`   Python: ${pythonPath}`);
  
  pythonServerProcess = spawn(pythonPath, [serverScriptPath, PYTHON_PORT.toString()], {
    cwd: USER_DATA_DIR,
    stdio: ['ignore', 'inherit', 'inherit']
  });
  
  pythonServerProcess.on('close', (code) => {
    console.log(`Python server process exited with code ${code}`);
    pythonServerProcess = null;
  });
  
  pythonServerProcess.on('error', (err) => {
    console.error('Failed to start Python server process:', err);
  });
}

function killPythonServer() {
  if (pythonServerProcess) {
    console.log('Stopping Python TTS server...');
    pythonServerProcess.kill();
    pythonServerProcess = null;
  }
}

// Start Python server
startPythonServer();

// Cleanup python server process on Node exit
process.on('exit', killPythonServer);
process.on('SIGINT', () => {
  killPythonServer();
  process.exit(0);
});
process.on('SIGTERM', () => {
  killPythonServer();
  process.exit(0);
});
process.on('uncaughtException', (err) => {
  console.error('Uncaught Exception:', err);
  killPythonServer();
  process.exit(1);
});

function readJson(filePath, fallback) {
  try {
    return JSON.parse(fs.readFileSync(filePath, 'utf-8'));
  } catch (err) {
    return fallback;
  }
}

function writeJson(filePath, data) {
  fs.writeFileSync(filePath, JSON.stringify(data, null, 2), 'utf-8');
}

function getVoices() {
  const fileVoices = readJson(VOICES_PATH, []);
  return fileVoices;
}

function slugify(name) {
  return name
    .normalize('NFD').replace(/[̀-ͯ]/g, '')
    .toLowerCase().trim()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/(^-|-$)/g, '') || 'giong-noi';
}

// GET /api/voices: list built-in + cloned voices
app.get('/api/voices', (req, res) => {
  res.json(getVoices());
});

// POST /api/voices/clone: upload a reference audio sample to create a cloned voice
app.post('/api/voices/clone', upload.single('audioFile'), (req, res) => {
  const { name, refText } = req.body;

  if (!name || !req.file) {
    if (req.file) fs.unlink(req.file.path, () => {});
    return res.status(400).json({ success: false, error: 'Thiếu tên giọng hoặc file audio mẫu' });
  }

  const id = `clone_${slugify(name)}_${Date.now()}`;
  const ext = path.extname(req.file.originalname) || '.wav';
  const storedFilename = `${id}${ext}`;
  const storedPath = path.join(REF_AUDIO_DIR, storedFilename);
  fs.renameSync(req.file.path, storedPath);

  const voice = {
    id,
    name,
    type: 'cloned',
    gender: '',
    description: 'Giọng do bạn tự tạo',
    refAudio: `assets/ref_audio/${storedFilename}`,
    refText: refText || null,
    tags: ['cua_ban'],
    sampleUrl: `/assets/ref_audio/${storedFilename}`,
    createdAt: new Date().toISOString()
  };

  const voices = getVoices();
  voices.push(voice);
  writeJson(VOICES_PATH, voices);

  addNotification({
    title: "Clone giọng thành công",
    description: `Đã tạo thành công giọng nói "${name}" của bạn.`,
    type: "volume"
  });

  res.json({ success: true, voice });
});

// DELETE /api/voices/:id: remove a cloned voice (built-in presets cannot be deleted)
app.delete('/api/voices/:id', (req, res) => {
  const voices = getVoices();
  const voice = voices.find(v => v.id === req.params.id);

  if (!voice) {
    return res.status(404).json({ success: false, error: 'Không tìm thấy giọng nói' });
  }
  if (voice.type !== 'cloned') {
    return res.status(400).json({ success: false, error: 'Không thể xoá giọng có sẵn' });
  }

  const filePath = resolveAssetPath(voice.refAudio);
  fs.unlink(filePath, () => {});

  writeJson(VOICES_PATH, voices.filter(v => v.id !== req.params.id));
  res.json({ success: true });
});

// GET /api/history: recent generations, newest first
app.get('/api/history', (req, res) => {
  const history = readJson(HISTORY_PATH, []);
  res.json([...history].reverse());
});

// DELETE /api/history/:id: remove a single history entry (audio file best-effort)
app.delete('/api/history/:id', (req, res) => {
  const history = readJson(HISTORY_PATH, []);
  const entry = history.find(h => h.id === req.params.id);

  if (!entry) {
    return res.status(404).json({ success: false, error: 'Không tìm thấy lịch sử' });
  }
  if (entry.audioUrl) {
    fs.unlink(path.join(USER_DATA_DIR, entry.audioUrl), () => {});
  }

  writeJson(HISTORY_PATH, history.filter(h => h.id !== req.params.id));
  res.json({ success: true });
});

// DELETE /api/history: clear all history entries (audio files best-effort)
app.delete('/api/history', (req, res) => {
  const history = readJson(HISTORY_PATH, []);
  for (const entry of history) {
    if (entry.audioUrl) {
      fs.unlink(path.join(USER_DATA_DIR, entry.audioUrl), () => {});
    }
  }

  writeJson(HISTORY_PATH, []);
  res.json({ success: true });
});

function saveHistory(result, text, voice) {
  const history = readJson(HISTORY_PATH, []);
  history.push({
    id: crypto.randomUUID(),
    voiceId: voice.id,
    voiceName: voice.name,
    text,
    textPreview: text.length > 120 ? `${text.slice(0, 120)}…` : text,
    audioUrl: `/${result.audio_path}`,
    stats: result.stats,
    createdAt: new Date().toISOString()
  });
  writeJson(HISTORY_PATH, history);
}

function handleSynthesizeResult(stdout, res, text, voice) {
  let result;
  try {
    result = JSON.parse(stdout);
  } catch (parseError) {
    console.error(`JSON Parse error: ${parseError}`);
    console.error(`Raw Stdout: ${stdout}`);
    return res.status(500).json({
      success: false,
      error: 'Lỗi parse JSON đầu ra của Python',
      rawOutput: stdout
    });
  }

  if (!result.success && /torchcodec|libtorchcodec/i.test(result.error || '')) {
    result.error = 'Giọng này chưa có "Nội dung audio mẫu" (ref text) nên hệ thống cần tự động phiên âm, nhưng máy đang thiếu FFmpeg cho việc đó. Hãy xoá và tạo lại giọng clone kèm nội dung audio mẫu.';
  }

  addSynthesizeNoti(result, text, voice);

  if (result.success) {
    saveHistory(result, text, voice);
    result.audioUrl = `/${result.audio_path}`;
  }

  res.json(result);
}

// GET /api/progress: check synthesis progress
app.get('/api/progress', (req, res) => {
  const progressFile = path.join(OUTPUTS_DIR, 'progress.json');
  try {
    if (fs.existsSync(progressFile)) {
      const data = JSON.parse(fs.readFileSync(progressFile, 'utf-8'));
      res.json(data);
    } else {
      res.json({ status: "idle", current: 0, total: 0 });
    }
  } catch (err) {
    res.json({ status: "idle", current: 0, total: 0 });
  }
});

// POST /api/synthesize: run OmniVoice via background HTTP server (with CLI fallback)
app.post('/api/synthesize', checkLicense, (req, res) => {
  const { voiceId, text, speed, pauseMs, engine } = req.body;

  if (!voiceId || !text) {
    return res.status(400).json({ success: false, error: 'Thiếu tham số bắt buộc (voiceId, text)' });
  }

  if (DEMO_MODE && text.length > 500) {
    return res.status(400).json({ success: false, error: 'Bản demo giới hạn 500 ký tự. Tải app đầy đủ để không giới hạn.' });
  }

  const voice = getVoices().find(v => v.id === voiceId);
  if (!voice) {
    return res.status(404).json({ success: false, error: 'Không tìm thấy giọng nói' });
  }

  // Prepare payload for Python Server
  const payload = {
    text,
    speed: speed || 1.0,
    voice_id: voice.id,
    pause_ms: pauseMs || 0,
    engine: engine || 'omnivoice'
  };

  if (voice.refAudio) {
    payload.ref_audio = resolveAssetPath(voice.refAudio);
    if (voice.refText) payload.ref_text = voice.refText;
  } else {
    payload.instruct = voice.instruct;
  }

  // Fallback function to run CLI
  function fallbackToCli() {
    console.log('⚠️ Falling back to Python CLI...');
    const pythonPath = resolvePythonPath();
    const cliScriptPath = toExternalPath(path.join(__dirname, 'tts_cli.py'));

    const args = [
      cliScriptPath,
      '--text', text,
      '--speed', (speed || 1.0).toString(),
      '--voice-id', voice.id,
      '--pause-ms', (pauseMs || 0).toString()
    ];

    if (voice.refAudio) {
      args.push('--ref-audio', resolveAssetPath(voice.refAudio));
      if (voice.refText) args.push('--ref-text', voice.refText);
    } else {
      args.push('--instruct', voice.instruct);
    }
    args.push('--engine', payload.engine);

    console.log(`Executing CLI fallback: ${pythonPath} ${args.join(' ')}`);

    execFile(pythonPath, args, { maxBuffer: 1024 * 1024 * 10, timeout: 300000, cwd: USER_DATA_DIR }, (error, stdout, stderr) => {
      if (error) {
        console.error(`Exec error: ${error}`);
        console.error(`Stderr: ${stderr}`);
        addNotification({
          title: "Sinh âm thanh thất bại",
          description: `Lỗi hệ thống khi gọi Python CLI: ${error.message}`,
          type: "info"
        });
        return res.status(500).json({
          success: false,
          error: 'Lỗi hệ thống khi gọi Python CLI',
          details: error.message,
          stderr
        });
      }
      handleSynthesizeResult(stdout, res, text, voice);
    });
  }

  // Send request to Python server
  const reqPost = http.request({
    hostname: '127.0.0.1',
    port: PYTHON_PORT,
    path: '/synthesize',
    method: 'POST',
    headers: {
      'Content-Type': 'application/json'
    }
  }, (response) => {
    let data = '';
    response.on('data', (chunk) => { data += chunk; });
    response.on('end', () => {
      if (response.statusCode === 200) {
        try {
          const result = JSON.parse(data);
          if (result.success) {
            addSynthesizeNoti(result, text, voice);
            saveHistory(result, text, voice);
            result.audioUrl = `/${result.audio_path}`;
            return res.json(result);
          } else {
            console.error('Python server error details:', result.error);
            if (!result.success && /torchcodec|libtorchcodec/i.test(result.error || '')) {
              result.error = 'Giọng này chưa có "Nội dung audio mẫu" (ref text) nên hệ thống cần tự động phiên âm, nhưng máy đang thiếu FFmpeg cho việc đó. Hãy xoá và tạo lại giọng clone kèm nội dung audio mẫu.';
            }
            addSynthesizeNoti(result, text, voice);
            return res.status(500).json(result);
          }
        } catch (e) {
          console.error('Error parsing Python server response:', e);
          fallbackToCli();
        }
      } else {
        console.error(`Python server returned status ${response.statusCode}`);
        fallbackToCli();
      }
    });
  });

  reqPost.on('error', (e) => {
    console.error('Failed to connect to Python server:', e.message);
    fallbackToCli();
  });

  reqPost.write(JSON.stringify(payload));
  reqPost.end();
});

// GET /docs: standalone API reference page
app.get('/docs', (req, res) => {
  const endpoints = [
    { method: 'GET', path: '/api/voices', desc: 'Danh sách 92 giọng' },
    { method: 'POST', path: '/api/voices/clone', desc: 'multipart: name, audioFile, refText?' },
    { method: 'DELETE', path: '/api/voices/:id', desc: 'Xoá 1 giọng' },
    { method: 'POST', path: '/api/synthesize', desc: 'JSON: voiceId, text, speed?, pauseMs?' },
    { method: 'GET', path: '/api/history', desc: 'Lịch sử đọc, mới nhất trước' },
    { method: 'DELETE', path: '/api/history/:id', desc: 'Xoá 1 mục lịch sử (kèm file audio)' },
    { method: 'DELETE', path: '/api/history', desc: 'Xoá toàn bộ lịch sử' },
    { method: 'GET', path: '/api/progress', desc: 'Trạng thái tiến trình đang xử lý' },
    { method: 'GET', path: '/api/translate/providers', desc: 'Provider đang có key + danh sách ngôn ngữ' },
    { method: 'POST', path: '/api/translate', desc: 'JSON: text, targetLang, provider?' },
    { method: 'GET', path: '/api/settings', desc: 'Trạng thái từng key dịch (masked)' },
    { method: 'POST', path: '/api/settings', desc: 'Ghi key vào .env, áp dụng ngay' },
    { method: 'GET', path: '/api/notifications', desc: 'Danh sách thông báo hệ thống' },
    { method: 'POST', path: '/api/notifications/read/:id', desc: 'Đánh dấu đã đọc' },
    { method: 'POST', path: '/api/notifications/read-all', desc: 'Đánh dấu tất cả đã đọc' },
    { method: 'GET', path: '/api/license/status', desc: 'Trạng thái bản quyền' },
    { method: 'POST', path: '/api/license/activate', desc: 'Kích hoạt key bản quyền' },
  ];

  const methodColor = { GET: '#34d399', POST: '#818cf8', DELETE: '#fb7185' };
  const rows = endpoints.map(e => `
    <tr>
      <td><span class="method" style="background:${methodColor[e.method] || '#94a3b8'}22;color:${methodColor[e.method] || '#94a3b8'}">${e.method}</span></td>
      <td><code>${e.path}</code></td>
      <td>${e.desc}</td>
    </tr>`).join('');

  res.send(`<!DOCTYPE html>
<html lang="vi">
<head>
<meta charset="UTF-8">
<title>Voice Studio — API Reference</title>
<style>
  body { margin: 0; padding: 40px 24px; background: #0f172a; color: #e2e8f0; font-family: -apple-system, "Segoe UI", Roboto, sans-serif; }
  .wrap { max-width: 860px; margin: 0 auto; }
  h1 { font-size: 24px; margin-bottom: 4px; }
  p.subtitle { color: #94a3b8; margin-top: 0; margin-bottom: 28px; }
  table { width: 100%; border-collapse: collapse; background: #1e293b; border-radius: 12px; overflow: hidden; }
  th, td { text-align: left; padding: 12px 16px; border-bottom: 1px solid #334155; font-size: 14px; }
  th { color: #94a3b8; font-weight: 600; font-size: 12px; text-transform: uppercase; letter-spacing: 0.05em; }
  tr:last-child td { border-bottom: none; }
  code { font-family: "Cascadia Code", Consolas, monospace; color: #e2e8f0; }
  .method { display: inline-block; padding: 2px 8px; border-radius: 6px; font-size: 12px; font-weight: 700; }
</style>
</head>
<body>
  <div class="wrap">
    <h1>Voice Studio — API Reference</h1>
    <p class="subtitle">Danh sách các endpoint hiện có của backend Voice Studio.</p>
    <table>
      <thead><tr><th>Method</th><th>Endpoint</th><th>Mô tả</th></tr></thead>
      <tbody>${rows}</tbody>
    </table>
  </div>
</body>
</html>`);
});

// Serve the built frontend (production) — see frontend/ for the Vite dev app
const frontendDist = path.join(ROOT_DIR, 'frontend', 'dist');
if (fs.existsSync(frontendDist)) {
  app.use(express.static(frontendDist));
  app.get('*', (req, res) => {
    res.sendFile(path.join(frontendDist, 'index.html'));
  });
}

// Bind to loopback only -- app.listen(PORT) with no host defaults to all
// interfaces, meaning anyone else on the customer's LAN (same wifi) could
// reach /api/synthesize just by knowing their local IP, no tunnel needed.
app.listen(PORT, '127.0.0.1', () => {
  console.log(`==================================================`);
  console.log(`🚀 OmniVoice API server running on port ${PORT}`);
  console.log(`👉 http://localhost:${PORT}`);
  console.log(`==================================================`);
});
