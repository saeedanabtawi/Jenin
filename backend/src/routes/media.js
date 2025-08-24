'use strict';

const express = require('express');
const router = express.Router();
const storage = require('../services/storage/s3');

// GET /media/recording?key=...&download=1
router.get('/recording', async (req, res) => {
  try {
    if (!storage.enabled()) return res.status(501).json({ error: 'Storage not enabled' });
    const key = String(req.query.key || '').trim();
    if (!key) return res.status(400).json({ error: 'Missing key' });

    const { stream, contentType, contentLength } = await storage.getObjectStream(key);
    if (req.query.download) {
      res.setHeader('Content-Disposition', `attachment; filename="${key.split('/').pop()}"`);
    }
    if (contentType) res.setHeader('Content-Type', contentType);
    if (contentLength) res.setHeader('Content-Length', String(contentLength));

    stream.on('error', (err) => {
      console.error('Media stream error:', err && err.message || err);
      if (!res.headersSent) res.status(500).end('Stream error');
    });
    stream.pipe(res);
  } catch (err) {
    const code = String(err && (err.name || err.Code || err.code) || '').toLowerCase();
    if (code.includes('nosuchkey') || code.includes('notfound') || code.includes('notfound') || code.includes('404')) {
      return res.status(404).json({ error: 'Not found' });
    }
    console.error('Media route error:', err);
    return res.status(500).json({ error: 'Internal error' });
  }
});

module.exports = router;
