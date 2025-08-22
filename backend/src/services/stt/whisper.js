'use strict';

// Placeholder Whisper STT adapter
// TODO: Implement using OpenAI Whisper API or local Whisper

async function transcribeAudio(buffer, options = {}) {
  void buffer; // placeholder to avoid unused var
  void options;
  return {
    text: '(stub) transcribed text from Whisper',
    segments: [],
    provider: 'whisper',
  };
}

module.exports = {
  name: 'whisper',
  transcribeAudio,
};
