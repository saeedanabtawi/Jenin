'use strict';

// Whisper STT adapter (OpenAI REST)
// Requires: process.env.OPENAI_API_KEY

async function transcribeAudio(buffer, options = {}) {
  const apiKey = process.env.OPENAI_API_KEY;
  if (!apiKey) throw new Error('Missing OPENAI_API_KEY for Whisper');

  const model = process.env.STT_MODEL || 'whisper-1';
  const language = options.language || process.env.STT_LANGUAGE || 'en';
  const mimetype = options.mimetype || 'audio/webm';

  const form = new FormData();
  form.append('model', model);
  form.append('language', language);
  form.append('file', new Blob([buffer], { type: mimetype }), 'audio.webm');

  const resp = await fetch('https://api.openai.com/v1/audio/transcriptions', {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${apiKey}`,
    },
    body: form,
  });
  if (!resp.ok) {
    const errText = await resp.text();
    throw new Error(`Whisper STT failed: ${resp.status} ${errText}`);
  }
  const data = await resp.json();
  return {
    text: data.text || '',
    segments: data.segments || [],
    provider: 'whisper',
  };
}

module.exports = {
  name: 'whisper',
  transcribeAudio,
};
