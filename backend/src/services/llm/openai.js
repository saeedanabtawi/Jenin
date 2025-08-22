'use strict';

// Placeholder OpenAI LLM adapter
// TODO: Implement with official OpenAI SDK and process.env.OPENAI_API_KEY

async function generateText(prompt, options = {}) {
  void prompt;
  void options;
  return {
    text: "(stub) You've got this. Let's tackle this question step by step.",
    provider: 'openai',
    usage: {},
  };
}

module.exports = {
  name: 'openai',
  generateText,
};
