async function getJSON(url, opts) {
  const res = await fetch(url, opts);
  const text = await res.text();
  try { return JSON.parse(text); } catch { return { raw: text }; }
}

const healthBtn = document.getElementById('healthBtn');
const healthStatus = document.getElementById('healthStatus');
const askBtn = document.getElementById('askBtn');
const questionEl = document.getElementById('question');
const responseEl = document.getElementById('response');
const wantTTSCb = document.getElementById('wantTTS');
const askSocketBtn = document.getElementById('askSocketBtn');
const socketStatus = document.getElementById('socketStatus');
const startMicBtn = document.getElementById('startMicBtn');
const stopMicBtn = document.getElementById('stopMicBtn');
const transcriptEl = document.getElementById('transcript');
const replyEl = document.getElementById('reply');
const ttsAudio = document.getElementById('ttsAudio');

// Socket.IO client
const socket = io('http://localhost:8000', { transports: ['websocket'] });
socket.on('connect', () => {
  socketStatus.textContent = 'connected';
  socketStatus.classList.remove('warn');
  socketStatus.classList.add('ok');
});
socket.on('disconnect', () => {
  socketStatus.textContent = 'disconnected';
  socketStatus.classList.remove('ok');
  socketStatus.classList.add('warn');
});
socket.on('interview:stt', ({ text, interim, final, provider }) => {
  const tag = interim ? '[interim]' : (final ? '[final]' : '[stt]');
  const line = `${tag} (${provider}) ${text}`;
  transcriptEl.textContent = `${transcriptEl.textContent}\n${line}`.trim();
});
socket.on('interview:reply', ({ text, provider, tts }) => {
  replyEl.textContent = `(${provider}) ${text}`;
  if (tts && tts.audioBase64 && tts.mime) {
    ttsAudio.src = `data:${tts.mime};base64,${tts.audioBase64}`;
    ttsAudio.play().catch(() => {});
  }
});
socket.on('interview:error', ({ stage, error }) => {
  const line = `[error:${stage}] ${error}`;
  transcriptEl.textContent = `${transcriptEl.textContent}\n${line}`.trim();
});

healthBtn.addEventListener('click', async () => {
  healthStatus.textContent = 'Checking...';
  try {
    const data = await getJSON('http://localhost:8000/health');
    healthStatus.textContent = `OK (${data.service})`;
  } catch (e) {
    healthStatus.textContent = 'Failed to reach backend';
  }
});

askBtn.addEventListener('click', async () => {
  const question = questionEl.value.trim();
  responseEl.textContent = 'Asking...';
  try {
    const data = await getJSON('http://localhost:8000/api/v1/interview/question', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ question, wantTTS: wantTTSCb.checked })
    });
    responseEl.textContent = JSON.stringify(data, null, 2);
  } catch (e) {
    responseEl.textContent = 'Request failed.';
  }
});

askSocketBtn.addEventListener('click', () => {
  const text = questionEl.value.trim();
  socket.emit('interview:question', { text, wantTTS: wantTTSCb.checked });
});

// Mic streaming via MediaRecorder
let mediaStream = null;
let mediaRecorder = null;

startMicBtn.addEventListener('click', async () => {
  transcriptEl.textContent = '';
  replyEl.textContent = '';
  ttsAudio.src = '';
  try {
    mediaStream = await navigator.mediaDevices.getUserMedia({ audio: true });
    mediaRecorder = new MediaRecorder(mediaStream, { mimeType: 'audio/webm' });
    mediaRecorder.ondataavailable = async (e) => {
      if (e.data && e.data.size > 0) {
        const arrayBuf = await e.data.arrayBuffer();
        const base64 = btoa(String.fromCharCode(...new Uint8Array(arrayBuf)));
        socket.emit('interview:audio_chunk', { audioBase64: base64 });
      }
    };
    mediaRecorder.onstop = () => {
      socket.emit('interview:audio_end');
    };
    mediaRecorder.start(300); // chunk every 300ms
    startMicBtn.disabled = true;
    stopMicBtn.disabled = false;
  } catch (err) {
    alert('Mic permission or recording failed');
  }
});

stopMicBtn.addEventListener('click', () => {
  if (mediaRecorder && mediaRecorder.state !== 'inactive') {
    mediaRecorder.stop();
  }
  if (mediaStream) {
    mediaStream.getTracks().forEach((t) => t.stop());
  }
  startMicBtn.disabled = false;
  stopMicBtn.disabled = true;
});
