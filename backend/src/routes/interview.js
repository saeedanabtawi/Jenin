'use strict';

const express = require('express');
const router = express.Router();

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
router.post('/question', (req, res) => {
  const { question } = req.body || {};
  return res.status(200).json({
    received: question || '(none)',
    reply:
      "You’ve got this. Let’s tackle this question step by step. (Placeholder LLM response until providers are configured)",
  });
});

module.exports = router;
