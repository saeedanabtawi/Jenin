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

dotenv.config();

const app = express();
const server = http.createServer(app);
const io = new Server(server, {
  cors: {
    origin: '*',
    methods: ['GET', 'POST'],
  },
});

app.use(cors());
app.use(express.json());

// API routes
app.use('/api/v1/interview', interviewRouter);

// Health route
app.get('/health', (req, res) => {
  res.status(200).json({
    status: 'ok',
    service: 'jenin-backend',
    timestamp: new Date().toISOString(),
  });
});

// Root route
app.get('/', (req, res) => {
  res.status(200).json({ message: 'Jenin AI mock Interviewer backend (Express) is running.' });
});

// Socket.IO realtime
io.on('connection', (socket) => {
  console.log('Socket connected', socket.id);

  socket.on('disconnect', () => {
    console.log('Socket disconnected', socket.id);
  });

  // Receive audio chunks -> STT
  socket.on('interview:audio', async ({ audioBase64 }) => {
    try {
      const stt = createSTT();
      const buffer = Buffer.from(String(audioBase64 || ''), 'base64');
      const result = await stt.transcribeAudio(buffer, { language: process.env.STT_LANGUAGE || 'en' });
      socket.emit('interview:stt', { text: result.text, provider: stt.name });
    } catch (err) {
      socket.emit('interview:error', { stage: 'stt', error: String((err && err.message) || err) });
    }
  });

  // Receive question text -> LLM (+ optional TTS)
  socket.on('interview:question', async ({ text, wantTTS }) => {
    try {
      const llm = createLLM();
      const tts = createTTS();
      const out = await llm.generateText(`Interview question: ${text || ''}`, { model: process.env.LLM_MODEL });
      let ttsResult = null;
      if (wantTTS) {
        ttsResult = await tts.synthesizeSpeech(out.text, { voice: process.env.TTS_VOICE });
      }
      socket.emit('interview:reply', { text: out.text, provider: llm.name, tts: ttsResult });
    } catch (err) {
      socket.emit('interview:error', { stage: 'llm_tts', error: String((err && err.message) || err) });
    }
  });
});

const PORT = process.env.PORT || 8000;
server.listen(PORT, () => {
  console.log(`Server listening on http://localhost:${PORT}`);
});
