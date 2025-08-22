'use strict';

// OpenAI TTS adapter via REST
// Requires: OPENAI_API_KEY
// Optional envs: TTS_MODEL (default: tts-1), TTS_VOICE (default: alloy), TTS_FORMAT (default: mp3)

async function synthesizeSpeech(text, options = {}) {
  const apiKey = process.env.OPENAI_API_KEY;
  if (!apiKey) throw new Error('Missing OPENAI_API_KEY for OpenAI TTS');

  const model = options.model || process.env.TTS_MODEL || 'tts-1';
  const voice = options.voice || process.env.TTS_VOICE || 'alloy';
  const format = options.format || process.env.TTS_FORMAT || 'mp3'; // mp3 | wav | flac | oga

  const resp = await fetch('https://api.openai.com/v1/audio/speech', {
    method: 'POST',
    headers: {
      'Authorization': `Bearer ${apiKey}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      model,
      input: text,
      voice,
      format,
    }),
  });
  if (!resp.ok) {
    const t = await resp.text();
    throw new Error(`OpenAI TTS failed: ${resp.status} ${t}`);
  }
  const arr = await resp.arrayBuffer();
  const buf = Buffer.from(arr);

  const mime = (
    format === 'wav' ? 'audio/wav'
    : format === 'flac' ? 'audio/flac'
    : format === 'oga' ? 'audio/ogg'
    : 'audio/mpeg'
  );

  return {
    audioBase64: buf.toString('base64'),
    mime,
    provider: 'openai',
  };
}

module.exports = {
  name: 'openai',
  synthesizeSpeech,
};
