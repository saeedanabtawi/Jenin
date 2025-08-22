'use strict';

const fs = require('fs');
const path = require('path');

const transcriptsDir = path.join(__dirname, '../../../data/transcripts');

function ensureDirSync(dir) {
  if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
}

class TranscriptStore {
  constructor() {
    this.sessions = new Map();
    ensureDirSync(transcriptsDir);
  }

  startSession(id) {
    const now = new Date().toISOString();
    const rec = { id, startedAt: now, endedAt: null, events: [] };
    this.sessions.set(id, rec);
    this._autoPrune();
    this._persist(id);
    return rec;
  }

  addEvent(id, event) {
    const rec = this.sessions.get(id) || this.startSession(id);
    const withTs = { ts: new Date().toISOString(), ...event };
    rec.events.push(withTs);
    this._persist(id);
    return withTs;
  }

  endSession(id) {
    const rec = this.sessions.get(id);
    if (!rec) return null;
    rec.endedAt = new Date().toISOString();
    this._persist(id);
    // keep it in memory for a while; caller may delete if desired
    return rec;
  }

  getSession(id) {
    return this.sessions.get(id) || null;
  }

  listSessions() {
    return Array.from(this.sessions.values()).map(({ id, startedAt, endedAt, events }) => ({ id, startedAt, endedAt, eventCount: events.length }));
  }

  deleteSession(id) {
    try {
      this.sessions.delete(id);
      const file = path.join(transcriptsDir, `${id}.json`);
      if (fs.existsSync(file)) fs.unlinkSync(file);
      return true;
    } catch {
      return false;
    }
  }

  prune(maxFiles) {
    const limit = Number(maxFiles || process.env.TRANSCRIPTS_MAX_FILES || 500);
    try {
      const files = fs.readdirSync(transcriptsDir)
        .filter((f) => f.endsWith('.json'))
        .map((f) => {
          const full = path.join(transcriptsDir, f);
          const st = fs.statSync(full);
          return { file: full, mtime: st.mtimeMs };
        })
        .sort((a, b) => a.mtime - b.mtime);

      if (files.length <= limit) return 0;
      const toDelete = files.length - limit;
      for (let i = 0; i < toDelete; i++) {
        try { fs.unlinkSync(files[i].file); } catch {}
      }
      return toDelete;
    } catch {
      return 0;
    }
  }

  _autoPrune() {
    const limit = Number(process.env.TRANSCRIPTS_MAX_FILES || 500);
    this.prune(limit);
  }

  _persist(id) {
    try {
      const rec = this.sessions.get(id);
      if (!rec) return;
      const file = path.join(transcriptsDir, `${id}.json`);
      fs.writeFileSync(file, JSON.stringify(rec, null, 2));
    } catch (e) {
      // eslint-disable-next-line no-console
      console.error('Transcript persist error:', e);
    }
  }
}

module.exports = new TranscriptStore();
