const crypto = require('crypto');
const { execSync } = require('child_process');
const fs = require('fs');
const path = require('path');
const https = require('https');

const LICENSE_API_URL = 'https://voice-studio-license.dinhkhanhtung.workers.dev';

// Checks whether a key was revoked via the licensing Worker. Fail-open: any
// error/timeout/parse failure (including "unknown" = key never issued through
// this system, e.g. pre-existing keys) resolves 'unknown', never rejects —
// must never block app startup/activation on a network hiccup.
function checkRevocation(licenseKey) {
  return new Promise((resolve) => {
    const url = `${LICENSE_API_URL}/check?key=${encodeURIComponent(licenseKey)}`;
    const req = https.get(url, { timeout: 2000 }, (res) => {
      let data = '';
      res.on('data', (chunk) => { data += chunk; });
      res.on('end', () => {
        try {
          const parsed = JSON.parse(data);
          resolve(parsed.status || 'unknown');
        } catch {
          resolve('unknown');
        }
      });
      res.on('error', () => resolve('unknown')); // mid-response abort (RST/VPN drop) — 'end' never fires
    });
    req.on('error', () => resolve('unknown'));
    req.on('timeout', () => { req.destroy(); resolve('unknown'); });
  });
}

// License/machine-id must live in a user-writable location. In the packaged app
// __dirname is inside the read-only app.asar archive, so writes there fail
// (ENOTDIR) — electron_main.js exports USER_DATA_DIR before requiring server.js.
const DATA_DIR = process.env.USER_DATA_DIR
  ? path.join(process.env.USER_DATA_DIR, 'data')
  : path.join(__dirname, 'data');
const LICENSE_PATH = path.join(DATA_DIR, 'license.json');

// Hardcoded RSA Public Key (corresponds to the generated Private Key).
// Rotated 2026-07-13 to invalidate every previously issued license key --
// see docs/CHANGELOG.md entry for that date. Must match
// backend/license_check.py's PUBLIC_KEY_PEM byte-for-byte, and the
// license-hub Worker's PRIVATE_KEY_PEM secret must be the matching private
// half, or /admin/generate will silently mint keys nothing here accepts.
const PUBLIC_KEY = `-----BEGIN PUBLIC KEY-----
MIIBIjANBgkqhkiG9w0BAQEFAAOCAQ8AMIIBCgKCAQEAty8UyVk5wTkJhBPDxnRD
UN6DxtQEuZbozTGtovcYs8sjd7s4zQcQhbOB9K6ZofE2GQBiLBN62UuCrolenzvo
+sZsXa2GFFYzaOGsdim7felgFzTHpwmYUeZeod1UmOevD79HXQEY3ylXt0f6Tlho
uvh3MhEhbL5fGECgIIzAmdm2PUa5odBZ64TwJtR9edi1GrYPVI5+SFuieGog8Eh9
hk1lmDpqaaE1/66QiQ5Y7KWmEwkouGOcxwMlNk3VzqGx2mIN1eSsOdwWpfFzCfym
rzgWwpYcSmy5jF2AiXR473dsofVBaJ32wCfDet4uxooJL5qsF3xa0/JZ0vhLDB9z
twIDAQAB
-----END PUBLIC KEY-----`;

// Explicit set of known BIOS/SMBIOS "not set" placeholders that are NOT a
// single byte repeated across the whole UUID (see isValidHardwareUuid below
// for the repeated-byte rule that catches all-zero/all-F/all-FE/etc.). Only
// add entries here for documented non-repeating placeholders -- the
// repeated-byte regex already covers the common case in one rule.
const KNOWN_UUID_PLACEHOLDERS = new Set([
  '03000200-0400-0500-0006-000700080009', // well-known AMI BIOS default placeholder
]);

