'use strict';

const elevenlabs = require('./elevenlabs');
const openai = require('./openai');

const PROVIDERS = {
  elevenlabs,
  openai,
};

function createTTS() {
  const name = (process.env.TTS_PROVIDER || 'openai').toLowerCase();
  const provider = PROVIDERS[name];
  if (!provider) {
    const available = Object.keys(PROVIDERS).join(', ');
    throw new Error(`Unknown TTS provider: ${name}. Available: ${available}`);
  }
  return provider;
}

module.exports = { createTTS };
