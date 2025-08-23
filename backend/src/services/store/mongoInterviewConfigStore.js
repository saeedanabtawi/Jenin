'use strict';

const { MongoClient } = require('mongodb');

const MONGODB_URI = process.env.MONGODB_URI || '';
const MONGODB_DB = process.env.MONGODB_DB || 'ai_interview_test_tool';
const MONGODB_CONFIG_COLLECTION = process.env.MONGODB_CONFIG_COLLECTION || 'interview_configs';

let _client = null;
let _col = null;
let _connecting = null;

async function getCollection() {
  if (_col) return _col;
  if (!_connecting) {
    _connecting = (async () => {
      if (!MONGODB_URI) throw new Error('MONGODB_URI not set');
      _client = new MongoClient(MONGODB_URI, {});
      await _client.connect();
      const db = _client.db(MONGODB_DB);
      _col = db.collection(MONGODB_CONFIG_COLLECTION);
      await _col.createIndex({ config_id: 1 }, { unique: true });
      await _col.createIndex({ updatedAt: -1 });
      return _col;
    })().catch((e) => {
      _connecting = null;
      throw e;
    });
  }
  await _connecting;
  return _col;
}

function now() { return new Date(); }
function nowIso() { return new Date().toISOString(); }

const store = {
  async upsertConfig(input) {
    try {
      const col = await getCollection();
      const cfg = input && input.interview_config ? input.interview_config : input;
      if (!cfg || typeof cfg !== 'object') throw new Error('invalid config payload');
      const id = cfg.config_id || input.config_id;
      if (!id) throw new Error('config_id required');
      const doc = {
        config_id: id,
        name: cfg.name || '',
        phases_config: Array.isArray(cfg.phases_config) ? cfg.phases_config : [],
        interview_config: cfg,
        updatedAt: now(),
      };
      await col.updateOne(
        { config_id: id },
        { $setOnInsert: { createdAt: now() }, $set: doc },
        { upsert: true }
      );
      return await col.findOne({ config_id: id }, { projection: { _id: 0 } });
    } catch (e) {
      console.error('Mongo upsertConfig error:', e.message || e);
      // Non-persistent fallback
      const cfg = input && input.interview_config ? input.interview_config : input;
      return { interview_config: cfg, warning: 'Not persisted (DB not configured)' };
    }
  },

  async listConfigs() {
    try {
      const col = await getCollection();
      const cur = col.find({}, { projection: { _id: 0, config_id: 1, name: 1, updatedAt: 1, createdAt: 1 } }).sort({ updatedAt: -1 });
      return await cur.toArray();
    } catch (e) {
      console.error('Mongo listConfigs error:', e.message || e);
      return [];
    }
  },

  async getConfig(config_id) {
    try {
      const col = await getCollection();
      const doc = await col.findOne({ config_id }, { projection: { _id: 0 } });
      return doc || null;
    } catch (e) {
      console.error('Mongo getConfig error:', e.message || e);
      return null;
    }
  },

  async deleteConfig(config_id) {
    try {
      const col = await getCollection();
      const res = await col.deleteOne({ config_id });
      return res.deletedCount > 0;
    } catch (e) {
      console.error('Mongo deleteConfig error:', e.message || e);
      return false;
    }
  },
};

module.exports = store;
