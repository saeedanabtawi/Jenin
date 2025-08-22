'use strict';

// Ollama LLM adapter (local)
// Default endpoint: http://localhost:11434

async function generateText(prompt, options = {}) {
  const baseUrl = process.env.OLLAMA_BASE_URL || 'http://localhost:11434';
  const model = options.model || process.env.LLM_MODEL || 'llama3';

  const resp = await fetch(`${baseUrl}/api/generate`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ model, prompt, stream: false }),
  });
  if (!resp.ok) {
    const txt = await resp.text();
    throw new Error(`Ollama request failed: ${resp.status} ${txt}`);
  }
  const data = await resp.json();
  return {
    text: data?.response || '',
    provider: 'ollama',
    usage: {},
  };
}

module.exports = {
  name: 'ollama',
  generateText,
};
