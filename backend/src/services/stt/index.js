'use strict';

const whisper = require('./whisper');
const deepgram = require('./deepgram');

const PROVIDERS = {
  whisper,
  deepgram,
};

function createSTT() {
  const name = (process.env.STT_PROVIDER || 'whisper').toLowerCase();
  const provider = PROVIDERS[name];
  if (!provider) {
    const available = Object.keys(PROVIDERS).join(', ');
    throw new Error(`Unknown STT provider: ${name}. Available: ${available}`);
  }
  return provider;
}

module.exports = { createSTT };