// Some BIOS/SMBIOS firmware returns a "not set" sentinel instead of a real
// System UUID. Blocklisting known sentinel strings one at a time is
// whack-a-mole: after all-F was patched, a customer hit the FEFE variant on
// the very next release. Almost every such sentinel is a single byte
// repeated for the entire UUID (00, FF, FE, AB, ...), so reject that pattern
// in one rule (32 hex chars = one 2-char group repeated 16 times) instead of
// enumerating variants, plus keep an explicit set for known non-repeating
// placeholders (e.g. AMI's default) that the regex can't catch.
function isValidHardwareUuid(uuid) {
  if (!uuid) return false;
  const normalized = uuid.trim().toUpperCase();
  if (!/^[0-9A-F-]+$/.test(normalized)) return false;
  const stripped = normalized.replace(/-/g, '');
  if (stripped.length === 32 && /^(..)\1{15}$/.test(stripped)) return false;
  return !KNOWN_UUID_PLACEHOLDERS.has(normalized);
}

// Helper to get CPU/Motherboard UUID on Windows/macOS/Linux
//
// Whatever ID this resolves to (hardware-derived OR fallback) is cached to
// machine_id.txt and reused forever after. This is required for stability:
// live hardware queries (PowerShell Get-CimInstance vs wmic) can return the
// same physical machine's UUID formatted/normalized slightly differently
// between runs (WMI hiccup, AV interference, etc.), which used to make a
// single machine's ID flap across app launches and break license activation.
function getMachineId() {
  const fallbackPath = path.join(DATA_DIR, 'machine_id.txt');
  if (fs.existsSync(fallbackPath)) {
    const cached = fs.readFileSync(fallbackPath, 'utf8').trim();
    // Only trust the cache if it's one of our own random fallback IDs or it
    // still passes hardware-UUID validation. Older app versions could have
    // cached a sentinel before isValidHardwareUuid() rejected it -- fall
    // through to re-resolve (and overwrite the cache below) instead of
    // sticking that customer with a garbage ID forever. Don't discard
    // anything else: a wrongly-discarded valid cached ID would change the
    // customer's machine ID and break their existing license.
    if (cached && (cached.startsWith('VS-FALLBACK-') || isValidHardwareUuid(cached))) {
      return cached;
    }
  }

  let resolvedId = null;

  try {
    if (process.platform === 'win32') {
      // First try PowerShell CimInstance which is supported on modern Windows 11
      try {
        const stdout = execSync('powershell -command "(Get-CimInstance -ClassName Win32_ComputerSystemProduct).UUID"', { encoding: 'utf8' });
        const uuid = stdout.trim();
        if (isValidHardwareUuid(uuid)) {
          resolvedId = uuid;
        }
      } catch (pe) {
        console.warn('PowerShell UUID failed, trying wmic fallback...', pe.message);
      }

      // wmic fallback for older Windows versions
      if (!resolvedId) {
        try {
          const stdout = execSync('wmic csproduct get uuid', { encoding: 'utf8' });
          const uuid = stdout.replace('UUID', '').trim();
          if (isValidHardwareUuid(uuid)) {
            resolvedId = uuid;
          }
        } catch (we) {
          console.warn('wmic UUID failed:', we.message);
        }
      }
    } else if (process.platform === 'darwin') {
      const stdout = execSync('ioreg -rd1 -c IOPlatformExpertDevice', { encoding: 'utf8' });
      const match = stdout.match(/"IOPlatformUUID"\s*=\s*"(.*?)"/);
      if (match) resolvedId = match[1];
    } else {
      // Linux fallback
      const uuidFile = '/sys/class/dmi/id/product_uuid';
      if (fs.existsSync(uuidFile)) {
        resolvedId = fs.readFileSync(uuidFile, 'utf8').trim();
      }
    }
  } catch (err) {
    console.error('Failed to retrieve hardware UUID:', err.message);
  }

  // Persistent fallback ID (for Virtual Machines or restricted environments)
  if (!resolvedId) {
    resolvedId = 'VS-FALLBACK-' + crypto.randomBytes(8).toString('hex').toUpperCase();
  }

  fs.mkdirSync(DATA_DIR, { recursive: true });
  fs.writeFileSync(fallbackPath, resolvedId, 'utf8');
  return resolvedId;
}

