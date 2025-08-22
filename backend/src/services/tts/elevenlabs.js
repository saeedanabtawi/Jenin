'use strict';

// Placeholder ElevenLabs TTS adapter
// TODO: Implement with ElevenLabs API using process.env.TTS_API_KEY and TTS_VOICE

async function synthesizeSpeech(text, options = {}) {
  void text;
  void options;
  return {
    audio: null, // Buffer or URL in a real implementation
    provider: 'elevenlabs',
    note: '(stub) TTS audio would be generated here',
  };
}

module.exports = {
  name: 'elevenlabs',
  synthesizeSpeech,
};
