'use strict';

const express = require('express');
const router = express.Router();
const { createSTT } = require('../services/stt');
const { createLLM } = require('../services/llm');
const { createTTS } = require('../services/tts');
const transcriptStore = require('../services/store/mongoTranscriptStore');
const configStore = require('../services/store/mongoInterviewConfigStore');

// GET /api/v1/interview
router.get('/', (req, res) => {
  res.json({
    service: 'ai-interview-test-tool-backend',
    route: '/api/v1/interview',
    endpoints: [
      'GET /api/v1/interview',
      'GET /api/v1/interview/health',
      'POST /api/v1/interview/question',
      'GET /api/v1/interview/configs',
      'GET /api/v1/interview/configs/:id',
      'POST /api/v1/interview/configs',
      'PUT /api/v1/interview/configs/:id',
      'DELETE /api/v1/interview/configs/:id'
    ],
  });
});

// simple health for the module
router.get('/health', (req, res) => {
  res.json({ status: 'ok', module: 'interview', timestamp: new Date().toISOString() });
});

// Validation helper for interview_config structure
function validateInterviewConfig(cfg) {
  const errors = [];
  if (!cfg || typeof cfg !== 'object') { errors.push('config missing'); return { ok: false, errors }; }
  if (!cfg.config_id || typeof cfg.config_id !== 'string') errors.push('config_id required (string)');
  if (!cfg.name || typeof cfg.name !== 'string') errors.push('name required (string)');
  if (!Array.isArray(cfg.phases_config)) errors.push('phases_config must be an array');
  if (Array.isArray(cfg.phases_config)) {
    cfg.phases_config.forEach((p, i) => {
      if (!p || typeof p !== 'object') { errors.push(`phases_config[${i}] must be object`); return; }
      if (!p.phase_id || typeof p.phase_id !== 'string') errors.push(`phases_config[${i}].phase_id required (string)`);
      if (!p.title || typeof p.title !== 'string') errors.push(`phases_config[${i}].title required (string)`);
      if (typeof p.enabled !== 'boolean') errors.push(`phases_config[${i}].enabled required (boolean)`);
      if (typeof p.order !== 'number') errors.push(`phases_config[${i}].order required (number)`);
      if (typeof p.allocated_minutes !== 'number') errors.push(`phases_config[${i}].allocated_minutes required (number)`);
    });
  }
  return { ok: errors.length === 0, errors };
}

// List configs
router.get('/configs', async (req, res) => {
  try {
    const configs = await configStore.listConfigs();
    res.json({ configs });
  } catch (err) {
    console.error('List configs error:', err);
    res.status(500).json({ error: 'Failed to list configs' });
  }
});

// Get one config
router.get('/configs/:id', async (req, res) => {
  try {
    const id = req.params.id;
    const doc = await configStore.getConfig(id);
    if (!doc) return res.status(404).json({ error: 'Not found' });
    res.json(doc);
  } catch (err) {
    console.error('Get config error:', err);
    res.status(500).json({ error: 'Failed to get config' });
  }
});

// Create/Update config (body can be { interview_config } or the config itself)
router.post('/configs', async (req, res) => {
  try {
    const body = req.body || {};
    const cfg = body.interview_config || body;
    const v = validateInterviewConfig(cfg);
    if (!v.ok) return res.status(400).json({ error: 'Invalid interview_config', errors: v.errors });
    const saved = await configStore.upsertConfig({ interview_config: cfg });
    res.json({ ok: true, config: saved });
  } catch (err) {
    console.error('Upsert config error:', err);
    res.status(500).json({ error: 'Failed to save config' });
  }
});

// Update config by id
router.put('/configs/:id', async (req, res) => {
  try {
    const id = req.params.id;
    const body = req.body || {};
    const cfg = body.interview_config || body;
    if (!cfg.config_id) cfg.config_id = id;
    if (cfg.config_id !== id) return res.status(400).json({ error: 'config_id mismatch with URL param' });
    const v = validateInterviewConfig(cfg);
    if (!v.ok) return res.status(400).json({ error: 'Invalid interview_config', errors: v.errors });
    const saved = await configStore.upsertConfig({ interview_config: cfg });
    res.json({ ok: true, config: saved });
  } catch (err) {
    console.error('Put config error:', err);
    res.status(500).json({ error: 'Failed to save config' });
  }
});

// Delete config by id
router.delete('/configs/:id', async (req, res) => {
  try {
    const id = req.params.id;
    const deleted = await configStore.deleteConfig(id);
    if (!deleted) return res.status(404).json({ error: 'Not found' });
    res.json({ ok: true, deleted: true });
  } catch (err) {
    console.error('Delete config error:', err);
    res.status(500).json({ error: 'Failed to delete config' });
  }
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
