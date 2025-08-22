'use strict';

const openai = require('./openai');
const ollama = require('./ollama');

const PROVIDERS = {
  openai,
  ollama,
};

function createLLM() {
  const name = (process.env.LLM_PROVIDER || 'openai').toLowerCase();
  const provider = PROVIDERS[name];
  if (!provider) {
    const available = Object.keys(PROVIDERS).join(', ');
    throw new Error(`Unknown LLM provider: ${name}. Available: ${available}`);
  }
  return provider;
}

module.exports = { createLLM };
