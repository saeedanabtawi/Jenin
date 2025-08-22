'use strict';

// Placeholder Deepgram STT adapter
// TODO: Implement using Deepgram SDK/API with process.env.STT_API_KEY or DEEPGRAM_API_KEY

async function transcribeAudio(buffer, options = {}) {
  void buffer;
  void options;
  return {
    text: '(stub) transcribed text from Deepgram',
    segments: [],
    provider: 'deepgram',
  };
}

module.exports = {
  name: 'deepgram',
  transcribeAudio,
};
