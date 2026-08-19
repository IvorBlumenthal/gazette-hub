// netlify/functions/lib/cache.js
// Caches AI-generated notices per category+period in Netlify Blobs, so a
// repeat request within the TTL window doesn't need a fresh (slower,
// costlier) AI call.
//
// This replaces an earlier Supabase-based cache: that Supabase project was
// found to have been deleted (most likely auto-deleted after months of
// inactivity), which had been silently disabling caching since some point
// after launch — the app degraded gracefully so nobody noticed. Netlify
// Blobs needs no external account and reuses the same storage that already
// powers the category admin panel, so there's nothing extra to keep alive.

const { getBlobStore } = require('./blobStore');

const STORE_NAME = 'gazette-cache';
const TTL_HOURS = 168; // 7 days

function cacheKey(categoryId, months) {
  return categoryId + '-' + months;
}

async function getCached(categoryId, months) {
  try {
    const store = getBlobStore(STORE_NAME);
    const entry = await store.get(cacheKey(categoryId, months), { type: 'json' });
    if (!entry || !Array.isArray(entry.notices) || entry.notices.length === 0) return null;
    const ageHours = (Date.now() - new Date(entry.updatedAt).getTime()) / 3600000;
    if (ageHours >= TTL_HOURS) return null;
    return entry.notices;
  } catch (e) {
    console.error('Cache read:', e.message);
    return null;
  }
}

async function setCached(categoryId, months, notices) {
  try {
    const store = getBlobStore(STORE_NAME);
    await store.setJSON(cacheKey(categoryId, months), { notices: notices, updatedAt: new Date().toISOString() });
    return true;
  } catch (e) {
    console.error('Cache write:', e.message);
    return false;
  }
}

module.exports = { getCached, setCached };
