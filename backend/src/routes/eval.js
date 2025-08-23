'use strict';

const express = require('express');
const router = express.Router();
const { createSTT } = require('../services/stt');
const { createLLM } = require('../services/llm');
const { createTTS } = require('../services/tts');

// GET /api/v1/eval
router.get('/', (req, res) => {
  res.json({
    service: 'ai-interview-test-tool-backend',
    route: '/api/v1/eval',
    endpoints: [
      'GET /api/v1/eval',
      'POST /api/v1/eval/stt',
      'POST /api/v1/eval/llm',
      'POST /api/v1/eval/tts',
    ],
  });
});

// STT evaluation: transcribe a single audio blob
// body: { audioBase64, mimetype?, language? }
router.post('/stt', async (req, res) => {
  try {
    const { audioBase64, mimetype, language } = req.body || {};
    if (!audioBase64) return res.status(400).json({ error: 'Missing audioBase64' });
    const stt = createSTT();

    const buf = Buffer.from(String(audioBase64), 'base64');
    const result = await stt.transcribeAudio(buf, { mimetype: mimetype || 'audio/webm', language: language || process.env.STT_LANGUAGE || 'en' });

    const provider = stt.name;
    const model = provider === 'whisper'
      ? (process.env.STT_MODEL || 'whisper-1')
      : provider === 'deepgram'
        ? (process.env.DEEPGRAM_MODEL || 'nova-2')
        : '';

    return res.status(200).json({
      provider,
      model,
      text: result?.text || '',
      segments: result?.segments || [],
    });
  } catch (err) {
    console.error('Eval STT error:', err);
    return res.status(500).json({ error: 'Internal error', detail: String(err && err.message || err) });
  }
});

// LLM evaluation: generate text from a prompt
// body: { prompt, model?, temperature?, system? }
router.post('/llm', async (req, res) => {
  try {
    const { prompt, model, temperature, system } = req.body || {};
    if (!prompt) return res.status(400).json({ error: 'Missing prompt' });
    const llm = createLLM();
    const usedModel = model || process.env.LLM_MODEL || 'gpt-4o-mini';
    const out = await llm.generateText(prompt, { model: usedModel, temperature, system });
    return res.status(200).json({ provider: llm.name, model: usedModel, text: out.text, usage: out.usage || {} });
  } catch (err) {
    console.error('Eval LLM error:', err);
    return res.status(500).json({ error: 'Internal error', detail: String(err && err.message || err) });
  }
});

// TTS evaluation: synthesize speech from text
// body: { text, model?, voice?, format? }
router.post('/tts', async (req, res) => {
  try {
    const { text, model, voice, format } = req.body || {};
    if (!text) return res.status(400).json({ error: 'Missing text' });
    const tts = createTTS();
    const usedModel = model || process.env.TTS_MODEL || (tts.name === 'openai' ? 'tts-1' : '');
    const usedVoice = voice || process.env.TTS_VOICE || (tts.name === 'openai' ? 'alloy' : '');

    const out = await tts.synthesizeSpeech(text, { model: usedModel, voice: usedVoice, format });
    return res.status(200).json({ provider: tts.name, model: usedModel, voice: usedVoice, audioBase64: out.audioBase64, mime: out.mime });
  } catch (err) {
    console.error('Eval TTS error:', err);
    return res.status(500).json({ error: 'Internal error', detail: String(err && err.message || err) });
  }
});

module.exports = router;
