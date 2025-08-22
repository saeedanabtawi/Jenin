'use strict';

const { MongoClient } = require('mongodb');

const MONGODB_URI = process.env.MONGODB_URI || '';
const MONGODB_DB = process.env.MONGODB_DB || 'ai_interview_test_tool';
const MONGODB_COLLECTION = process.env.MONGODB_COLLECTION || 'transcripts';

let _client = null;
let _col = null;
let _connecting = null;

async function getCollection() {
  if (_col) return _col;
  if (!_connecting) {
    _connecting = (async () => {
      if (!MONGODB_URI) throw new Error('MONGODB_URI not set');
      _client = new MongoClient(MONGODB_URI, {
        // modern topology by default in driver >=4
      });
      await _client.connect();
      const db = _client.db(MONGODB_DB);
      _col = db.collection(MONGODB_COLLECTION);
      // Ensure unique index on id field
      await _col.createIndex({ id: 1 }, { unique: true });
      await _col.createIndex({ createdAt: 1 });
      await _col.createIndex({ updatedAt: 1 });
      return _col;
    })().catch((e) => {
      // bubble up once; subsequent calls will retry
      _connecting = null;
      throw e;
    });
  }
  await _connecting;
  return _col;
}

function nowIso() { return new Date().toISOString(); }

const mongoStore = {
  async startSession(id) {
    try {
      const col = await getCollection();
      const now = nowIso();
      const base = { id, startedAt: now, endedAt: null, events: [], createdAt: new Date(), updatedAt: new Date() };
      await col.updateOne(
        { id },
        { $setOnInsert: base, $set: { updatedAt: new Date() } },
        { upsert: true }
      );
      return base;
    } catch (e) {
      console.error('Mongo startSession error:', e.message || e);
      return { id, startedAt: nowIso(), endedAt: null, events: [] };
    }
  },

  async addEvent(id, event) {
    try {
      const col = await getCollection();
      const withTs = { ts: nowIso(), ...event };
      const base = { id, startedAt: nowIso(), endedAt: null, events: [], createdAt: new Date(), updatedAt: new Date() };
      await col.updateOne(
        { id },
        { $setOnInsert: base, $push: { events: withTs }, $set: { updatedAt: new Date() } },
        { upsert: true }
      );
      return withTs;
    } catch (e) {
      console.error('Mongo addEvent error:', e.message || e);
      return { ts: nowIso(), ...event };
    }
  },

  async endSession(id) {
    try {
      const col = await getCollection();
      const endedAt = nowIso();
      await col.updateOne({ id }, { $set: { endedAt, updatedAt: new Date() } });
      return await col.findOne({ id });
    } catch (e) {
      console.error('Mongo endSession error:', e.message || e);
      return null;
    }
  },

  async getSession(id) {
    try {
      const col = await getCollection();
      const doc = await col.findOne({ id });
      if (!doc) return null;
      // Normalize fields for API parity
      const { _id, ...rest } = doc;
      return rest;
    } catch (e) {
      console.error('Mongo getSession error:', e.message || e);
      return null;
    }
  },

  async listSessions() {
    try {
      const col = await getCollection();
      const cursor = col.aggregate([
        { $project: {
          _id: 0,
          id: 1,
          startedAt: 1,
          endedAt: 1,
          eventCount: { $size: { $ifNull: ['$events', []] } },
          createdAt: 1,
        }},
        { $sort: { createdAt: -1 } },
      ]);
      const out = await cursor.toArray();
      return out.map(({ id, startedAt, endedAt, eventCount }) => ({ id, startedAt, endedAt, eventCount }));
    } catch (e) {
      console.error('Mongo listSessions error:', e.message || e);
      return [];
    }
  },

  async deleteSession(id) {
    try {
      const col = await getCollection();
      const res = await col.deleteOne({ id });
      return res.deletedCount > 0;
    } catch (e) {
      console.error('Mongo deleteSession error:', e.message || e);
      return false;
    }
  },

  async prune(maxFiles) {
    try {
      const col = await getCollection();
      const limit = Number(maxFiles || process.env.TRANSCRIPTS_MAX_FILES || 500);
      const count = await col.countDocuments();
      if (count <= limit) return 0;
      const toDeleteCount = count - limit;
      const oldest = await col.find({}, { projection: { id: 1, createdAt: 1 } })
        .sort({ createdAt: 1 })
        .limit(toDeleteCount)
        .toArray();
      const ids = oldest.map(d => d.id);
      if (ids.length === 0) return 0;
      const res = await col.deleteMany({ id: { $in: ids } });
      return res.deletedCount || 0;
    } catch (e) {
      console.error('Mongo prune error:', e.message || e);
      return 0;
    }
  },
};

module.exports = mongoStore;
