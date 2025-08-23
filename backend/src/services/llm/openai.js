'use strict';

// OpenAI LLM adapter
// Requires: process.env.OPENAI_API_KEY

const OpenAI = require('openai');

async function generateText(prompt, options = {}) {
  const apiKey = process.env.OPENAI_API_KEY;
  if (!apiKey) throw new Error('Missing OPENAI_API_KEY for OpenAI LLM');
  const client = new OpenAI({ apiKey });

  const model = options.model || process.env.LLM_MODEL || 'gpt-4o-mini';
  const system = options.system || 'You are an AI interview coach: confident, motivational, structured, empowering, calm, authoritative yet approachable.';

  const resp = await client.chat.completions.create({
    model,
    messages: [
      { role: 'system', content: system },
      { role: 'user', content: prompt },
    ],
    temperature: 1,
  });

  const choice = resp.choices?.[0]?.message?.content || '';
  return {
    text: choice,
    provider: 'openai',
    usage: resp.usage || {},
  };
}

module.exports = {
  name: 'openai',
  generateText,
};
