// AI Interview Test Tool React Client (no-bundle)
// Loads via <script type="text/babel" src="./app.jsx"></script>

const { useEffect, useMemo, useRef, useState } = React;

function useLocalStorage(key, initialValue) {
  const [value, setValue] = useState(() => {
    try {
      const item = window.localStorage.getItem(key);
      return item !== null ? JSON.parse(item) : initialValue;
    } catch {
      return initialValue;
    }
  });
  useEffect(() => {
    try { window.localStorage.setItem(key, JSON.stringify(value)); } catch {}
  }, [key, value]);
  return [value, setValue];
}

function joinUrl(base, path) {
  return base.replace(/\/+$/, '') + path;
}

async function jsonFetch(url, options = {}) {
  const res = await fetch(url, options);
  const text = await res.text();
  let data;
  try { data = JSON.parse(text); } catch { data = { raw: text }; }
  if (!res.ok) {
    const err = new Error((data && (data.error || data.message)) || `HTTP ${res.status}`);
    err.status = res.status;
    err.body = data;
    throw err;
  }
  return data;
}

function Badge({ ok, label }) {
  return (
    <span className={`badge ${ok ? 'ok' : 'warn'}`}>{label}</span>
  );
}

function SttEvalPanel({ serverUrl, apiKey }) {
  const [providers, setProviders] = useState(null);
  const [recording, setRecording] = useState(false);
  const [meter, setMeter] = useState(0);
  const [result, setResult] = useState(null);
  const [error, setError] = useState(null);
  const media = useRef({ stream: null, recorder: null, ctx: null, analyser: null, raf: 0, chunks: [] });
  const recStartRef = useRef(0);
  const [lastDurationSec, setLastDurationSec] = useState(null);
  const [sttRatePerMin, setSttRatePerMin] = useLocalStorage('cost_stt_per_min', 0);

  function formatUSD(v) { return '$' + Number(v || 0).toFixed(4); }

  useEffect(() => {
    (async () => { try { const d = await jsonFetch(joinUrl(serverUrl, '/health/providers')); setProviders(d.providers); } catch {} })();
  }, [serverUrl]);

  async function transcribeBlob(blob) {
    try {
      setError(null); setResult('Transcribing…');
      const arr = await blob.arrayBuffer();
      const b64 = btoa(String.fromCharCode(...new Uint8Array(arr)));
      const headers = { 'Content-Type': 'application/json' };
      if (apiKey) headers['X-API-Key'] = apiKey;
      const data = await jsonFetch(joinUrl(serverUrl, '/api/v1/eval/stt'), { method: 'POST', headers, body: JSON.stringify({ audioBase64: b64, mimetype: blob.type || 'audio/webm' }) });
      setResult(data);
    } catch (e) { setError(e.message || 'Failed'); setResult(null); }
  }

  async function onFile(e) {
    const f = e.target.files?.[0]; if (!f) return;
    // Try to get media duration from file metadata
    try {
      const dur = await new Promise((resolve) => {
        const url = URL.createObjectURL(f);
        const a = new Audio();
        a.preload = 'metadata';
        a.src = url;
        a.onloadedmetadata = () => { const d = a.duration; URL.revokeObjectURL(url); resolve(isFinite(d) ? d : null); };
        a.onerror = () => { try { URL.revokeObjectURL(url); } catch {} resolve(null); };
      });
      if (typeof dur === 'number') setLastDurationSec(dur);
    } catch {}
    await transcribeBlob(f); e.target.value = '';
  }

  async function startRec() {
    try {
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
      const recorder = new MediaRecorder(stream, { mimeType: 'audio/webm' });
      const chunks = [];
      recorder.ondataavailable = (e) => { if (e.data && e.data.size > 0) chunks.push(e.data); };
      recorder.onstop = async () => { const blob = new Blob(chunks, { type: 'audio/webm' }); if (recStartRef.current) { setLastDurationSec((Date.now() - recStartRef.current) / 1000); } await transcribeBlob(blob); };

      const ctx = new AudioContext(); const src = ctx.createMediaStreamSource(stream); const analyser = ctx.createAnalyser(); analyser.fftSize = 512; src.connect(analyser);
      const data = new Uint8Array(analyser.fftSize);
      const loop = () => {
        analyser.getByteTimeDomainData(data);
        let sum = 0; for (let i = 0; i < data.length; i++) { const v = (data[i] - 128) / 128; sum += v * v; }
        const rms = Math.sqrt(sum / data.length); setMeter(Math.min(100, Math.max(0, Math.round(rms * 120))));
        media.current.raf = requestAnimationFrame(loop);
      };
      media.current = { stream, recorder, ctx, analyser, raf: requestAnimationFrame(loop), chunks };
      recStartRef.current = Date.now();
      recorder.start(200);
      setRecording(true); setResult(null);
    } catch (e) { setError('Mic error: ' + (e?.message || e)); }
  }

  function stopRec() {
    const m = media.current;
    if (m.recorder && m.recorder.state !== 'inactive') m.recorder.stop();
    if (m.stream) m.stream.getTracks().forEach(t => t.stop());
    if (m.ctx) m.ctx.close().catch(() => {});
    if (m.raf) cancelAnimationFrame(m.raf);
    media.current = { stream: null, recorder: null, ctx: null, analyser: null, raf: 0, chunks: [] };
    setRecording(false); setMeter(0);
  }

  const stt = providers?.stt;
  return (
    <div className="grid">
      <div className="col-12">
        <h3>STT Evaluation</h3>
        <div className="row" style={{ display: 'flex', gap: 12, alignItems: 'center' }}>
          <strong>Provider:</strong> <Badge ok={!!stt?.configured} label={stt?.provider || 'unknown'} />
          {stt?.model && (<><span className="small">Model:</span> <code>{stt.model}</code></>)}
        </div>
      </div>
      <div className="col-6">
        <div className="row" style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
          <button onClick={recording ? stopRec : startRec} className={recording ? 'warn' : ''}>{recording ? 'Stop Mic' : 'Start Mic'}</button>
          <div className="meter" style={{ width: 120 }}><span style={{ width: `${meter}%` }} /></div>
        </div>
        <div className="row">
          <label className="small">Or upload audio</label>
          <input type="file" accept="audio/*" onChange={onFile} />
        </div>
      </div>
      <div className="col-6">
        <h3>Transcription</h3>
        {error && <div className="badge warn">{error}</div>}
        <pre>{result ? JSON.stringify(result, null, 2) : '—'}</pre>
        <div className="row">
          <h4 className="small" style={{ margin: 0 }}>Cost</h4>
          <div className="row" style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
            <span className="small">Duration:</span>
            <code>{lastDurationSec != null ? `${lastDurationSec.toFixed(2)} s` : '—'}</code>
            <span className="small">Rate/min:</span>
            <input type="number" min="0" step="0.001" style={{ width: 120 }} value={sttRatePerMin} onChange={(e) => setSttRatePerMin(Number(e.target.value))} />
            <span className="small">Est:</span>
            <code>{lastDurationSec != null ? formatUSD((sttRatePerMin || 0) * (lastDurationSec / 60)) : '—'}</code>
          </div>
        </div>
      </div>
    </div>
  );
}

