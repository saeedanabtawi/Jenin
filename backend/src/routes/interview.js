'use strict';

const express = require('express');
const router = express.Router();
const { createSTT } = require('../services/stt');
const { createLLM } = require('../services/llm');
const { createTTS } = require('../services/tts');

// GET /api/v1/interview
router.get('/', (req, res) => {
  res.json({
    service: 'jenin-backend',
    route: '/api/v1/interview',
    endpoints: [
      'GET /api/v1/interview',
      'GET /api/v1/interview/health',
      'POST /api/v1/interview/question'
    ],
  });
});

// simple health for the module
router.get('/health', (req, res) => {
  res.json({ status: 'ok', module: 'interview', timestamp: new Date().toISOString() });
});

// POST /api/v1/interview/question
// This is a placeholder endpoint that will later integrate STT/LLM/TTS services.
router.post('/question', async (req, res) => {
  try {
    const stt = createSTT();
    const llm = createLLM();
    const tts = createTTS();

    const { question, audioBase64, wantTTS } = req.body || {};
    let userText = question || '';

    // If audio is provided, transcribe first
    if (!userText && audioBase64) {
      const audioBuffer = Buffer.from(String(audioBase64), 'base64');
      const sttResult = await stt.transcribeAudio(audioBuffer, { language: process.env.STT_LANGUAGE || 'en' });
      userText = sttResult?.text || '';
    }

    // Fallback if still empty
    if (!userText) {
      userText = '(none)';
    }

    // Generate an answer via LLM
    const prompt = `Interview question: ${userText}`;
    const llmResult = await llm.generateText(prompt, { model: process.env.LLM_MODEL });

    let ttsResult = null;
    if (wantTTS) {
      ttsResult = await tts.synthesizeSpeech(llmResult.text, { voice: process.env.TTS_VOICE });
    }

    return res.status(200).json({
      received: userText,
      reply: llmResult.text,
      providers: {
        stt: stt.name,
        llm: llm.name,
        tts: tts.name,
      },
      tts: ttsResult,
    });
  } catch (err) {
    console.error('Interview error:', err);
    return res.status(500).json({ error: 'Internal error', detail: String(err && err.message || err) });
  }
});

module.exports = router;
