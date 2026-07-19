const fs = require('fs');
const path = require('path');
const express = require('express');

const ENV_PATH = path.join(__dirname, '..', '.env');

const KEYS = {
  googleTranslateApiKey: 'GOOGLE_TRANSLATE_API_KEY',
  openaiApiKey: 'OPENAI_API_KEY',
  anthropicApiKey: 'ANTHROPIC_API_KEY',
};

function mask(value) {
  if (!value) return null;
  return value.length <= 4 ? '••••' : `••••${value.slice(-4)}`;
}

function setEnvKey(raw, envKey, value) {
  const line = `${envKey}=${value}`;
  const pattern = new RegExp(`^${envKey}=.*$`, 'm');
  if (pattern.test(raw)) {
    return raw.replace(pattern, line);
  }
  return `${raw.trim()}\n${line}\n`;
}

const router = express.Router();

// GET /api/settings: report which keys are configured (masked, never the raw value)
router.get('/', (req, res) => {
  const status = {};
  for (const [field, envKey] of Object.entries(KEYS)) {
    status[field] = { configured: !!process.env[envKey], masked: mask(process.env[envKey]) };
  }
  res.json(status);
});

// POST /api/settings: write provided keys into .env (blank string clears a key)
router.post('/', (req, res) => {
  let raw = fs.existsSync(ENV_PATH) ? fs.readFileSync(ENV_PATH, 'utf-8') : '';

  for (const [field, envKey] of Object.entries(KEYS)) {
    if (!(field in req.body)) continue;
    const value = (req.body[field] || '').trim();
    raw = setEnvKey(raw, envKey, value);
    process.env[envKey] = value;
  }

  fs.writeFileSync(ENV_PATH, raw, 'utf-8');
  res.json({ success: true });
});

module.exports = router;
