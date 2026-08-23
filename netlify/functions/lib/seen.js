// netlify/functions/lib/seen.js
// Tracks which notices have already been seen for each category, so
// gazette-alert.js can tell what's genuinely new since the last weekly scan
// rather than re-flagging the same notices every time.
//
// Deliberately a separate store from gazette-cache: the cache holds "what to
// show on the site right now" and gets overwritten wholesale on every scan;
// this store only ever grows (new signatures are added, nothing is dropped)
// so a notice is never flagged as "new" twice.

const { getBlobStore } = require('./blobStore');

const STORE_NAME = 'gazette-seen';

function store() {
  return getBlobStore(STORE_NAME);
}

// A stable identifier for a notice — prefers gazette number (most specific),
// falls back to title+date if a notice has no gazette number.
function signature(notice) {
  const gazNo = (notice.gazette_no || '').trim().toLowerCase();
  const title = (notice.title || '').trim().toLowerCase();
  const date = (notice.date || '').trim();
  return gazNo ? (gazNo + '|' + title) : (title + '|' + date);
}

async function getSeen(categoryId) {
  try {
    const data = await store().get(categoryId, { type: 'json' });
    return Array.isArray(data) ? data : [];
  } catch (e) {
    console.error('Seen read:', e.message);
    return [];
  }
}

// Adds these notices' signatures to the seen list for a category (no
// duplicates) and returns which of the *input* notices were not already
// present — i.e. the genuinely new ones.
async function markSeenAndDiff(categoryId, notices) {
  const previouslySeen = new Set(await getSeen(categoryId));
  const newOnes = notices.filter(function (n) { return !previouslySeen.has(signature(n)); });

  const merged = new Set(previouslySeen);
  notices.forEach(function (n) { merged.add(signature(n)); });

  try {
    await store().setJSON(categoryId, Array.from(merged));
  } catch (e) {
    console.error('Seen write:', e.message);
  }

  return newOnes;
}

module.exports = { getSeen, markSeenAndDiff, signature };
