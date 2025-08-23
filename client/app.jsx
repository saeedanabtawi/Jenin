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

function InterviewConfigPanel({ serverUrl, apiKey }) {
  const [configs, setConfigs] = useState([]);
  const [loading, setLoading] = useState(false);
  const [selectedId, setSelectedId] = useState('');
  const [editor, setEditor] = useState('');
  const [error, setError] = useState(null);
  const [saving, setSaving] = useState(false);
  const [mode, setMode] = useState('form'); // 'form' | 'json'
  const [formCfg, setFormCfg] = useState(null);
  const dragIndexRef = useRef(-1);
  const [newPhaseType, setNewPhaseType] = useState('technical');
  const [newPhaseSkill, setNewPhaseSkill] = useState('');
  const skillOptions = useMemo(() => {
    const arr = Array.isArray(formCfg?.skills_focus) ? formCfg.skills_focus : [];
    const set = new Set();
    arr.forEach((s) => { const k = (s?.skill || '').trim(); if (k) set.add(k); });
    return Array.from(set);
  }, [formCfg?.skills_focus]);
  const selectedCfg = useMemo(() => configs.find(c => c.config_id === selectedId) || null, [configs, selectedId]);

  const headers = useMemo(() => {
    const h = { 'Content-Type': 'application/json' };
    if (apiKey) h['X-API-Key'] = apiKey;
    return h;
  }, [apiKey]);

  async function refresh() {
    setLoading(true); setError(null);
    try {
      const data = await jsonFetch(joinUrl(serverUrl, '/api/v1/interview/configs'), { headers });
      setConfigs(Array.isArray(data.configs) ? data.configs : []);
    } catch (e) {
      setError(e.message || 'Failed to load');
    } finally { setLoading(false); }
  }

  async function loadOne(id) {
    setSelectedId(id); setError(null);
    try {
      const data = await jsonFetch(joinUrl(serverUrl, `/api/v1/interview/configs/${encodeURIComponent(id)}`), { headers });
      const cfg = data?.interview_config || data;
      const normalized = normalizeLoadedConfig(cfg);
      setEditor(JSON.stringify(normalized, null, 2));
      setFormCfg(normalized);
    } catch (e) { setError(e.message || 'Failed to load config'); }
  }

  function newFromTemplate() {
    const template = {
      // config_id will be generated on save
      name: 'Default 60-Min Interview',
      phases_config: [
        { type: 'introduction', phase_id: 'introduction', title: 'Introduction', enabled: true, order: 1, allocated_minutes: 5 },
        { type: 'technical', phase_id: 'technical_1', title: 'Technical Questions', enabled: true, order: 2, allocated_minutes: 8, user_answer_minutes: 8, ai_ask_seconds: 0, question_source: 'ai', skill: 'react.js' },
        { type: 'behavioral', phase_id: 'behavioral_1', title: 'Behavioral Question', enabled: true, order: 3, allocated_minutes: 4, user_answer_minutes: 4, ai_ask_seconds: 0, question_source: 'ai' },
        { type: 'coding', phase_id: 'coding_1', title: 'Coding Challenge', enabled: true, order: 4, allocated_minutes: 30, user_answer_minutes: 30, ai_ask_seconds: 0, question_source: 'ai', skill: 'node.js' },
      ],
      skills_focus: [
        { skill: 'react.js', level: 'senior' },
        { skill: 'node.js', level: 'mid' },
      ],
    };
    setSelectedId('');
    const normalized = normalizeLoadedConfig(template);
    setEditor(JSON.stringify(normalized, null, 2));
    setFormCfg(normalized);
  }

  function validateCfg(cfg) {
    const errs = [];
    if (!cfg || typeof cfg !== 'object' || Array.isArray(cfg)) {
      errs.push('interview_config must be an object');
      return { ok: false, errs };
    }
    if (!cfg.config_id || typeof cfg.config_id !== 'string') errs.push('config_id required (string)');
    if (!cfg.name || typeof cfg.name !== 'string') errs.push('name required (string)');
    if (!Array.isArray(cfg.phases_config)) errs.push('phases_config must be an array');
    else {
      cfg.phases_config.forEach((p, i) => {
        if (!p || typeof p !== 'object' || Array.isArray(p)) errs.push(`phases_config[${i}] must be object`);
        if (!p?.phase_id || typeof p.phase_id !== 'string') errs.push(`phases_config[${i}].phase_id required (string)`);
        if (!p?.title || typeof p.title !== 'string') errs.push(`phases_config[${i}].title required (string)`);
        if (typeof p?.enabled !== 'boolean') errs.push(`phases_config[${i}].enabled boolean required`);
        if (typeof p?.order !== 'number') errs.push(`phases_config[${i}].order number required`);
        if (typeof p?.allocated_minutes !== 'number') errs.push(`phases_config[${i}].allocated_minutes number required`);
      });
    }
    // Optional skills_focus validation
    if (cfg.skills_focus != null) {
      if (!Array.isArray(cfg.skills_focus)) errs.push('skills_focus must be an array');
      else cfg.skills_focus.forEach((s, i) => {
        if (!s || typeof s !== 'object' || Array.isArray(s)) { errs.push(`skills_focus[${i}] must be object`); return; }
        if (!s.skill || typeof s.skill !== 'string') errs.push(`skills_focus[${i}].skill required (string)`);
        if (s.level != null && !['junior','mid','senior'].includes(String(s.level))) errs.push(`skills_focus[${i}].level must be one of junior|mid|senior`);
        // weight removed from UI; tolerate if present
        if (s.weight != null && typeof s.weight !== 'number') errs.push(`skills_focus[${i}].weight must be number`);
      });
    }
    return { ok: errs.length === 0, errs };
  }

  function validateLocal() {
    try {
      const parsed = JSON.parse(editor || '{}');
      const cfg = parsed?.interview_config || parsed;
      const v = validateCfg(cfg);
      return { ok: v.ok, cfg, errs: v.errs };
    } catch (e) {
      return { ok: false, errs: ['JSON parse error: ' + (e?.message || e)] };
    }
  }

  function onFormChange(next) {
    setFormCfg(next);
    try { setEditor(JSON.stringify(next, null, 2)); } catch {}
  }

  // Basic field update helpers (form mode)
  function setBasic(field, value) {
    if (!formCfg) return;
    onFormChange({ ...formCfg, [field]: value });
  }
  // Helpers for phases and IDs
  function genConfigId() { return 'cfg-' + Date.now().toString(36); }
  function isIntroPhase(p) { return (p?.type === 'introduction') || (p?.phase_id === 'introduction'); }
  function titleFor(type, skill) {
    if (type === 'introduction') return 'Introduction';
    if (type === 'technical') return `Technical Questions${skill ? ` - ${skill}` : ''}`;
    if (type === 'behavioral') return `Behavioral Question${skill ? ` - ${skill}` : ''}`;
    if (type === 'coding') return `Coding Challenge${skill ? ` - ${skill}` : ''}`;
    return 'Phase';
  }
  function nextIdForType(arr, type) {
    const prefix = type === 'technical' ? 'technical' : (type === 'behavioral' ? 'behavioral' : (type === 'coding' ? 'coding' : 'phase'));
    const nums = arr
      .map(p => String(p?.phase_id || ''))
      .filter(id => id.startsWith(prefix + '_'))
      .map(id => Number(id.split('_')[1] || 0) || 0);
    const max = nums.reduce((m, n) => Math.max(m, n), 0);
    return `${prefix}_${max + 1}`;
  }
  function recalcOrders(arr) { return arr.map((p, idx) => ({ ...p, order: idx + 1 })); }
  function normalizeLoadedConfig(cfg) {
    const next = JSON.parse(JSON.stringify(cfg || {}));
    let arr = Array.isArray(next.phases_config) ? next.phases_config.slice() : [];
    // Map setup to introduction, infer types
    arr = arr.map((p) => {
      const q = { ...p };
      if (q.phase_id === 'setup') { q.phase_id = 'introduction'; q.title = 'Introduction'; q.type = 'introduction'; }
      if (!q.type) {
        const pid = String(q.phase_id || ''); const t = String(q.title || '');
        if (pid === 'introduction' || /intro/i.test(t)) q.type = 'introduction';
        else if (/tech/i.test(pid) || /Technical/i.test(t)) q.type = 'technical';
        else if (/behavior/i.test(pid) || /Behavioral/i.test(t)) q.type = 'behavioral';
        else if (/coding/i.test(pid) || /Coding/i.test(t)) q.type = 'coding';
        else q.type = 'technical';
      }
      if (typeof q.enabled !== 'boolean') q.enabled = true;
      if (typeof q.allocated_minutes !== 'number') q.allocated_minutes = 0;
      // Defaults for new per-phase fields (non-intro)
      if (q.type !== 'introduction') {
        if (!q.question_source) q.question_source = 'ai';
        if (typeof q.ai_ask_seconds !== 'number') q.ai_ask_seconds = 0;
        if (typeof q.user_answer_minutes !== 'number') q.user_answer_minutes = Number(q.allocated_minutes || 0);
      }
      q.title = titleFor(q.type, q.skill);
      return q;
    });
    // Ensure introduction exists and is first
    if (!arr.some(isIntroPhase)) {
      arr.unshift({ type: 'introduction', phase_id: 'introduction', title: 'Introduction', enabled: true, order: 1, allocated_minutes: 5 });
    }
    // Keep intro first, sort others by order
    arr.sort((a, b) => {
      if (isIntroPhase(a)) return -1; if (isIntroPhase(b)) return 1; return (Number(a.order || 0) - Number(b.order || 0));
    });
    arr = recalcOrders(arr);
    next.phases_config = arr;
    return next;
  }
  // Skills helpers
  function addSkill() {
    const arr = Array.isArray(formCfg?.skills_focus) ? formCfg.skills_focus.slice() : [];
    arr.push({ skill: '', level: 'mid' });
    onFormChange({ ...formCfg, skills_focus: arr });
  }
  function updateSkill(i, field, value) {
    const arr = Array.isArray(formCfg?.skills_focus) ? formCfg.skills_focus.slice() : [];
    if (!arr[i]) return;
    arr[i] = { ...arr[i], [field]: value };
    onFormChange({ ...formCfg, skills_focus: arr });
  }
  function removeSkill(i) {
    const arr = Array.isArray(formCfg?.skills_focus) ? formCfg.skills_focus.slice() : [];
    arr.splice(i, 1);
    onFormChange({ ...formCfg, skills_focus: arr });
  }
  // Phases helpers
  function addPhaseOfType(type, skill = '') {
    const arr = Array.isArray(formCfg?.phases_config) ? formCfg.phases_config.slice() : [];
    let out = arr.slice();
    if (!out.some(isIntroPhase)) {
      out.unshift({ type: 'introduction', phase_id: 'introduction', title: 'Introduction', enabled: true, order: 1, allocated_minutes: 5 });
    }
    const id = nextIdForType(out, type);
    const defMin = type === 'coding' ? 30 : (type === 'behavioral' ? 4 : 8);
    out.push({
      type,
      phase_id: id,
      title: titleFor(type, skill),
      enabled: true,
      order: out.length + 1,
      allocated_minutes: defMin,
      user_answer_minutes: defMin,
      ai_ask_seconds: 0,
      question_source: 'ai',
      skill,
    });
    out = recalcOrders(out);
    onFormChange({ ...formCfg, phases_config: out });
  }
  function updatePhase(i, field, value) {
    const arr = Array.isArray(formCfg?.phases_config) ? formCfg.phases_config.slice() : [];
    if (!arr[i]) return;
    const p = { ...arr[i], [field]: value };
    if (field === 'type') {
      const id = isIntroPhase(p) ? 'introduction' : nextIdForType(arr, value);
      p.phase_id = id;
      p.title = titleFor(value, p.skill);
      p.enabled = true;
    }
    if (field === 'skill') {
      p.title = titleFor(p.type, value);
    }
    if (field === 'allocated_minutes') {
      const n = Number(value || 0);
      p.allocated_minutes = isFinite(n) && n >= 0 ? n : 0;
    }
    if (field === 'user_answer_minutes') {
      const m = Number(value || 0);
      p.user_answer_minutes = isFinite(m) && m >= 0 ? m : 0;
      p.allocated_minutes = p.user_answer_minutes;
    }
    if (field === 'ai_ask_seconds') {
      const s = Number(value || 0);
      p.ai_ask_seconds = isFinite(s) && s >= 0 ? s : 0;
    }
    if (field === 'question_source' && value !== 'custom') {
      p.custom_question = '';
    }
    arr[i] = p;
    onFormChange({ ...formCfg, phases_config: arr });
  }
  function removePhase(i) {
    const arr = Array.isArray(formCfg?.phases_config) ? formCfg.phases_config.slice() : [];
    if (arr[i] && isIntroPhase(arr[i])) return; // cannot remove introduction
    arr.splice(i, 1);
    const out = recalcOrders(arr);
    onFormChange({ ...formCfg, phases_config: out });
  }
  function onPhaseDragStart(i) { dragIndexRef.current = i; }
  function onPhaseDragOver(e) { try { e.preventDefault(); } catch {} }
  function onPhaseDrop(i) {
    const from = dragIndexRef.current;
    const to = i;
    dragIndexRef.current = -1;
    if (from == null || from < 0 || to == null || to < 0) return;
    const arr = Array.isArray(formCfg?.phases_config) ? formCfg.phases_config.slice() : [];
    if (!arr[from] || !arr[to]) return;
    if (isIntroPhase(arr[from]) || isIntroPhase(arr[to]) || to === 0 || from === 0) return; // keep intro fixed
    const item = arr[from];
    arr.splice(from, 1);
    arr.splice(to, 0, item);
    const out = recalcOrders(arr);
    onFormChange({ ...formCfg, phases_config: out });
  }
  // removed old Unlimited toggle; using user_answer_minutes instead

  async function save() {
    setSaving(true); setError(null);
    try {
      let cfg;
      if (mode === 'form') {
        const cfgWithId = (!formCfg?.config_id) ? { ...formCfg, config_id: genConfigId() } : formCfg;
        // Keep allocated_minutes in sync with user_answer_minutes for non-intro phases
        const synced = {
          ...cfgWithId,
          phases_config: Array.isArray(cfgWithId.phases_config) ? cfgWithId.phases_config.map((p) => {
            if (isIntroPhase(p)) return p;
            const m = Number(p.user_answer_minutes || 0);
            return { ...p, allocated_minutes: (isFinite(m) && m >= 0) ? m : 0 };
          }) : []
        };
        const v = validateCfg(synced || {});
        if (!v.ok) { setError(v.errs.join('\n')); return; }
        cfg = synced;
        if (cfgWithId !== formCfg) onFormChange(cfgWithId);
      } else {
        const v = validateLocal();
        if (!v.ok) { setError(v.errs.join('\n')); return; }
        cfg = v.cfg;
      }
      const id = cfg.config_id;
      if (!id) { setError('config_id required'); return; }
      // If selectedId matches, do PUT; else POST
      if (selectedId && selectedId === id) {
        await jsonFetch(joinUrl(serverUrl, `/api/v1/interview/configs/${encodeURIComponent(id)}`), {
          method: 'PUT', headers, body: JSON.stringify({ interview_config: cfg })
        });
      } else {
        await jsonFetch(joinUrl(serverUrl, '/api/v1/interview/configs'), {
          method: 'POST', headers, body: JSON.stringify({ interview_config: cfg })
        });
      }
      setSelectedId(id);
      await refresh();
    } catch (e) { setError(e.message || 'Save failed'); }
    finally { setSaving(false); }
  }

  async function del(id) {
    if (!id) return;
    if (!confirm(`Delete config ${id}?`)) return;
    try {
      await jsonFetch(joinUrl(serverUrl, `/api/v1/interview/configs/${encodeURIComponent(id)}`), { method: 'DELETE', headers });
      if (selectedId === id) { setSelectedId(''); setEditor(''); }
      await refresh();
    } catch (e) { setError(e.message || 'Delete failed'); }
  }

  useEffect(() => { refresh(); }, [serverUrl, apiKey]);

  return (
    <div className="grid">
      <div className="col-6">
        <div className="row" style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
          <button className="primary" onClick={refresh} disabled={loading}>{loading ? 'Loading…' : 'Refresh'}</button>
          <button onClick={newFromTemplate}>New from template</button>
          {error && <span className="badge warn">{error}</span>}
        </div>
        <pre>
          {configs.length === 0 && <div className="small">No configs yet</div>}
          {configs.map((c) => (
            <div key={c.config_id} style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
              <button onClick={() => loadOne(c.config_id)}>Load</button>
              <button onClick={() => del(c.config_id)}>Delete</button>
              <span className="small">{c.name || '(untitled config)'}</span>
            </div>
          ))}
        </pre>
      </div>
      <div className="col-6">
        <div className="row" style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
          <h3 style={{ margin: 0 }}>Interview Config Editor</h3>
          {selectedId && <span className="small">Selected: {selectedCfg?.name || selectedId}</span>}
          <button onClick={save} disabled={saving}>{saving ? 'Saving…' : 'Save'}</button>
          <button onClick={() => {
            if (mode === 'form') {
              const tmp = (!formCfg?.config_id) ? { ...formCfg, config_id: genConfigId() } : formCfg;
              const v = validateCfg(tmp || {});
              setError(v.ok ? 'Valid ✓' : (v.errs.join('\n')));
            } else {
              const v = validateLocal();
              setError(v.ok ? 'Valid ✓' : (v.errs.join('\n')));
            }
          }}>Validate</button>
          <div style={{ marginLeft: 'auto', display: 'flex', gap: 6, alignItems: 'center' }}>
            <span className="small">Editor:</span>
            <button className={mode === 'form' ? 'primary' : ''} onClick={() => {
              if (mode !== 'form') {
                // Try to hydrate form from current JSON
                try {
                  const parsed = JSON.parse(editor || '{}');
                  const cfg = parsed?.interview_config || parsed;
                  setFormCfg(normalizeLoadedConfig(cfg));
                } catch {}
              }
              setMode('form');
            }}>Form</button>
            <button className={mode === 'json' ? 'primary' : ''} onClick={() => setMode('json')}>JSON</button>
          </div>
        </div>
        {mode === 'json' ? (
          <>
            <textarea value={editor} onChange={(e) => setEditor(e.target.value)} style={{ width: '100%', height: 380, fontFamily: 'monospace' }} placeholder="Paste JSON for interview_config or wrap as { interview_config: {...} }" />
          </>
        ) : (
          <>
            {!formCfg && <div className="row"><span className="badge warn">Form not initialized. Load or create a config, or switch to JSON.</span></div>}
            {formCfg && (
              <div className="grid">
                <div className="col-12">
                  <h4 style={{ marginTop: 0 }}>Basics</h4>
                  <div className="row" style={{ display: 'flex', gap: 8 }}>
                    <div style={{ flex: 1 }}>
                      <label className="small">Name</label>
                      <input value={formCfg.name || ''} onChange={(e) => setBasic('name', e.target.value)} placeholder="Display name" />
                    </div>
                  </div>
                </div>

                <div className="col-12">
                  <h4>Skills Focus</h4>
                  {(!Array.isArray(formCfg.skills_focus) || formCfg.skills_focus.length === 0) && (
                    <div className="small">No skills yet. Add some.</div>
                  )}
                  {Array.isArray(formCfg.skills_focus) && formCfg.skills_focus.map((s, i) => (
                    <div key={i} className="row" style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
                      <input style={{ flex: 2 }} placeholder="Skill (e.g., react.js)" value={s.skill || ''} onChange={(e) => updateSkill(i, 'skill', e.target.value)} />
                      <select style={{ flex: 1 }} value={String(s.level || 'mid')} onChange={(e) => updateSkill(i, 'level', e.target.value)}>
                        <option value="junior">junior</option>
                        <option value="mid">mid</option>
                        <option value="senior">senior</option>
                      </select>
                      <button className="ghost" onClick={() => removeSkill(i)}>Remove</button>
                    </div>
                  ))}
                  <div className="row"><button onClick={addSkill}>Add Skill</button></div>
                </div>

                <div className="col-12">
                  <h4>Phases</h4>
                  {(!Array.isArray(formCfg.phases_config) || formCfg.phases_config.length === 0) && (
                    <div className="small">No phases yet. Add phases describing the interview flow.</div>
                  )}
                  {Array.isArray(formCfg.phases_config) && formCfg.phases_config.map((p, i) => {
                    const isIntro = isIntroPhase(p);
                    return (
                      <div
                        key={i}
                        className="row"
                        style={{ border: '1px solid #e5e7eb', borderRadius: 8, padding: 8, marginBottom: 8, opacity: isIntro ? 0.95 : 1 }}
                        draggable={!isIntro}
                        onDragStart={() => onPhaseDragStart(i)}
                        onDragOver={onPhaseDragOver}
                        onDrop={() => onPhaseDrop(i)}
                      >
                        <div className="row" style={{ display: 'flex', gap: 8, alignItems: 'center', flexWrap: 'wrap' }}>
                          <div title={isIntro ? 'Introduction is fixed' : 'Drag to reorder'} style={{ cursor: isIntro ? 'default' : 'grab', userSelect: 'none' }}>⠿</div>
                          <div style={{ flex: '1 1 220px', minWidth: 0 }}>
                            <label className="small">Type</label>
                            {isIntro ? (
                              <div>Introduction</div>
                            ) : (
                              <select value={p.type || 'technical'} onChange={(e) => updatePhase(i, 'type', e.target.value)}>
                                <option value="technical">Technical Questions</option>
                                <option value="behavioral">Behavioral Requisition</option>
                                <option value="coding">Coding Challenges</option>
                              </select>
                            )}
                          </div>
                          {!isIntro && (
                            <div style={{ flex: '1 1 220px', minWidth: 0 }}>
                              <label className="small">Skill</label>
                              <select value={p.skill || ''} onChange={(e) => updatePhase(i, 'skill', e.target.value)}>
                                <option value="">(none)</option>
                                {skillOptions.map((opt) => (<option key={opt} value={opt}>{opt}</option>))}
                              </select>
                            </div>
                          )}
                          {isIntro ? (
                            <div style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
                              <div>
                                <label className="small">Duration minutes</label>
                                <input type="number" style={{ width: 120 }} min="0"
                                       value={Number(p.allocated_minutes || 0)}
                                       onChange={(e) => updatePhase(i, 'allocated_minutes', Number(e.target.value))} />
                              </div>
                            </div>
                          ) : (
                            <>
                              <div style={{ flex: '2 1 360px', minWidth: 0 }}>
                                <label className="small">Question</label>
                                <div style={{ display: 'flex', gap: 8, alignItems: 'center', flexWrap: 'wrap' }}>
                                  <select value={p.question_source || 'ai'} onChange={(e) => updatePhase(i, 'question_source', e.target.value)}>
                                    <option value="ai">AI generated</option>
                                    <option value="custom">Custom</option>
                                  </select>
                                  {p.question_source === 'custom' && (
                                    <input style={{ flex: 1, minWidth: 0 }} placeholder="Enter your question"
                                           value={p.custom_question || ''}
                                           onChange={(e) => updatePhase(i, 'custom_question', e.target.value)} />
                                  )}
                                </div>
                              </div>
                              <div style={{ display: 'flex', gap: 8, alignItems: 'center', flexWrap: 'wrap' }}>
                                <div>
                                  <label className="small">AI ask time (sec)</label>
                                  <input type="number" style={{ width: 120 }} min="0"
                                         value={Number(p.ai_ask_seconds || 0)}
                                         onChange={(e) => updatePhase(i, 'ai_ask_seconds', Number(e.target.value))} />
                                </div>
                                <div>
                                  <label className="small">User answer limit (min)</label>
                                  <input type="number" style={{ width: 140 }} min="0"
                                         value={Number(p.user_answer_minutes || 0)}
                                         onChange={(e) => updatePhase(i, 'user_answer_minutes', Number(e.target.value))} />
                                  <div className="small" style={{ opacity: 0.6 }}>0 = unlimited</div>
                                </div>
                              </div>
                            </>
                          )}
                          {!isIntro && (
                            <button className="ghost" style={{ marginLeft: 'auto', flex: '0 0 auto' }} onClick={() => removePhase(i)}>Remove</button>
                          )}
                        </div>
                        <div className="small" style={{ opacity: 0.7, marginTop: 4 }}>Title: {titleFor(p.type, p.skill)}</div>
                      </div>
                    );
                  })}
                  <div className="row" style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
                    <span className="small">Add phase:</span>
                    <select value={newPhaseType} onChange={(e) => setNewPhaseType(e.target.value)}>
                      <option value="technical">Technical Questions</option>
                      <option value="behavioral">Behavioral Requisition</option>
                      <option value="coding">Coding Challenges</option>
                    </select>
                    <select value={newPhaseSkill} onChange={(e) => setNewPhaseSkill(e.target.value)}>
                      <option value="">(no skill)</option>
                      {skillOptions.map((opt) => (<option key={opt} value={opt}>{opt}</option>))}
                    </select>
                    <button onClick={() => addPhaseOfType(newPhaseType, newPhaseSkill)}>Add</button>
                  </div>
                </div>
              </div>
            )}
          </>
        )}
        {error && <div className="row"><span className="badge warn">{error}</span></div>}
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

function StartInterviewPanel({ serverUrl, apiKey, settings }) {
  const [configs, setConfigs] = useState([]);
  const [selectedId, setSelectedId] = useState('');
  const [cfg, setCfg] = useState(null);
  const [starting, setStarting] = useState(false);
  const [started, setStarted] = useState(false);
  const [steps, setSteps] = useState([]); // [{ phase, question, limitSec }]
  const [idx, setIdx] = useState(0);
  const [question, setQuestion] = useState('');
  const [speaking, setSpeaking] = useState(false);
  const [canAnswer, setCanAnswer] = useState(false);
  const [answerLeft, setAnswerLeft] = useState(0);
  const [recording, setRecording] = useState(false);
  const audioRef = useRef(null);
  const media = useRef({ stream: null, recorder: null, raf: 0, ctx: null, analyser: null });
  const timerRef = useRef(0);

  function mmss(s) {
    const n = Math.max(0, Math.floor(s));
    const m = Math.floor(n / 60);
    const r = n % 60;
    return `${String(m).padStart(2,'0')}:${String(r).padStart(2,'0')}`;
  }

  async function refreshConfigs() {
    try {
      const list = await jsonFetch(joinUrl(serverUrl, '/api/v1/interview/configs'));
      setConfigs(list?.configs || []);
    } catch {}
  }

  async function loadConfig(id) {
    if (!id) { setCfg(null); return; }
    try {
      const data = await jsonFetch(joinUrl(serverUrl, `/api/v1/interview/configs/${encodeURIComponent(id)}`));
      const base = data?.interview_config || data;
      // light normalization for run
      const arr = (Array.isArray(base?.phases_config) ? base.phases_config : []).slice()
        .map((p) => ({
          ...p,
          type: p.type || (p.phase_id === 'introduction' ? 'introduction' : 'technical'),
          allocated_minutes: typeof p.allocated_minutes === 'number' ? p.allocated_minutes : 0,
          question_source: p.question_source || (p.type === 'introduction' ? undefined : 'ai'),
          ai_ask_seconds: typeof p.ai_ask_seconds === 'number' ? p.ai_ask_seconds : 0,
          user_answer_minutes: typeof p.user_answer_minutes === 'number' ? p.user_answer_minutes : (p.type === 'introduction' ? p.allocated_minutes : p.allocated_minutes),
        }))
        .sort((a, b) => (Number(a.order || 0) - Number(b.order || 0)));
      setCfg({ ...base, phases_config: arr });
    } catch {}
  }

  useEffect(() => { refreshConfigs(); }, [serverUrl, apiKey]);
  useEffect(() => { loadConfig(selectedId); }, [selectedId, serverUrl, apiKey]);

  function applicablePhase(p) {
    if (!p?.enabled) return false;
    const t = String(p.type || '');
    if (t === 'introduction') return false;
    if (t === 'coding') return false; // skip coding per request
    return true; // technical, behavioral, others
  }

  async function genQuestion(p) {
    if (p.question_source === 'custom' && (p.custom_question || '').trim()) {
      return String(p.custom_question).trim();
    }
    // AI generation: short, no preamble
    const headers = { 'Content-Type': 'application/json' };
    if (apiKey) headers['X-API-Key'] = apiKey;
    const skill = p.skill ? ` about ${p.skill}` : '';
    const prompt = `Generate ONE concise ${p.type} interview question${skill}. Only output the question text, under 120 characters. No preface, numbering, or quotes.`;
    const data = await jsonFetch(joinUrl(serverUrl, '/api/v1/eval/llm'), {
      method: 'POST', headers, body: JSON.stringify({ prompt })
    });
    return (data?.text || '').trim().replace(/^"|"$/g, '');
  }

  async function speak(text, p) {
    // local helper to simulate TTS duration
    const simulate = async (secHint) => {
      setSpeaking(true);
      setCanAnswer(false);
      const secs = Math.max(
        1,
        Number(secHint || 0) || Math.ceil(Math.min(8, Math.max(2, String(text || '').split(/\s+/).length / 2)))
      );
      await new Promise((r) => setTimeout(r, secs * 1000));
      setSpeaking(false);
      setCanAnswer(true);
    };

    if (!settings.wantTTS) {
      await simulate(p?.ai_ask_seconds);
      return;
    }

    const headers = { 'Content-Type': 'application/json' };
    if (apiKey) headers['X-API-Key'] = apiKey;
    setCanAnswer(false);
    try {
      const data = await jsonFetch(joinUrl(serverUrl, '/api/v1/eval/tts'), {
        method: 'POST', headers, body: JSON.stringify({ text })
      });
      const url = `data:${data.mime};base64,${data.audioBase64}`;
      const el = audioRef.current;
      await new Promise((resolve) => {
        el.onplay = () => { setSpeaking(true); };
        el.onended = () => { setSpeaking(false); resolve(); };
        el.onerror = () => { setSpeaking(false); resolve(); };
        el.src = url; el.play().catch(() => { setSpeaking(false); resolve(); });
      });
    } catch (e) {
      // Fallback if TTS fails (e.g., provider not configured)
      await simulate(p?.ai_ask_seconds);
    } finally {
      setCanAnswer(true);
    }
  }

  function clearTimer() {
    if (timerRef.current) { clearInterval(timerRef.current); timerRef.current = 0; }
  }

  function startAnswerTimer(limitSec) {
    clearTimer();
    if (!limitSec || limitSec <= 0) { setAnswerLeft(0); return; }
    setAnswerLeft(limitSec);
    timerRef.current = setInterval(() => {
      setAnswerLeft((prev) => {
        const next = Math.max(0, prev - 1);
        if (next === 0) { clearTimer(); if (recording) stopRec(true); else finishAnswer(); }
        return next;
      });
    }, 1000);
  }

  async function startInterview() {
    if (!cfg) return;
    setStarting(true);
    try {
      const applicable = (cfg.phases_config || []).filter(applicablePhase);
      const runSteps = applicable.map((p) => ({ phase: p, question: '', limitSec: Math.max(0, Math.floor((Number(p.user_answer_minutes || 0)) * 60)) }));
      setSteps(runSteps); setIdx(0); setStarted(true);
      await askStep(0, runSteps);
    } finally {
      setStarting(false);
    }
  }

  async function askStep(i, list = steps) {
    if (!list[i]) { setQuestion(''); setCanAnswer(false); return; }
    const p = list[i].phase;
    setCanAnswer(false); setQuestion('Preparing question…');
    const q = await genQuestion(p).catch(() => '(question)');
    setQuestion(q);
    await speak(q, p);
    startAnswerTimer(list[i].limitSec);
  }

  async function finishAnswer() {
    // move to next step or finish
    const next = idx + 1;
    if (next >= steps.length) {
      setStarted(false); setQuestion(''); setSteps([]); clearTimer(); setAnswerLeft(0); setIdx(0); setCanAnswer(false);
      return;
    }
    setIdx(next);
    await askStep(next);
  }

  async function startRec() {
    try {
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
      const recorder = new MediaRecorder(stream, { mimeType: 'audio/webm' });
      const chunks = [];
      recorder.ondataavailable = (e) => { if (e.data && e.data.size > 0) chunks.push(e.data); };
      recorder.onstop = async () => {
        try {
          const blob = new Blob(chunks, { type: 'audio/webm' });
          const arr = await blob.arrayBuffer();
          const b64 = btoa(String.fromCharCode(...new Uint8Array(arr)));
          const headers = { 'Content-Type': 'application/json' };
          if (apiKey) headers['X-API-Key'] = apiKey;
          await jsonFetch(joinUrl(serverUrl, '/api/v1/eval/stt'), { method: 'POST', headers, body: JSON.stringify({ audioBase64: b64, mimetype: 'audio/webm' }) });
        } catch {}
        // advance regardless of STT success
        try { stream.getTracks().forEach(t => t.stop()); } catch {}
        setRecording(false);
        finishAnswer();
      };
      // simple VU meter (optional)
      const ctx = new AudioContext(); const src = ctx.createMediaStreamSource(stream); const analyser = ctx.createAnalyser(); analyser.fftSize = 512; src.connect(analyser);
      const data = new Uint8Array(analyser.fftSize);
      const loop = () => { analyser.getByteTimeDomainData(data); media.current.raf = requestAnimationFrame(loop); };
      media.current = { stream, recorder, raf: requestAnimationFrame(loop), ctx, analyser };
      recorder.start(200);
      setRecording(true);
    } catch (e) {
      alert('Mic error: ' + (e?.message || e));
    }
  }

  function stopRec(auto = false) {
    const m = media.current;
    if (m.recorder && m.recorder.state !== 'inactive') m.recorder.stop();
    if (m.raf) cancelAnimationFrame(m.raf);
    if (m.ctx) m.ctx.close().catch(() => {});
    if (!auto) { try { m.stream?.getTracks()?.forEach(t => t.stop()); } catch {} }
  }

  return (
    <div className="grid">
      <div className="col-12">
        <h3>Start Interview</h3>
        {!started && (
          <div className="row" style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
            <span className="small">Interview config:</span>
            <select value={selectedId} onChange={(e) => setSelectedId(e.target.value)}>
              <option value="">Select config…</option>
              {configs.map(c => (<option key={c.config_id} value={c.config_id}>{c.name || c.config_id}</option>))}
            </select>
            <button onClick={refreshConfigs}>Refresh</button>
            <button className="primary" onClick={startInterview} disabled={!cfg || starting}>{starting ? 'Starting…' : 'Start'}</button>
          </div>
        )}
      </div>

      {started && (
        <div className="col-12" style={{ position: 'relative', minHeight: 320, background: 'rgba(148,163,184,0.08)', borderRadius: 12, padding: 16 }}>
          {/* Answer timer top-left */}
          <div style={{ position: 'absolute', top: 12, left: 12, fontWeight: 600 }}>
            {answerLeft > 0 ? `Time left: ${mmss(answerLeft)}` : 'Unlimited'}
          </div>
          {/* Question on top */}
          <div style={{ textAlign: 'center', marginTop: 24, minHeight: 28 }}>
            <div style={{ fontSize: 18, fontWeight: 600 }}>{question}</div>
          </div>
          {/* Voice animation center */}
          <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', marginTop: 32, marginBottom: 24 }}>
            <div className={`voice-circle ${speaking ? 'active' : ''}`}></div>
          </div>
          {/* Control button */}
          <div style={{ display: 'flex', justifyContent: 'center' }}>
            {!recording ? (
              <button className="primary" onClick={startRec} disabled={!canAnswer}>Start answering</button>
            ) : (
              <button onClick={() => stopRec(false)}>Stop recording</button>
            )}
          </div>
          <audio ref={audioRef} hidden />
        </div>
      )}
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
        {['start', 'stt', 'llm', 'tts', 'avatar', 'sessions', 'interview-config', 'health', 'settings'].map((t) => (
          <div key={t} className={`tab ${activeTab === t ? 'active' : ''}`} onClick={() => setActiveTab(t)}>
            {t.toUpperCase()
              .replace('START', 'Start Interview')
              .replace('AVATAR', 'Avatar')
              .replace('SESSIONS', 'Sessions')
              .replace('INTERVIEW-CONFIG', 'Interview Config')
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
      {activeTab === 'start' && (
        <StartInterviewPanel serverUrl={serverUrl} apiKey={apiKey} settings={settings} />
      )}
      {activeTab === 'avatar' && (
        <AvatarPanel />
      )}
      {activeTab === 'sessions' && (
        <SessionsPanel serverUrl={serverUrl} apiKey={apiKey} />
      )}
      {activeTab === 'interview-config' && (
        <InterviewConfigPanel serverUrl={serverUrl} apiKey={apiKey} />
      )}
      {activeTab === 'settings' && (
        <SettingsPanel settings={settings} />
      )}

    </div>
  );
}

const root = ReactDOM.createRoot(document.getElementById('root'));
root.render(<App />);
