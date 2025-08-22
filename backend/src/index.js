'use strict';

const express = require('express');
const cors = require('cors');
const dotenv = require('dotenv');
const http = require('http');
const { Server } = require('socket.io');
const interviewRouter = require('./routes/interview');
const { createSTT } = require('./services/stt');
const { createLLM } = require('./services/llm');
const { createTTS } = require('./services/tts');
const morgan = require('morgan');
const rateLimit = require('express-rate-limit');
const { requireApiKey, socketAuth } = require('./middleware/auth');
const sessionsRouter = require('./routes/sessions');
const transcriptStore = require('./services/store/transcriptStore');

dotenv.config();

const app = express();
const server = http.createServer(app);
const io = new Server(server, {
  cors: {
    origin: '*',
    methods: ['GET', 'POST'],
  },
});
io.use(socketAuth);

app.use(cors());
app.use(morgan('combined'));
app.use(express.json());
// Apply rate limiting to /api/* only
const apiLimiter = rateLimit({ windowMs: 60 * 1000, max: 60, standardHeaders: true, legacyHeaders: false });
app.use('/api', apiLimiter, requireApiKey);

// API routes
app.use('/api/v1/interview', interviewRouter);
app.use('/api/v1/sessions', sessionsRouter);

// Health route
app.get('/health', (req, res) => {
  res.status(200).json({
    status: 'ok',
    service: 'jenin-backend',
    timestamp: new Date().toISOString(),
  });
});

// Provider health route (lightweight checks)
app.get('/health/providers', async (req, res) => {
  const sttProvider = process.env.STT_PROVIDER || 'whisper';
  const llmProvider = process.env.LLM_PROVIDER || 'openai';
  const ttsProvider = process.env.TTS_PROVIDER || 'elevenlabs';

  const status = {
    stt: {
      provider: sttProvider,
      configured: sttProvider === 'whisper'
        ? Boolean(process.env.OPENAI_API_KEY)
        : sttProvider === 'deepgram'
          ? Boolean(process.env.DEEPGRAM_API_KEY || process.env.STT_API_KEY)
          : false,
    },
    llm: {
      provider: llmProvider,
      configured: llmProvider === 'openai'
        ? Boolean(process.env.OPENAI_API_KEY)
        : llmProvider === 'ollama'
          ? true
          : false,
    },
    tts: {
      provider: ttsProvider,
      configured: ttsProvider === 'elevenlabs'
        ? Boolean((process.env.ELEVENLABS_API_KEY || process.env.TTS_API_KEY) && process.env.TTS_VOICE)
        : false,
    },
  };
  res.json({ status: 'ok', providers: status, timestamp: new Date().toISOString() });
});

// Root route
app.get('/', (req, res) => {
  res.status(200).json({ message: 'Jenin AI mock Interviewer backend (Express) is running.' });
});