function TopBar({ serverUrl, setServerUrl, apiKey, setApiKey, socketId, socketConnected, reconnect, sessionIdMode, setSessionIdMode, sessionIdCustom, setSessionIdCustom, copySocketId }) {
  return (
    <div className="row">
      <div className="grid">
        <div className="col-6">
          <label className="small">Server URL</label>
          <div style={{ display: 'flex', gap: 8 }}>
            <input value={serverUrl} onChange={e => setServerUrl(e.target.value)} placeholder="http://localhost:8000" style={{ flex: 1 }} />
            <button className="ghost" onClick={reconnect}>Reconnect</button>
          </div>
        </div>
        <div className="col-6">
          <label className="small">API Key</label>
          <input value={apiKey} onChange={e => setApiKey(e.target.value)} placeholder="Optional" />
        </div>
        <div className="col-12" style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
          <strong>Socket:</strong>
          <Badge ok={socketConnected} label={socketConnected ? 'connected' : 'disconnected'} />
          <span className="small">ID:</span>
          <code style={{ userSelect: 'all' }}>{socketId || '—'}</code>
          <button className="ghost" onClick={copySocketId} disabled={!socketId}>Copy</button>
          <div style={{ marginLeft: 'auto', display: 'flex', alignItems: 'center', gap: 8 }}>
            <span className="small">Session ID for REST:</span>
            <label className="small"><input type="radio" name="sidMode" checked={sessionIdMode === 'socket'} onChange={() => setSessionIdMode('socket')} /> Socket ID</label>
            <label className="small"><input type="radio" name="sidMode" checked={sessionIdMode === 'custom'} onChange={() => setSessionIdMode('custom')} /> Custom</label>
            <input value={sessionIdCustom} onChange={(e) => setSessionIdCustom(e.target.value)} placeholder="custom-session-id" disabled={sessionIdMode !== 'custom'} />
          </div>
        </div>
      </div>
    </div>
  );
}

