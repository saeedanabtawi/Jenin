'use strict';

// Placeholder Ollama LLM adapter
// TODO: Implement by calling local Ollama endpoint (default: http://localhost:11434)

async function generateText(prompt, options = {}) {
  void prompt;
  void options;
  return {
    text: '(stub) local model response via Ollama',
    provider: 'ollama',
    usage: {},
  };
}

module.exports = {
  name: 'ollama',
  generateText,
};