// Socket.IO realtime
io.on('connection', (socket) => {
  console.log('Socket connected', socket.id);
  transcriptStore.startSession(socket.id);

  // Per-socket STT state for chunked audio
  const sttState = {
    chunks: [], // array of Buffers
    timer: null,
  };

  socket.on('disconnect', () => {
    console.log('Socket disconnected', socket.id);
    if (sttState.timer) clearTimeout(sttState.timer);
    sttState.chunks = [];
    transcriptStore.endSession(socket.id);
  });

  // Receive audio chunks -> STT
  socket.on('interview:audio', async ({ audioBase64 }) => {
    try {
      const stt = createSTT();
      const buffer = Buffer.from(String(audioBase64 || ''), 'base64');
      const result = await stt.transcribeAudio(buffer, { language: process.env.STT_LANGUAGE || 'en' });
      socket.emit('interview:stt', { text: result.text, provider: stt.name, interim: false });
      transcriptStore.addEvent(socket.id, { type: 'stt_single', text: result.text, provider: stt.name });
    } catch (err) {
      socket.emit('interview:error', { stage: 'stt', error: String((err && err.message) || err) });
      transcriptStore.addEvent(socket.id, { type: 'error', stage: 'stt', error: String((err && err.message) || err) });
    }
  });

  // Streaming: receive chunk
  socket.on('interview:audio_chunk', async ({ audioBase64 }) => {
    try {
      const buf = Buffer.from(String(audioBase64 || ''), 'base64');
      sttState.chunks.push(buf);

      // Debounce interim transcription
      if (sttState.timer) clearTimeout(sttState.timer);
      sttState.timer = setTimeout(async () => {
        try {
          const stt = createSTT();
          const merged = Buffer.concat(sttState.chunks);
          const result = await stt.transcribeAudio(merged, { language: process.env.STT_LANGUAGE || 'en' });
          socket.emit('interview:stt', { text: result.text, provider: stt.name, interim: true });
          transcriptStore.addEvent(socket.id, { type: 'stt_interim', text: result.text, provider: stt.name });
        } catch (err) {
          socket.emit('interview:error', { stage: 'stt_interim', error: String((err && err.message) || err) });
          transcriptStore.addEvent(socket.id, { type: 'error', stage: 'stt_interim', error: String((err && err.message) || err) });
        }
      }, 400);
    } catch (err) {
      socket.emit('interview:error', { stage: 'stt_chunk', error: String((err && err.message) || err) });
      transcriptStore.addEvent(socket.id, { type: 'error', stage: 'stt_chunk', error: String((err && err.message) || err) });
    }
  });

  // Streaming: finalize
  socket.on('interview:audio_end', async () => {
    try {
      if (sttState.timer) clearTimeout(sttState.timer);
      const stt = createSTT();
      const merged = Buffer.concat(sttState.chunks);
      sttState.chunks = [];
      const result = await stt.transcribeAudio(merged, { language: process.env.STT_LANGUAGE || 'en' });
      socket.emit('interview:stt', { text: result.text, provider: stt.name, interim: false, final: true });
      transcriptStore.addEvent(socket.id, { type: 'stt_final', text: result.text, provider: stt.name });
    } catch (err) {
      socket.emit('interview:error', { stage: 'stt_final', error: String((err && err.message) || err) });
      transcriptStore.addEvent(socket.id, { type: 'error', stage: 'stt_final', error: String((err && err.message) || err) });
    }
  });

  // Receive question text -> LLM (+ optional TTS)
  socket.on('interview:question', async ({ text, wantTTS }) => {
    try {
      transcriptStore.addEvent(socket.id, { type: 'question', text: text || '', wantTTS: !!wantTTS });
      const llm = createLLM();
      const tts = createTTS();
      const out = await llm.generateText(`Interview question: ${text || ''}`, { model: process.env.LLM_MODEL });
      let ttsResult = null;
      if (wantTTS) {
        ttsResult = await tts.synthesizeSpeech(out.text, { voice: process.env.TTS_VOICE });
      }
      socket.emit('interview:reply', { text: out.text, provider: llm.name, tts: ttsResult });
      transcriptStore.addEvent(socket.id, { type: 'llm_reply', text: out.text, provider: llm.name });
      if (ttsResult?.audioBase64) {
        transcriptStore.addEvent(socket.id, { type: 'tts', provider: 'elevenlabs', bytes: Buffer.byteLength(ttsResult.audioBase64, 'base64') });
      }
    } catch (err) {
      socket.emit('interview:error', { stage: 'llm_tts', error: String((err && err.message) || err) });
      transcriptStore.addEvent(socket.id, { type: 'error', stage: 'llm_tts', error: String((err && err.message) || err) });
    }
  });
});

// 404 handler
app.use((req, res) => {
  res.status(404).json({ error: 'Not found' });
});

// Error handler
// eslint-disable-next-line no-unused-vars
app.use((err, req, res, next) => {
  console.error('Unhandled error:', err);
  const status = err.status || 500;
  res.status(status).json({ error: 'Internal error', status });
});

const PORT = process.env.PORT || 8000;
server.listen(PORT, () => {
  console.log(`Server listening on http://localhost:${PORT}`);
});
