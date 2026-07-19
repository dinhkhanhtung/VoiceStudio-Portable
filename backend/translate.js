const express = require('express');

const LANGUAGES = {
  vi: 'Vietnamese', en: 'English', zh: 'Chinese', ja: 'Japanese',
  ko: 'Korean', fr: 'French', de: 'German', es: 'Spanish', th: 'Thai',
};

function availableProviders() {
  const providers = [];
  if (process.env.GOOGLE_TRANSLATE_API_KEY) providers.push('google');
  if (process.env.OPENAI_API_KEY) providers.push('openai');
  if (process.env.ANTHROPIC_API_KEY) providers.push('anthropic');
  return providers;
}

async function translateGoogle(text, targetCode) {
  const url = `https://translation.googleapis.com/language/translate2?key=${process.env.GOOGLE_TRANSLATE_API_KEY}`;
  const res = await fetch(url, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ q: text, target: targetCode, format: 'text' }),
  });
  const data = await res.json();
  if (!res.ok) throw new Error(data.error?.message || 'Google Translate lỗi');
  return data.data.translations[0].translatedText;
}

async function translateOpenAI(text, targetLangName) {
  const res = await fetch('https://api.openai.com/v1/chat/completions', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'Authorization': `Bearer ${process.env.OPENAI_API_KEY}`,
    },
    body: JSON.stringify({
      model: 'gpt-4o-mini',
      temperature: 0.3,
      messages: [
        { role: 'system', content: `Translate the user's text to ${targetLangName}. Reply with only the translation, nothing else.` },
        { role: 'user', content: text },
      ],
    }),
  });
  const data = await res.json();
  if (!res.ok) throw new Error(data.error?.message || 'OpenAI lỗi');
  return data.choices[0].message.content.trim();
}

async function translateAnthropic(text, targetLangName) {
  const res = await fetch('https://api.anthropic.com/v1/messages', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'x-api-key': process.env.ANTHROPIC_API_KEY,
      'anthropic-version': '2023-06-01',
    },
    body: JSON.stringify({
      model: 'claude-haiku-4-5-20251001',
      max_tokens: 1024,
      system: `Translate the user's text to ${targetLangName}. Reply with only the translation, nothing else.`,
      messages: [{ role: 'user', content: text }],
    }),
  });
  const data = await res.json();
  if (!res.ok) throw new Error(data.error?.message || 'Anthropic lỗi');
  return data.content[0].text.trim();
}

const router = express.Router();

router.get('/providers', (req, res) => {
  res.json({ providers: availableProviders(), languages: LANGUAGES });
});

router.post('/', async (req, res) => {
  const { text, targetLang, provider } = req.body;
  if (!text || !targetLang) {
    return res.status(400).json({ success: false, error: 'Thiếu text hoặc targetLang' });
  }

  const providers = availableProviders();
  const chosen = provider && providers.includes(provider) ? provider : providers[0];
  if (!chosen) {
    return res.status(400).json({ success: false, error: 'Chưa cấu hình key dịch nào trong .env (GOOGLE_TRANSLATE_API_KEY / OPENAI_API_KEY / ANTHROPIC_API_KEY)' });
  }

  const langName = LANGUAGES[targetLang] || targetLang;

  try {
    let translated;
    if (chosen === 'google') translated = await translateGoogle(text, targetLang);
    else if (chosen === 'openai') translated = await translateOpenAI(text, langName);
    else translated = await translateAnthropic(text, langName);

    res.json({ success: true, translated, provider: chosen });
  } catch (err) {
    res.status(500).json({ success: false, error: err.message });
  }
});

module.exports = router;
