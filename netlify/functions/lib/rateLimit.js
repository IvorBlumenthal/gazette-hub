// netlify/functions/lib/rateLimit.js
// Simple per-IP rate limiting backed by Netlify Blobs, used to stop a single
// visitor (or a script) from hammering a public endpoint. The gazette
// search/browse endpoint calls the paid Anthropic API on a cache miss, and
// the registration and subscribe endpoints write to Blobs and send email,
// so all three are worth capping.
//
// This is a plain fixed-window counter, not a precise sliding window, which
// is good enough to stop abuse without needing anything fancier.

const { getBlobStore } = require('./blobStore');

const STORE_NAME = 'rate-limits';

function store() {
  return getBlobStore(STORE_NAME);
}

function getClientIp(event) {
  return (
    event.headers['x-nf-client-connection-ip'] ||
    event.headers['client-ip'] ||
    (event.headers['x-forwarded-for'] || '').split(',')[0].trim() ||
    'unknown'
  );
}

// Returns { allowed, remaining }. `scope` namespaces different endpoints
// (e.g. "gazette", "register-visitor") so their limits don't share a bucket.
async function checkRateLimit(event, scope, maxRequests, windowSeconds) {
  const ip = getClientIp(event);
  const key = scope + ':' + ip;
  const now = Date.now();

  let record;
  try {
    record = await store().get(key, { type: 'json' });
  } catch (e) {
    console.error('Rate limit read:', e.message);
    record = null;
  }

  if (!record || now - record.windowStart > windowSeconds * 1000) {
    record = { windowStart: now, count: 0 };
  }

  record.count += 1;
  const allowed = record.count <= maxRequests;

  try {
    await store().setJSON(key, record);
  } catch (e) {
    console.error('Rate limit write:', e.message);
  }

  return { allowed: allowed, remaining: Math.max(0, maxRequests - record.count) };
}

module.exports = { checkRateLimit, getClientIp };
