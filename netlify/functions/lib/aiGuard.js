// netlify/functions/lib/aiGuard.js
// A daily, app-wide ceiling on how many times the paid Anthropic API can be
// called, on top of the per-IP rate limiting in rateLimit.js. Per-IP limits
// alone don't protect against abuse spread across many different IPs (a
// botnet, or someone rotating proxies); this is the backstop that caps
// total spend regardless of where requests come from.
//
// This only gates gazette.js's live, on-demand calls (a real user's search
// or a category cache-miss) — the scheduled Monday refresh and Friday alert
// aren't user-triggered and don't check this budget.
//
// Lowered from 300 to compensate for lib/ai.js now letting the live path
// search up to 4 times per request instead of 1 (see LIVE_MAX_SEARCH_USES
// there) — each call can now cost several times what it used to, so the
// call-count ceiling needed to come down to keep worst-case daily spend in
// the same ballpark as before. 100 is still comfortably above normal daily
// traffic. Override with the AI_DAILY_CALL_LIMIT environment variable if
// needed.

const { getBlobStore } = require('./blobStore');

const STORE_NAME = 'ai-usage';
const DEFAULT_LIMIT = 100;

function store() {
  return getBlobStore(STORE_NAME);
}

function todayKey() {
  return new Date().toISOString().slice(0, 10); // YYYY-MM-DD (UTC)
}

// Returns { allowed, count, limit }. Increments the counter whenever it
// allows the call, so callers should check `allowed` first and skip the
// actual AI call entirely when it's false.
async function checkAndIncrementDailyBudget() {
  const limit = parseInt(process.env.AI_DAILY_CALL_LIMIT, 10) || DEFAULT_LIMIT;
  const key = todayKey();

  let count = 0;
  try {
    const existing = await store().get(key, { type: 'json' });
    count = (existing && typeof existing.count === 'number') ? existing.count : 0;
  } catch (e) {
    console.error('AI budget read:', e.message);
  }

  const allowed = count < limit;
  if (allowed) {
    try {
      await store().setJSON(key, { count: count + 1 });
    } catch (e) {
      console.error('AI budget write:', e.message);
    }
  }

  return { allowed: allowed, count: count, limit: limit };
}

module.exports = { checkAndIncrementDailyBudget };
