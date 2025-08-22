'use strict';

const express = require('express');
const router = express.Router();
const { createSTT } = require('../services/stt');
const { createLLM } = require('../services/llm');
const { createTTS } = require('../services/tts');
const transcriptStore = require('../services/store/mongoTranscriptStore');

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
    const sessionId = req.header('x-session-id') || req.query.sessionId || null;
    if (sessionId) await transcriptStore.startSession(sessionId);
    let userText = question || '';

    // If audio is provided, transcribe first
    if (!userText && audioBase64) {
      const audioBuffer = Buffer.from(String(audioBase64), 'base64');
      const sttResult = await stt.transcribeAudio(audioBuffer, { language: process.env.STT_LANGUAGE || 'en' });
      userText = sttResult?.text || '';
      if (sessionId) await transcriptStore.addEvent(sessionId, { type: 'stt_single', text: userText, provider: stt.name });
    }

    // Fallback if still empty
    if (!userText) {
      userText = '(none)';
    }

    // Generate an answer via LLM
    const prompt = `Interview question: ${userText}`;
    const llmResult = await llm.generateText(prompt, { model: process.env.LLM_MODEL });
    if (sessionId) {
      await transcriptStore.addEvent(sessionId, { type: 'question', text: userText, wantTTS: !!wantTTS });
      await transcriptStore.addEvent(sessionId, { type: 'llm_reply', text: llmResult.text, provider: llm.name });
    }

    let ttsResult = null;
    if (wantTTS) {
      ttsResult = await tts.synthesizeSpeech(llmResult.text, { voice: process.env.TTS_VOICE });
      if (sessionId && ttsResult?.audioBase64) {
        await transcriptStore.addEvent(sessionId, { type: 'tts', provider: tts.name, bytes: Buffer.byteLength(ttsResult.audioBase64, 'base64') });
      }
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
    const sessionId = req.header('x-session-id') || req.query.sessionId || null;
    if (sessionId) await transcriptStore.addEvent(sessionId, { type: 'error', stage: 'rest_interview', error: String(err && err.message || err) });
    return res.status(500).json({ error: 'Internal error', detail: String(err && err.message || err) });
  }
});

module.exports = router;
