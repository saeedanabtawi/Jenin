'use strict';

const express = require('express');
const router = express.Router();
const store = require('../services/store/mongoTranscriptStore');

// GET /api/v1/sessions
router.get('/', async (req, res) => {
  const sessions = await store.listSessions();
  res.json({ sessions });
});

// GET /api/v1/sessions/:id
router.get('/:id', async (req, res) => {
  const rec = await store.getSession(req.params.id);
  if (!rec) return res.status(404).json({ error: 'Not found' });
  res.json(rec);
});

// DELETE /api/v1/sessions/:id - delete a single session
router.delete('/:id', async (req, res) => {
  const ok = await store.deleteSession(req.params.id);
  if (!ok) return res.status(404).json({ error: 'Not found' });
  res.json({ ok: true });
});

// DELETE /api/v1/sessions?max=200 - prune transcripts to max files
router.delete('/', async (req, res) => {
  const max = req.query.max ? Number(req.query.max) : undefined;
  const deleted = await store.prune(max);
  res.json({ ok: true, deleted, max: max ?? Number(process.env.TRANSCRIPTS_MAX_FILES || 500) });
});

module.exports = router;
