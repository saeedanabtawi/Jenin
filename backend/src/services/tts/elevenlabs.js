'use strict';

// ElevenLabs TTS adapter via REST
// Requires: ELEVENLABS_API_KEY or TTS_API_KEY and TTS_VOICE (voice ID)

async function synthesizeSpeech(text, options = {}) {
  const apiKey = process.env.ELEVENLABS_API_KEY || process.env.TTS_API_KEY;
  if (!apiKey) throw new Error('Missing ELEVENLABS_API_KEY/TTS_API_KEY for ElevenLabs');
  const voiceId = options.voice || process.env.TTS_VOICE;
  if (!voiceId) throw new Error('Missing TTS_VOICE (voice ID) for ElevenLabs');

  const model_id = options.model || process.env.TTS_MODEL || 'eleven_monolingual_v1';

  const resp = await fetch(`https://api.elevenlabs.io/v1/text-to-speech/${voiceId}`, {
    method: 'POST',
    headers: {
      'xi-api-key': apiKey,
      'accept': 'audio/mpeg',
      'content-type': 'application/json',
    },
    body: JSON.stringify({
      text,
      model_id,
      voice_settings: {
        stability: 0.5,
        similarity_boost: 0.75,
      },
    }),
  });
  if (!resp.ok) {
    const t = await resp.text();
    throw new Error(`ElevenLabs TTS failed: ${resp.status} ${t}`);
  }
  const arr = await resp.arrayBuffer();
  const buf = Buffer.from(arr);
  return {
    audioBase64: buf.toString('base64'),
    mime: 'audio/mpeg',
    provider: 'elevenlabs',
  };
}

module.exports = {
  name: 'elevenlabs',
  synthesizeSpeech,
};
