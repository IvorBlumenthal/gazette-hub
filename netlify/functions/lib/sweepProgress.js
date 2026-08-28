// netlify/functions/lib/sweepProgress.js
//
// Shared helper for a resumable "sweep" — a job that has to work through a
// list of items (category/period combinations, or just categories) but
// cannot reliably finish inside a single function invocation.
//
// Why this exists: Netlify kills a function Netlify's own scheduled cron
// invokes at a fixed, non-configurable 30 seconds; a manually-POSTed
// invocation (the admin panel's "Refresh all categories now" button, or a
// ?secret=... test run) gets 60 seconds — both confirmed via Netlify's docs
// and empirically (see netlify.toml / lib/ai.js for the history). A single
// AI search call can itself take the low tens of seconds. gazette-scheduler
// and gazette-alert used to loop over up to 24 combinations in one
// invocation, assuming a 900-second background-function budget that turned
// out to be dead configuration — in reality they were being killed after
// completing only 0-1 combinations, silently, for a long time.
//
// The fix isn't a bigger timeout (there isn't a bigger real one to ask for
// without a paid Background Functions upgrade, and even that only reaches
// 15 minutes, which the worst case here can still exceed). Instead, each
// invocation works through as many items as fit in its own safe time
// budget, saves progress to Blobs after every single item that succeeds,
// and picks up exactly where it left off next time — whether "next time" is
// the next cron tick a few minutes later or a second click of the admin
// button. See netlify.toml for the cron windows this relies on.

const { getBlobStore } = require('./blobStore');

function store(storeName) {
  return getBlobStore(storeName);
}

// A Monday-anchored ISO week id (e.g. "2026-W35"), used as the sweep's run
// id. This is what makes a new week automatically start a fresh sweep
// instead of "resuming" a run left over from a previous week — no separate
// cleanup job needed.
function isoWeekId(date) {
  const d = new Date(Date.UTC(date.getFullYear(), date.getMonth(), date.getDate()));
  const dayNum = (d.getUTCDay() + 6) % 7; // Monday = 0 ... Sunday = 6
  d.setUTCDate(d.getUTCDate() - dayNum + 3);
  const firstThursday = new Date(Date.UTC(d.getUTCFullYear(), 0, 4));
  const week = 1 + Math.round(((d - firstThursday) / 86400000 - 3 + ((firstThursday.getUTCDay() + 6) % 7)) / 7);
  return d.getUTCFullYear() + '-W' + String(week).padStart(2, '0');
}

// Loads this week's progress record, or starts a fresh one if none exists
// yet or the stored one belongs to a different (older) run id.
async function loadProgress(storeName, key, runId) {
  let data = null;
  try {
    data = await store(storeName).get(key, { type: 'json' });
  } catch (e) {
    console.error('Sweep progress read (' + storeName + '):', e.message);
  }
  if (data && data.runId === runId) return data;
  return { runId: runId, doneKeys: [], startedAt: new Date().toISOString(), completedAt: null };
}

async function saveProgress(storeName, key, progress) {
  try {
    await store(storeName).setJSON(key, progress);
  } catch (e) {
    console.error('Sweep progress write (' + storeName + '):', e.message);
  }
}

// How long a single invocation is allowed to keep working before it must
// stop and save, leaving the rest for a future invocation. Kept well under
// the real 30s/60s hard caps so there's room left for the surrounding
// handler code (loading data, writing the final progress record) to run
// after the loop exits on its own rather than being killed mid-write.
function timeBudgetMs(isManual) {
  return isManual ? 50000 : 24000;
}

// Marks a key done exactly once, even if two overlapping invocations (a
// cron tick landing at the same moment as a manual test run, say) both
// process the same item — rare, and harmless either way, but this keeps the
// doneKeys list from growing duplicate entries if it happens.
function markDone(progress, key) {
  if (progress.doneKeys.indexOf(key) === -1) progress.doneKeys.push(key);
}

module.exports = { isoWeekId, loadProgress, saveProgress, timeBudgetMs, markDone };
