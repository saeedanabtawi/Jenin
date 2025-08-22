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
                  {k === 'llm' && 'Tip: Set OPENAI_API_KEY for openai, or use ollama.'}
                  {k === 'stt' && 'Tip: Set OPENAI_API_KEY for whisper or DEEPGRAM_API_KEY for deepgram.'}
                  {k === 'tts' && 'Tip: Set ELEVENLABS_API_KEY (or TTS_API_KEY) and TTS_VOICE.'}
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
          <pre>
            {transcript.map((l, i) => (
              <div key={i} style={{ color: l.tag === 'interim' ? '#9ca3af' : (l.tag === 'error' ? '#ef4444' : '#cbd5e1') }}>
                [{l.tag}] {l.text}
              </div>
            ))}
          </pre>
        </div>
        <div className="row">
          <h3>Reply</h3>
          <pre>{reply || '—'}</pre>
          <audio ref={audioEl} controls />
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
  const [activeTab, setActiveTab] = useState('interview');
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
      <h1>AI Interview Test Tool (React)</h1>
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
        {['interview', 'sessions', 'health', 'settings'].map((t) => (
          <div key={t} className={`tab ${activeTab === t ? 'active' : ''}`} onClick={() => setActiveTab(t)}>
            {t.charAt(0).toUpperCase() + t.slice(1)}
          </div>
        ))}
      </div>

      {activeTab === 'health' && (
        <HealthPanel serverUrl={serverUrl} apiKey={apiKey} />
      )}
      {activeTab === 'interview' && (
        <InterviewPanel
          serverUrl={serverUrl}
          apiKey={apiKey}
          socket={socketRef.current}
          socketConnected={socketConnected}
          socketId={socketId}
          settings={settings}
          sessionIdForRest={sessionIdForRest}
        />
      )}
      {activeTab === 'sessions' && (
        <SessionsPanel serverUrl={serverUrl} apiKey={apiKey} />
      )}
      {activeTab === 'settings' && (
        <SettingsPanel settings={settings} />
      )}

      <div className="row small" style={{ marginTop: 24 }}>
        <div>Tip: Hold Space for push-to-talk. REST calls include X-API-Key and X-Session-Id (socket ID or custom).</div>
      </div>
    </div>
  );
}

const root = ReactDOM.createRoot(document.getElementById('root'));
root.render(<App />);
