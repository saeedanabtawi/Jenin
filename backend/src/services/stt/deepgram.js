'use strict';

// Deepgram STT adapter
// Requires: process.env.DEEPGRAM_API_KEY (or STT_API_KEY)

const { createClient } = require('@deepgram/sdk');

async function transcribeAudio(buffer, options = {}) {
  const apiKey = process.env.DEEPGRAM_API_KEY || process.env.STT_API_KEY;
  if (!apiKey) throw new Error('Missing DEEPGRAM_API_KEY/STT_API_KEY for Deepgram');
  const dg = createClient(apiKey);

  const mimetype = options.mimetype || 'audio/webm';
  const language = options.language || process.env.STT_LANGUAGE || 'en';

  const { result, error } = await dg.listen.prerecorded.transcribe(
    {
      buffer,
      mimetype,
    },
    {
      model: process.env.DEEPGRAM_MODEL || 'nova-2',
      smart_format: true,
      language,
    }
  );
  if (error) throw new Error(`Deepgram STT failed: ${error.message || String(error)}`);

  const channel = result?.results?.channels?.[0];
  const alt = channel?.alternatives?.[0];
  const text = alt?.transcript || '';
  const segments = alt?.words || [];

  return { text, segments, provider: 'deepgram' };
}

module.exports = {
  name: 'deepgram',
  transcribeAudio,
};