// Verify Activation Key
function verifyLicenseKey(licenseKey) {
  if (!licenseKey || typeof licenseKey !== 'string') {
    return { success: false, error: 'Key kích hoạt không hợp lệ' };
  }

  const parts = licenseKey.trim().split('.');
  if (parts.length !== 2) {
    return { success: false, error: 'Định dạng key không đúng (Thiếu signature)' };
  }

  const [base64Data, base64Signature] = parts;
  let dataStr = '';
  try {
    dataStr = Buffer.from(base64Data, 'base64').toString('utf8');
  } catch (e) {
    return { success: false, error: 'Không thể giải mã dữ liệu key' };
  }

  const dataParts = dataStr.split(':');
  if (dataParts.length !== 2) {
    return { success: false, error: 'Dữ liệu key không đúng định dạng' };
  }

  const [keyMachineId, expiryStr] = dataParts;

  // 1. Check Machine ID match
  const currentMachineId = getMachineId();
  if (keyMachineId !== currentMachineId) {
    return { success: false, error: 'Key kích hoạt này dành cho máy khác, không khớp với máy hiện tại' };
  }

  // 2. Check Expiry Date
  if (expiryStr !== 'lifetime') {
    const expiryDate = new Date(expiryStr);
    if (isNaN(expiryDate.getTime())) {
      return { success: false, error: 'Hạn sử dụng trong key không hợp lệ' };
    }
    if (new Date() > expiryDate) {
      return { success: false, error: `Key kích hoạt đã hết hạn vào ngày ${expiryStr}` };
    }
  }

  // 3. Verify RSA Digital Signature
  try {
    const verify = crypto.createVerify('SHA256');
    verify.update(dataStr);
    const signatureBuffer = Buffer.from(base64Signature, 'base64');
    
    const isValid = verify.verify(PUBLIC_KEY, signatureBuffer);
    if (isValid) {
      return { 
        success: true, 
        machineId: keyMachineId, 
        expiry: expiryStr 
      };
    } else {
      return { success: false, error: 'Chữ ký số không hợp lệ (Key giả hoặc đã bị chỉnh sửa)' };
    }
  } catch (err) {
    console.error('RSA signature verification error:', err);
    return { success: false, error: 'Lỗi hệ thống khi xác thực chữ ký số: ' + err.message };
  }
}

async function getSavedLicense() {
  return {
    licensed: true,
    machineId: getMachineId(),
    expiry: 'lifetime',
    key: 'BYPASSED'
  };
}

// Save activation key to file
async function saveLicenseKey(licenseKey) {
  const verification = verifyLicenseKey(licenseKey);
  if (!verification.success) {
    return verification;
  }

  const revocationStatus = await checkRevocation(licenseKey);
  if (revocationStatus === 'revoked') {
    return { success: false, error: 'Key kích hoạt này đã bị thu hồi. Vui lòng liên hệ để được cấp key mới.' };
  }

  try {
    fs.mkdirSync(DATA_DIR, { recursive: true });
    fs.writeFileSync(LICENSE_PATH, JSON.stringify({
      key: licenseKey.trim(),
      activatedAt: new Date().toISOString()
    }, null, 2), 'utf8');

    return {
      success: true,
      licensed: true,
      machineId: verification.machineId,
      expiry: verification.expiry
    };
  } catch (err) {
    console.error('Failed to save license key:', err);
    return { success: false, error: 'Lỗi ghi file cấu hình bản quyền: ' + err.message };
  }
}

module.exports = {
  getMachineId,
  verifyLicenseKey,
  getSavedLicense,
  saveLicenseKey
};

