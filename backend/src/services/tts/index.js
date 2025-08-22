'use strict';

const elevenlabs = require('./elevenlabs');

const PROVIDERS = {
  elevenlabs,
};

function createTTS() {
  const name = (process.env.TTS_PROVIDER || 'elevenlabs').toLowerCase();
  const provider = PROVIDERS[name];
  if (!provider) {
    const available = Object.keys(PROVIDERS).join(', ');
    throw new Error(`Unknown TTS provider: ${name}. Available: ${available}`);
  }
  return provider;
}

module.exports = { createTTS };
