'use strict';

// Conditional API key auth; enabled only if process.env.API_KEY is set
function requireApiKey(req, res, next) {
  const required = process.env.API_KEY;
  if (!required) return next();

  const headerKey = req.header('x-api-key');
  const auth = req.header('authorization');
  const bearer = auth && auth.toLowerCase().startsWith('bearer ')
    ? auth.slice(7)
    : null;
  // Allow query param for cases where custom headers are not possible (e.g., <audio src>)
  const queryKey = req.query?.apiKey;

  const provided = headerKey || bearer || queryKey;
  if (provided && provided === required) return next();

  return res.status(401).json({ error: 'Unauthorized' });
}

// Socket.IO auth (handshake.auth.apiKey or query.apiKey). Only enforced if API_KEY is set
function socketAuth(socket, next) {
  const required = process.env.API_KEY;
  if (!required) return next();
  try {
    const provided = socket.handshake?.auth?.apiKey
      || socket.handshake?.query?.apiKey
      || socket.handshake?.headers?.['x-api-key']
      || null;
    if (provided && provided === required) return next();
    const err = new Error('Unauthorized');
    err.data = { code: 'UNAUTHORIZED' };
    return next(err);
  } catch (e) {
    return next(e);
  }
}

module.exports = { requireApiKey, socketAuth };
