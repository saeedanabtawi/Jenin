'use strict';

const { S3Client, HeadBucketCommand, CreateBucketCommand, PutObjectCommand, GetObjectCommand } = require('@aws-sdk/client-s3');

let _client = null;

function enabled() {
  return Boolean(process.env.MINIO_ENDPOINT || process.env.S3_ENDPOINT || String(process.env.MINIO_ENABLED).toLowerCase() === 'true');
}

function getConfig() {
  const endpoint = process.env.MINIO_ENDPOINT || process.env.S3_ENDPOINT || 'http://localhost:9000';
  const accessKeyId = process.env.MINIO_ACCESS_KEY || process.env.S3_ACCESS_KEY || 'minioadmin';
  const secretAccessKey = process.env.MINIO_SECRET_KEY || process.env.S3_SECRET_KEY || 'minioadmin';
  const region = process.env.MINIO_REGION || process.env.S3_REGION || 'us-east-1';
  const bucket = process.env.MINIO_BUCKET || process.env.S3_BUCKET || 'ai-interview-audio';
  const useSSL = String(process.env.MINIO_USE_SSL || process.env.S3_USE_SSL || 'false').toLowerCase() === 'true';
  return { endpoint, accessKeyId, secretAccessKey, region, bucket, useSSL };
}

function client() {
  if (_client) return _client;
  const cfg = getConfig();
  _client = new S3Client({
    region: cfg.region,
    forcePathStyle: true,
    endpoint: cfg.endpoint,
    credentials: { accessKeyId: cfg.accessKeyId, secretAccessKey: cfg.secretAccessKey },
  });
  return _client;
}

async function ensureBucketExists() {
  const cfg = getConfig();
  const s3 = client();
  try {
    await s3.send(new HeadBucketCommand({ Bucket: cfg.bucket }));
  } catch (e) {
    try {
      await s3.send(new CreateBucketCommand({ Bucket: cfg.bucket }));
    } catch (err) {
      // If bucket already exists or owned by you, ignore
      if (String(err && err.name) !== 'BucketAlreadyOwnedByYou' && String(err && err.Code) !== 'BucketAlreadyOwnedByYou') {
        throw err;
      }
    }
  }
}

function generateKey(sessionId = 'session', ext = 'webm') {
  const ts = new Date();
  const yyyy = ts.getUTCFullYear();
  const mm = String(ts.getUTCMonth() + 1).padStart(2, '0');
  const dd = String(ts.getUTCDate()).padStart(2, '0');
  const time = String(ts.getTime());
  const clean = String(sessionId).replace(/[^a-zA-Z0-9_-]/g, '-');
  return `recordings/${yyyy}/${mm}/${dd}/${clean}/${time}.${ext}`;
}

async function putObject({ key, body, contentType = 'application/octet-stream' }) {
  const cfg = getConfig();
  const s3 = client();
  await s3.send(new PutObjectCommand({ Bucket: cfg.bucket, Key: key, Body: body, ContentType: contentType }));
  return { key };
}

async function getObjectStream(key) {
  const cfg = getConfig();
  const s3 = client();
  const out = await s3.send(new GetObjectCommand({ Bucket: cfg.bucket, Key: key }));
  const stream = out.Body; // Node.js Readable stream
  const contentType = out.ContentType || 'application/octet-stream';
  const contentLength = out.ContentLength;
  return { stream, contentType, contentLength };
}

async function init() {
  if (!enabled()) return;
  await ensureBucketExists();
}

module.exports = {
  enabled,
  init,
  client,
  getConfig,
  ensureBucketExists,
  generateKey,
  putObject,
  getObjectStream,
};
