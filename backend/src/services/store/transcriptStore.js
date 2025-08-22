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