function HealthPanel({ serverUrl, apiKey }) {
  const [general, setGeneral] = useState(null);
  const [providers, setProviders] = useState(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState(null);

  async function check() {
    setLoading(true); setError(null);
    try {
      const g = await jsonFetch(joinUrl(serverUrl, '/health'));
      const p = await jsonFetch(joinUrl(serverUrl, '/health/providers'));
      setGeneral(g); setProviders(p.providers);
    } catch (e) {
      setError(e.message || 'Failed');
    } finally { setLoading(false); }
  }

  function providerTip(k) {
    const p = providers && providers[k];
    if (k === 'tts') {
      const name = p?.provider;
      if (name === 'openai') return 'Tip: Set OPENAI_API_KEY for OpenAI TTS (tts-1). Optionally set TTS_MODEL, TTS_VOICE, TTS_FORMAT.';
      if (name === 'elevenlabs') return 'Tip: Set ELEVENLABS_API_KEY (or TTS_API_KEY) and TTS_VOICE.';
      return 'Tip: Configure a supported TTS provider (openai or elevenlabs).';
    }
    if (k === 'stt') return 'Tip: Set OPENAI_API_KEY for whisper or DEEPGRAM_API_KEY for deepgram.';
    if (k === 'llm') return 'Tip: Set OPENAI_API_KEY for openai, or use ollama.';
    return '';
  }

  return (
    <div>
      <div className="row" style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
        <button className="primary" onClick={check} disabled={loading}>{loading ? 'Checking…' : 'Check Health'}</button>
        {error && <span className="warn badge">{error}</span>}
        {general && <span className="small">{general.status} • {general.service}</span>}
      </div>
      {providers && (
        <div className="grid">
          <div className="col-12">
            <h3>Providers</h3>
          </div>
          {['stt', 'llm', 'tts'].map((k) => (
            <div key={k} className="col-6">
              <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                <strong style={{ textTransform: 'uppercase' }}>{k}</strong>
                <Badge ok={!!providers[k]?.configured} label={`${providers[k]?.provider || 'unknown'}`} />
              </div>
              {!providers[k]?.configured && (
                <div className="small" style={{ marginTop: 6 }}>
                  {providerTip(k)}
                </div>
              )}
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

function InterviewPanel({ serverUrl, apiKey, socket, socketConnected, socketId, settings, sessionIdForRest }) {
  const [question, setQuestion] = useState('Tell me about yourself');
  const [restRes, setRestRes] = useState(null);
  const [transcript, setTranscript] = useState([]); // {tag, text}
  const [reply, setReply] = useState('');
  const [recording, setRecording] = useState(false);
  const [meter, setMeter] = useState(0);
  const audioEl = useRef(null);
  const ttsQueue = useRef([]);
  const playingRef = useRef(false);
  const media = useRef({ stream: null, recorder: null, ctx: null, analyser: null, raf: 0 });

  function appendTranscript(line) {
    setTranscript((prev) => [...prev, line]);
  }

  // Socket events
  useEffect(() => {
    if (!socket) return;
    const onSTT = ({ text, interim, final, provider }) => {
      const tag = interim ? 'interim' : (final ? 'final' : 'stt');
      appendTranscript({ tag, text: `(${provider}) ${text}` });
    };
    const onReply = ({ text, provider, tts }) => {
      setReply(`(${provider}) ${text}`);
      if (settings.ttsAutoplay && tts?.audioBase64 && tts?.mime) {
        ttsQueue.current.push(`data:${tts.mime};base64,${tts.audioBase64}`);
        pumpTTS();
      }
    };
    const onErr = ({ stage, error }) => {
      appendTranscript({ tag: 'error', text: `[${stage}] ${error}` });
    };
    socket.on('interview:stt', onSTT);
    socket.on('interview:reply', onReply);
    socket.on('interview:error', onErr);
    return () => {
      socket.off('interview:stt', onSTT);
      socket.off('interview:reply', onReply);
      socket.off('interview:error', onErr);
    };
  }, [socket, settings.ttsAutoplay]);

  function pumpTTS() {
    if (!audioEl.current) return;
    if (playingRef.current) return;
    const next = ttsQueue.current.shift();
    if (!next) return;
    playingRef.current = true;
    audioEl.current.src = next;
    audioEl.current.onended = () => {
      playingRef.current = false;
      pumpTTS();
    };
    audioEl.current.onerror = () => {
      playingRef.current = false;
      pumpTTS();
    };
    audioEl.current.play().catch(() => { playingRef.current = false; });
  }

  async function askREST() {
    const headers = { 'Content-Type': 'application/json' };
    if (apiKey) headers['X-API-Key'] = apiKey;
    if (sessionIdForRest) headers['X-Session-Id'] = sessionIdForRest;
    setRestRes('Asking…');
    try {
      const data = await jsonFetch(joinUrl(serverUrl, '/api/v1/interview/question'), {
        method: 'POST',
        headers,
        body: JSON.stringify({ question, wantTTS: !!settings.wantTTS })
      });
      setRestRes(data);
    } catch (e) {
      setRestRes({ error: e.message, body: e.body });
    }
  }

  function askSocket() {
    if (!socketConnected) return;
    socket.emit('interview:question', { text: question, wantTTS: !!settings.wantTTS });
  }

  async function startMic() {
    if (!socketConnected) return;
    try {
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
      const recorder = new MediaRecorder(stream, { mimeType: 'audio/webm' });
      recorder.ondataavailable = async (e) => {
        if (e.data && e.data.size > 0) {
          const buf = await e.data.arrayBuffer();
          const b64 = btoa(String.fromCharCode(...new Uint8Array(buf)));
          socket.emit('interview:audio_chunk', { audioBase64: b64 });
        }
      };
      recorder.onstop = () => {
        socket.emit('interview:audio_end');
      };

      // VU meter
      const ctx = new AudioContext();
      const src = ctx.createMediaStreamSource(stream);
      const analyser = ctx.createAnalyser();
      analyser.fftSize = 512;
      src.connect(analyser);
      const data = new Uint8Array(analyser.fftSize);
      const loop = () => {
        analyser.getByteTimeDomainData(data);
        let sum = 0;
        for (let i = 0; i < data.length; i++) {
          const v = (data[i] - 128) / 128;
          sum += v * v;
        }
        const rms = Math.sqrt(sum / data.length);
        setMeter(Math.min(100, Math.max(0, Math.round(rms * 120))));
        media.current.raf = requestAnimationFrame(loop);
      };
      media.current = { stream, recorder, ctx, analyser, raf: requestAnimationFrame(loop) };

      recorder.start(Number(settings.chunkMs || 300));
      setRecording(true);
      setTranscript([]);
      setReply('');
      ttsQueue.current = [];
    } catch (e) {
      alert('Mic error: ' + (e?.message || e));
    }
  }

  function stopMic() {
    const m = media.current;
    if (m.recorder && m.recorder.state !== 'inactive') m.recorder.stop();
    if (m.stream) m.stream.getTracks().forEach(t => t.stop());
    if (m.ctx) m.ctx.close().catch(() => {});
    if (m.raf) cancelAnimationFrame(m.raf);
    media.current = { stream: null, recorder: null, ctx: null, analyser: null, raf: 0 };
    setRecording(false);
    setMeter(0);
  }

  // Push-to-talk (Space)
  useEffect(() => {
    const down = (e) => {
      const tag = (e.target && e.target.tagName) ? e.target.tagName.toLowerCase() : '';
      if (tag === 'input' || tag === 'textarea') return; // don't hijack typing
      if (e.code === 'Space' && !recording) {
        e.preventDefault();
        startMic();
      }
    };
    const up = (e) => {
      const tag = (e.target && e.target.tagName) ? e.target.tagName.toLowerCase() : '';
      if (tag === 'input' || tag === 'textarea') return;
      if (e.code === 'Space' && recording) {
        e.preventDefault();
        stopMic();
      }
    };
    window.addEventListener('keydown', down);
    window.addEventListener('keyup', up);
    return () => { window.removeEventListener('keydown', down); window.removeEventListener('keyup', up); };
  }, [recording, socketConnected, settings.chunkMs]);

  return (
    <div className="grid">
      <div className="col-6">
        <label className="small">Ask a question</label>
        <textarea value={question} onChange={e => setQuestion(e.target.value)} placeholder="e.g., Tell me about yourself" />
        <div className="row" style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
          <button className="primary" onClick={askREST}>Ask (REST)</button>
          <button onClick={askSocket} disabled={!socketConnected}>Ask (Socket)</button>
          <label className="small"><input type="checkbox" checked={!!settings.wantTTS} onChange={(e) => settings.setWantTTS(e.target.checked)} /> TTS</label>
        </div>
        <div className="row">
          <h3>REST Response</h3>
          <pre>{restRes ? JSON.stringify(restRes, null, 2) : '—'}</pre>
        </div>
      </div>
      <div className="col-6">
        <div className="row" style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
          <button onClick={recording ? stopMic : startMic} disabled={!socketConnected} className={recording ? 'warn' : ''}>
            {recording ? 'Stop Mic' : 'Start Mic'}
          </button>
          <span className="small">Push-to-talk: hold Space</span>
          <div className="meter" style={{ width: 120 }}><span style={{ width: `${meter}%` }} /></div>
        </div>
        <div className="row">
          <h3>Transcript</h3>
          <pre>{transcript.length ? transcript.map((l, i) => `[${l.tag}] ${l.text}`).join('\n') : '—'}</pre>
        </div>
      </div>
    </div>
  );
}

function LlmEvalPanel({ serverUrl, apiKey }) {
  const [providers, setProviders] = useState(null);
  const [prompt, setPrompt] = useState('Summarize the benefits of using WebSockets.');
  const [result, setResult] = useState(null);
  const [error, setError] = useState(null);
  const [llmInPer1k, setLlmInPer1k] = useLocalStorage('cost_llm_in_per_1k', 0);
  const [llmOutPer1k, setLlmOutPer1k] = useLocalStorage('cost_llm_out_per_1k', 0);
  const [llmCachedInPer1k, setLlmCachedInPer1k] = useLocalStorage('cost_llm_cached_in_per_1k', 0);

  function formatUSD(v) { return '$' + Number(v || 0).toFixed(4); }

  useEffect(() => {
    (async () => { try { const d = await jsonFetch(joinUrl(serverUrl, '/health/providers')); setProviders(d.providers); } catch {} })();
  }, [serverUrl]);

  async function generate() {
    try {
      setError(null); setResult('Generating…');
      const headers = { 'Content-Type': 'application/json' };
      if (apiKey) headers['X-API-Key'] = apiKey;
      const data = await jsonFetch(joinUrl(serverUrl, '/api/v1/eval/llm'), {
        method: 'POST', headers, body: JSON.stringify({ prompt })
      });
      setResult(data);
    } catch (e) { setError(e.message || 'Failed'); setResult(null); }
  }

  const llm = providers?.llm;
  return (
    <div className="grid">
      <div className="col-12">
        <h3>LLM Evaluation</h3>
        <div className="row" style={{ display: 'flex', gap: 12, alignItems: 'center' }}>
          <strong>Provider:</strong> <Badge ok={!!llm?.configured} label={llm?.provider || 'unknown'} />
          {llm?.model && (<><span className="small">Model:</span> <code>{llm.model}</code></>)}
        </div>
      </div>
      <div className="col-6">
        <label className="small">Prompt</label>
        <textarea value={prompt} onChange={(e) => setPrompt(e.target.value)} />
        <div className="row"><button className="primary" onClick={generate}>Generate</button></div>
      </div>
      <div className="col-6">
        <h3>Output</h3>
        {error && <div className="badge warn">{error}</div>}
        <pre>{result ? (typeof result === 'string' ? result : JSON.stringify(result, null, 2)) : '—'}</pre>
        <div className="row">
          <h4 className="small" style={{ margin: 0 }}>Cost</h4>
          {(() => {
            const usage = (result && typeof result === 'object') ? (result.usage || {}) : {};
            const pt = Number(usage.prompt_tokens || 0);
            const ct = Number(usage.completion_tokens || 0);
            // Try several field names for cached-read tokens if the backend/model provides them
            const cpt = Number(
              (usage.prompt_tokens_details && usage.prompt_tokens_details.cached_tokens) ||
              usage.prompt_tokens_cached ||
              usage.cached_prompt_tokens ||
              usage.cache_read_input_tokens ||
              usage.cached_input_tokens ||
              0
            );
            const nonCachedPt = Math.max(0, pt - cpt);
            const cost = (nonCachedPt / 1000) * (llmInPer1k || 0)
              + (cpt / 1000) * (llmCachedInPer1k || 0)
              + (ct / 1000) * (llmOutPer1k || 0);
            return (
              <div className="row" style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
                <span className="small">Prompt tokens:</span> <code>{pt || 0}</code>
                <span className="small">Output tokens:</span> <code>{ct || 0}</code>
                <span className="small">Cached prompt tokens:</span> <code>{cpt || 0}</code>
                <span className="small">$/1k in:</span>
                <input type="number" min="0" step="0.000001" style={{ width: 120 }} value={llmInPer1k} onChange={(e) => setLlmInPer1k(Number(e.target.value))} />
                <span className="small">$/1k out:</span>
                <input type="number" min="0" step="0.000001" style={{ width: 120 }} value={llmOutPer1k} onChange={(e) => setLlmOutPer1k(Number(e.target.value))} />
                <span className="small">$/1k cached in:</span>
                <input type="number" min="0" step="0.000001" style={{ width: 120 }} value={llmCachedInPer1k} onChange={(e) => setLlmCachedInPer1k(Number(e.target.value))} />
                <span className="small">Est:</span> <code>{formatUSD(cost)}</code>
              </div>
            );
          })()}
        </div>
      </div>
    </div>
  );
}

function TtsEvalPanel({ serverUrl, apiKey }) {
  const [providers, setProviders] = useState(null);
  const [text, setText] = useState('This is a text-to-speech test.');
  const [audioUrl, setAudioUrl] = useState('');
  const [result, setResult] = useState(null);
  const [error, setError] = useState(null);
  const audioRef = useRef(null);
  const lastUrlRef = useRef('');
  const [audioReady, setAudioReady] = useState(false);
  const [audioPlaybackError, setAudioPlaybackError] = useState('');
  const [ttsPer1kChars, setTtsPer1kChars] = useLocalStorage('cost_tts_per_1k_chars', 0);

  function formatUSD(v) { return '$' + Number(v || 0).toFixed(4); }

  useEffect(() => {
    (async () => { try { const d = await jsonFetch(joinUrl(serverUrl, '/health/providers')); setProviders(d.providers); } catch {} })();
  }, [serverUrl]);

  // Cleanup Blob URL on unmount
  useEffect(() => {
    return () => {
      if (lastUrlRef.current && lastUrlRef.current.startsWith('blob:')) {
        try { URL.revokeObjectURL(lastUrlRef.current); } catch {}
      }
    };
  }, []);

  async function speak() {
    try {
      setError(null); setResult('Synthesizing…');
      setAudioPlaybackError('');
      setAudioReady(false);
      // Revoke previous Blob URL if any
      if (lastUrlRef.current && lastUrlRef.current.startsWith('blob:')) {
        try { URL.revokeObjectURL(lastUrlRef.current); } catch {}
      }
      setAudioUrl('');
      const headers = { 'Content-Type': 'application/json' };
      if (apiKey) headers['X-API-Key'] = apiKey;
      const data = await jsonFetch(joinUrl(serverUrl, '/api/v1/eval/tts'), {
        method: 'POST', headers, body: JSON.stringify({ text })
      });
      setResult({ provider: data.provider, model: data.model, voice: data.voice, mime: data.mime });
      if (data && data.audioBase64 && data.mime) {
        // Prefer Blob URL for better compatibility with larger payloads
        try {
          const bin = atob(data.audioBase64);
          const len = bin.length;
          const bytes = new Uint8Array(len);
          for (let i = 0; i < len; i++) bytes[i] = bin.charCodeAt(i);
          const blob = new Blob([bytes], { type: data.mime });
          const url = URL.createObjectURL(blob);
          lastUrlRef.current = url;
          setAudioUrl(url);
          // Set element src explicitly, load, then attempt playback (user gesture context)
          setTimeout(() => {
            try {
              if (audioRef.current) {
                audioRef.current.src = url;
                audioRef.current.load();
                audioRef.current.play().catch(() => {});
              }
            } catch {}
          }, 0);
        } catch {
          // Fallback to data URL if Blob creation fails
          const dataUrl = `data:${data.mime};base64,${data.audioBase64}`;
          setAudioUrl(dataUrl);
          setTimeout(() => {
            try {
              if (audioRef.current) {
                audioRef.current.src = dataUrl;
                audioRef.current.load();
                audioRef.current.play().catch(() => {});
              }
            } catch {}
          }, 0);
        }
      }
    } catch (e) { setError(e.message || 'Failed'); setResult(null); setAudioUrl(''); }
  }

  function playAudio() {
    const a = audioRef.current;
    if (a && audioUrl) {
      try { a.currentTime = 0; a.play().catch((err) => setAudioPlaybackError(err?.message || 'Playback blocked')); }
      catch (err) { setAudioPlaybackError(err?.message || 'Playback error'); }
    }
  }

  function stopAudio() {
    const a = audioRef.current;
    if (a) { try { a.pause(); a.currentTime = 0; } catch {} }
  }

  const tts = providers?.tts;
  return (
    <div className="grid">
      <div className="col-12">
        <h3>TTS Evaluation</h3>
        <div className="row" style={{ display: 'flex', gap: 12, alignItems: 'center' }}>
          <strong>Provider:</strong> <Badge ok={!!tts?.configured} label={tts?.provider || 'unknown'} />
          {tts?.model && (<><span className="small">Model:</span> <code>{tts.model}</code></>)}
          {tts?.voice && (<><span className="small">Voice:</span> <code>{tts.voice}</code></>)}
        </div>
      </div>
      <div className="col-6">
        <label className="small">Text</label>
        <textarea value={text} onChange={(e) => setText(e.target.value)} />
        <div className="row"><button className="primary" onClick={speak}>Speak</button></div>
      </div>
      <div className="col-6">
        <h3>Audio</h3>
        {error && <div className="badge warn">{error}</div>}
        <audio
          ref={audioRef}
          controls
          src={audioUrl || undefined}
          onCanPlay={() => setAudioReady(true)}
          onError={() => setAudioPlaybackError('Cannot play audio. Try a different format (e.g., mp3).')}
        >
          Your browser does not support the audio element.
        </audio>
        <div className="row" style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
          <button onClick={playAudio} disabled={!audioUrl}>Play</button>
          <button onClick={stopAudio} disabled={!audioUrl}>Stop</button>
          {audioUrl && <a href={audioUrl} download="tts-output">Download audio</a>}
        </div>
        {audioPlaybackError && <div className="badge warn">{audioPlaybackError}</div>}
        <div className="row">
          <h4 className="small" style={{ margin: 0 }}>Result</h4>
          <pre>{result ? JSON.stringify(result, null, 2) : '—'}</pre>
        </div>
        <div className="row">
          <h4 className="small" style={{ margin: 0 }}>Cost</h4>
          <div className="row" style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
            <span className="small">Chars:</span> <code>{(text || '').length}</code>
            <span className="small">$/1k chars:</span>
            <input type="number" min="0" step="0.001" style={{ width: 120 }} value={ttsPer1kChars} onChange={(e) => setTtsPer1kChars(Number(e.target.value))} />
            <span className="small">Est:</span>
            <code>{formatUSD(((text || '').length / 1000) * (ttsPer1kChars || 0))}</code>
          </div>
        </div>
      </div>
    </div>
  );
}

function AvatarPanel() {
  const [akoolToken, setAkoolToken] = useLocalStorage('akoolToken', '');
  const [avatarId, setAvatarId] = useLocalStorage('akoolAvatarId', 'dvp_Tristan_cloth2_1080P');
  const [knowledgeId, setKnowledgeId] = useLocalStorage('akoolKnowledgeId', '');
  const [session, setSession] = useState(null); // Akool session payload
  const [connecting, setConnecting] = useState(false);
  const [joined, setJoined] = useState(false);
  const [error, setError] = useState(null);
  const [logs, setLogs] = useState([]);
  const [msg, setMsg] = useState('Hello');
  const [avatarPerMin, setAvatarPerMin] = useLocalStorage('cost_avatar_per_min', 0);
  const [elapsedSec, setElapsedSec] = useState(0);

  const containerRef = useRef(null);
  const clientRef = useRef(null);
  const dataStreamIdRef = useRef(null);
  const remoteTracksRef = useRef({ video: null, audio: null });
  const joinTsRef = useRef(0);

  function log(line) { setLogs((prev) => [...prev, `[${new Date().toLocaleTimeString()}] ${line}`]); }
  function formatUSD(v) { return '$' + Number(v || 0).toFixed(4); }

  // Dynamically load Agora SDK as a fallback if not present
  async function loadAgora() {
    if (typeof window === 'undefined') throw new Error('Window not available');
    if (window.AgoraRTC) return;
    await new Promise((resolve, reject) => {
      const existing = document.querySelector('script[data-agora-sdk]');
      if (existing) {
        existing.addEventListener('load', () => resolve());
        existing.addEventListener('error', () => reject(new Error('Failed to load Agora SDK')));
        return;
      }
      const s = document.createElement('script');
      s.src = 'https://cdn.agora.io/sdk/release/AgoraRTC_N.js';
      s.async = true; s.defer = true; s.setAttribute('data-agora-sdk', '1');
      s.onload = () => resolve();
      s.onerror = () => reject(new Error('Failed to load Agora SDK'));
      document.head.appendChild(s);
    });
  }

  async function createSessionAndJoin() {
    setConnecting(true); setError(null);
    try {
      if (!akoolToken) throw new Error('Set Akool Bearer token first');
      if (!avatarId) throw new Error('Set avatar_id');
      if (typeof window === 'undefined') throw new Error('Window not available');
      if (!window.AgoraRTC) { log('Loading Agora SDK…'); await loadAgora(); }
      if (!window.AgoraRTC) throw new Error('AgoraRTC SDK not loaded');
      const body = { avatar_id: avatarId };
      if (knowledgeId) body.knowledge_id = knowledgeId;
      const res = await fetch('https://openapi.akool.com/api/open/v4/liveAvatar/session/create', {
        method: 'POST',
        headers: { authorization: `Bearer ${akoolToken}`, 'content-type': 'application/json' },
        body: JSON.stringify(body),
      });
      const json = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(json?.msg || json?.message || `HTTP ${res.status}`);
      const data = json?.data || json; // handle wrapped/flat
      setSession(data);
      const cred = (data && data.credentials) || {};
      if (!cred.agora_app_id || !cred.agora_channel || !cred.agora_token) {
        throw new Error('Missing Agora credentials from Akool response');
      }

      const client = AgoraRTC.createClient({ mode: 'rtc', codec: 'vp8' });
      clientRef.current = client;

      client.on('user-published', async (user, mediaType) => {
        try {
          await client.subscribe(user, mediaType);
          if (mediaType === 'video' && user.videoTrack) {
            if (remoteTracksRef.current.video) { try { remoteTracksRef.current.video.stop(); } catch {} }
            remoteTracksRef.current.video = user.videoTrack;
            user.videoTrack.play(containerRef.current);
            log(`video from uid ${user.uid}`);
          }
          if (mediaType === 'audio' && user.audioTrack) {
            if (remoteTracksRef.current.audio) { try { remoteTracksRef.current.audio.stop(); } catch {} }
            remoteTracksRef.current.audio = user.audioTrack;
            user.audioTrack.play();
            log(`audio from uid ${user.uid}`);
          }
        } catch (e) { log('subscribe error: ' + (e?.message || e)); }
      });

      client.on('user-unpublished', (user) => {
        log(`user-unpublished ${user.uid}`);
      });

      // Stream message listener (if supported)
      if (client.on) {
        try {
          client.on('stream-message', (uid, pld) => {
            let s = '';
            if (pld instanceof Uint8Array) { s = new TextDecoder().decode(pld); } else { s = String(pld); }
            log(`recv[${uid}]: ${s}`);
          });
        } catch {}
      }

      await client.join(cred.agora_app_id, cred.agora_channel, cred.agora_token, cred.agora_uid || null);
      setJoined(true); log('Joined Agora channel');
      joinTsRef.current = Date.now();
      setElapsedSec(0);

      // Create data stream if available
      try {
        if (typeof client.createDataStream === 'function') {
          dataStreamIdRef.current = await client.createDataStream();
          log(`Data stream created: ${dataStreamIdRef.current}`);
        }
      } catch (e) { log('data stream not available: ' + (e?.message || e)); }
    } catch (e) {
      setError(e.message || 'Failed');
    } finally { setConnecting(false); }
  }

  async function sendChat() {
    setError(null);
    const client = clientRef.current;
    if (!client || !joined) { setError('Not joined'); return; }
    const payload = { v: 2, type: 'chat', mid: 'msg-' + Date.now(), idx: 0, fin: true, pld: { text: msg || '' } };
    let sent = false; const str = JSON.stringify(payload);
    try {
      if (typeof client.sendStreamMessage === 'function' && dataStreamIdRef.current != null) {
        await client.sendStreamMessage(dataStreamIdRef.current, str);
        sent = true;
      }
    } catch {}
    if (!sent) {
      try {
        if (typeof client.sendStreamMessage === 'function') { await client.sendStreamMessage(str, false); sent = true; }
      } catch {}
    }
    if (sent) { log('sent: ' + str); } else { setError('Data stream send not supported in this browser'); }
  }

  async function leave() {
    const client = clientRef.current; clientRef.current = null;
    try {
      if (remoteTracksRef.current.video) { try { remoteTracksRef.current.video.stop(); } catch {} }
      if (remoteTracksRef.current.audio) { try { remoteTracksRef.current.audio.stop(); } catch {} }
      remoteTracksRef.current = { video: null, audio: null };
      if (client) { await client.leave(); }
      setJoined(false); setSession(null);
      joinTsRef.current = 0; setElapsedSec(0);
      log('Left channel');
    } catch (e) { setError(e.message || 'Leave failed'); }
  }

  // Tick elapsed time while joined
  useEffect(() => {
    let t;
    if (joined && joinTsRef.current) {
      t = setInterval(() => { setElapsedSec(Math.max(0, (Date.now() - joinTsRef.current) / 1000)); }, 1000);
    }
    return () => { if (t) clearInterval(t); };
  }, [joined]);

  return (
    <div className="grid">
      <div className="col-12">
        <h3>Live Avatar (Akool + Agora)</h3>
      </div>
      <div className="col-6">
        <label className="small">Akool Bearer Token</label>
        <input value={akoolToken} onChange={(e) => setAkoolToken(e.target.value)} placeholder="akool token" />
        <div className="row" style={{ display: 'flex', gap: 8 }}>
          <div style={{ flex: 1 }}>
            <label className="small">avatar_id</label>
            <input value={avatarId} onChange={(e) => setAvatarId(e.target.value)} placeholder="dvp_Tristan_cloth2_1080P" />
          </div>
          <div style={{ flex: 1 }}>
            <label className="small">knowledge_id (optional)</label>
            <input value={knowledgeId} onChange={(e) => setKnowledgeId(e.target.value)} placeholder="" />
          </div>
        </div>
        <div className="row" style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
          <button className="primary" onClick={createSessionAndJoin} disabled={connecting || joined}>{connecting ? 'Connecting…' : (joined ? 'Connected' : 'Create & Join')}</button>
          <button onClick={leave} disabled={!joined}>Leave</button>
          {error && <span className="badge warn">{error}</span>}
        </div>
        <div className="row" style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
          <input style={{ flex: 1 }} value={msg} onChange={(e) => setMsg(e.target.value)} placeholder="Type a message to the avatar" />
          <button onClick={sendChat} disabled={!joined}>Send</button>
        </div>
        <div className="row">
          <h4 className="small" style={{ margin: 0 }}>Session</h4>
          <pre>{session ? JSON.stringify(session, null, 2) : '—'}</pre>
        </div>
        <div className="row">
          <h4 className="small" style={{ margin: 0 }}>Cost</h4>
          <div className="row" style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
            <span className="small">Elapsed:</span>
            <code>{elapsedSec ? `${elapsedSec.toFixed(1)} s` : (joined ? '0.0 s' : '—')}</code>
            <span className="small">Rate/min:</span>
            <input type="number" min="0" step="0.001" style={{ width: 120 }} value={avatarPerMin} onChange={(e) => setAvatarPerMin(Number(e.target.value))} />
            <span className="small">Est:</span>
            <code>{formatUSD((avatarPerMin || 0) * (elapsedSec / 60))}</code>
          </div>
        </div>
      </div>
      <div className="col-6">
        <div ref={containerRef} style={{ width: '100%', height: 360, background: '#111', borderRadius: 8, display: 'flex', alignItems: 'center', justifyContent: 'center', color: '#888' }}>
          {!joined && <span className="small">Join to view the avatar stream…</span>}
        </div>
        <div className="row">
          <h4 className="small" style={{ margin: 0 }}>Log</h4>
          <pre>{logs.length ? logs.join('\n') : '—'}</pre>
        </div>
      </div>
    </div>
  );
}

function SessionsPanel({ serverUrl, apiKey }) {
  const [sessions, setSessions] = useState([]);
  const [loading, setLoading] = useState(false);
  const [selected, setSelected] = useState(null);
  const [detail, setDetail] = useState(null);
  const [maxPrune, setMaxPrune] = useState(200);
  const [error, setError] = useState(null);

  const headers = useMemo(() => {
    const h = { 'Content-Type': 'application/json' };
    if (apiKey) h['X-API-Key'] = apiKey;
    return h;
  }, [apiKey]);

  async function refresh() {
    setLoading(true); setError(null);
    try {
      const data = await jsonFetch(joinUrl(serverUrl, '/api/v1/sessions'), { headers });
      setSessions(data.sessions || []);
    } catch (e) { setError(e.message || 'Failed'); }
    finally { setLoading(false); }
  }

  async function loadDetail(id) {
    setSelected(id); setDetail(null);
    try {
      const data = await jsonFetch(joinUrl(serverUrl, `/api/v1/sessions/${id}`), { headers });
      setDetail(data);
    } catch (e) { setDetail({ error: e.message, body: e.body }); }
  }

  async function del(id) {
    if (!confirm('Delete session ' + id + '?')) return;
    try { await jsonFetch(joinUrl(serverUrl, `/api/v1/sessions/${id}`), { method: 'DELETE', headers }); await refresh(); if (selected === id) { setSelected(null); setDetail(null); } } catch {}
  }

  async function prune() {
    try {
      const url = joinUrl(serverUrl, `/api/v1/sessions?max=${encodeURIComponent(Number(maxPrune || 0))}`);
      await jsonFetch(url, { method: 'DELETE', headers });
      await refresh();
    } catch {}
  }

  function download(id) {
    const s = sessions.find((x) => x.id === id);
    if (!s || !detail || detail.id !== id) return;
    const blob = new Blob([JSON.stringify(detail, null, 2)], { type: 'application/json' });
    const a = document.createElement('a');
    a.href = URL.createObjectURL(blob);
    a.download = `${id}.json`;
    document.body.appendChild(a); a.click(); a.remove();
    setTimeout(() => URL.revokeObjectURL(a.href), 1000);
  }

  useEffect(() => { refresh(); }, [serverUrl, apiKey]);

  return (
    <div className="grid">
      <div className="col-6">
        <div className="row" style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
          <button className="primary" onClick={refresh} disabled={loading}>{loading ? 'Loading…' : 'Refresh'}</button>
          <span className="small">{sessions.length} sessions</span>
          {error && <span className="badge warn">{error}</span>}
          <div style={{ marginLeft: 'auto', display: 'flex', gap: 8, alignItems: 'center' }}>
            <span className="small">Prune to max:</span>
            <input style={{ width: 80 }} type="number" min="1" value={maxPrune} onChange={(e) => setMaxPrune(e.target.value)} />
            <button onClick={prune}>Prune</button>
          </div>
        </div>
        <pre>
          {sessions.map((s) => (
            <div key={s.id} style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
              <button onClick={() => loadDetail(s.id)}>View</button>
              <button onClick={() => del(s.id)}>Delete</button>
              <code style={{ userSelect: 'all' }}>{s.id}</code>
              <span className="small">{s.eventCount} events</span>
            </div>
          ))}
        </pre>
      </div>
      <div className="col-6">
        <div className="row" style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
          <h3 style={{ margin: 0 }}>Session Detail</h3>
          {selected && <button onClick={() => download(selected)}>Download JSON</button>}
        </div>
        <pre>{detail ? JSON.stringify(detail, null, 2) : '—'}</pre>
      </div>
    </div>
  );
}

function SettingsPanel({ settings }) {
  return (
    <div className="grid">
      <div className="col-6">
        <h3>Defaults</h3>
        <div className="row">
          <label className="small"><input type="checkbox" checked={!!settings.wantTTS} onChange={(e) => settings.setWantTTS(e.target.checked)} /> Default TTS on ask</label>
        </div>
        <div className="row" style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
          <span className="small">Mic chunk interval (ms)</span>
          <input type="number" min="100" value={settings.chunkMs} onChange={(e) => settings.setChunkMs(Number(e.target.value))} />
        </div>
        <div className="row">
          <label className="small"><input type="checkbox" checked={!!settings.ttsAutoplay} onChange={(e) => settings.setTtsAutoplay(e.target.checked)} /> TTS autoplay queue</label>
        </div>
      </div>
    </div>
  );
}

function App() {
  const [serverUrl, setServerUrl] = useLocalStorage('serverUrl', 'http://localhost:8000');
  const [apiKey, setApiKey] = useLocalStorage('apiKey', '');
  const [activeTab, setActiveTab] = useState('stt');
  const [socketConnected, setSocketConnected] = useState(false);
  const [socketId, setSocketId] = useState(null);
  const socketRef = useRef(null);
  const [sessionIdMode, setSessionIdMode] = useLocalStorage('sessionIdMode', 'socket');
  const [sessionIdCustom, setSessionIdCustom] = useLocalStorage('sessionIdCustom', '');

  const [wantTTS, setWantTTS] = useLocalStorage('wantTTS', true);
  const [chunkMs, setChunkMs] = useLocalStorage('chunkMs', 300);
  const [ttsAutoplay, setTtsAutoplay] = useLocalStorage('ttsAutoplay', true);
  const settings = { wantTTS, setWantTTS, chunkMs, setChunkMs, ttsAutoplay, setTtsAutoplay };

  const sessionIdForRest = sessionIdMode === 'custom' ? (sessionIdCustom || '') : (socketId || '');

  function reconnect() {
    // tear down existing socket
    if (socketRef.current) {
      try { socketRef.current.disconnect(); } catch {}
      socketRef.current = null;
    }
    // connect new
    const auth = apiKey ? { apiKey } : undefined;
    const sock = io(serverUrl, { transports: ['websocket'], auth });
    socketRef.current = sock;
    sock.on('connect', () => { setSocketConnected(true); setSocketId(sock.id); });
    sock.on('disconnect', () => { setSocketConnected(false); setSocketId(null); });
  }

  useEffect(() => { reconnect(); return () => { if (socketRef.current) try { socketRef.current.disconnect(); } catch {} }; }, [serverUrl, apiKey]);

  function copySocketId() {
    if (!socketId) return;
    navigator.clipboard?.writeText(socketId).catch(() => {});
  }

  return (
    <div>
      <h1>AI Interviewer Evaluation Tool</h1>
      <TopBar
        serverUrl={serverUrl} setServerUrl={setServerUrl}
        apiKey={apiKey} setApiKey={setApiKey}
        socketId={socketId} socketConnected={socketConnected}
        reconnect={reconnect}
        sessionIdMode={sessionIdMode} setSessionIdMode={setSessionIdMode}
        sessionIdCustom={sessionIdCustom} setSessionIdCustom={setSessionIdCustom}
        copySocketId={copySocketId}
      />

      <div className="tabs">
        {['stt', 'llm', 'tts', 'avatar', 'sessions', 'health', 'settings'].map((t) => (
          <div key={t} className={`tab ${activeTab === t ? 'active' : ''}`} onClick={() => setActiveTab(t)}>
            {t.toUpperCase()
              .replace('AVATAR', 'Avatar')
              .replace('SESSIONS', 'Sessions')
              .replace('HEALTH', 'Health')
              .replace('SETTINGS', 'Settings')}
          </div>
        ))}
      </div>

      {activeTab === 'health' && (
        <HealthPanel serverUrl={serverUrl} apiKey={apiKey} />
      )}
      {activeTab === 'stt' && (
        <SttEvalPanel serverUrl={serverUrl} apiKey={apiKey} />
      )}
      {activeTab === 'llm' && (
        <LlmEvalPanel serverUrl={serverUrl} apiKey={apiKey} />
      )}
      {activeTab === 'tts' && (
        <TtsEvalPanel serverUrl={serverUrl} apiKey={apiKey} />
      )}
      {activeTab === 'avatar' && (
        <AvatarPanel />
      )}
      {activeTab === 'sessions' && (
        <SessionsPanel serverUrl={serverUrl} apiKey={apiKey} />
      )}
      {activeTab === 'settings' && (
        <SettingsPanel settings={settings} />
      )}

    </div>
  );
}

const root = ReactDOM.createRoot(document.getElementById('root'));
root.render(<App />);
