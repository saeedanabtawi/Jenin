'use strict';

const express = require('express');
const router = express.Router();
const store = require('../services/store/transcriptStore');

// GET /api/v1/sessions
router.get('/', (req, res) => {
  res.json({ sessions: store.listSessions() });
});

// GET /api/v1/sessions/:id
router.get('/:id', (req, res) => {
  const rec = store.getSession(req.params.id);
  if (!rec) return res.status(404).json({ error: 'Not found' });
  res.json(rec);
});

module.exports = router;
