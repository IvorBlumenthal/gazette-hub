// netlify/functions/gazette-scheduler.js
// Pre-fetches gazette notices for every active category x period combination
// and caches them in Netlify Blobs, so the app loads instantly without
// waiting for a live AI call.
//
// This is a RESUMABLE SWEEP, not a single-shot loop — see
// lib/sweepProgress.js for the full reasoning. In short: 8 categories x 3
// periods = 24 combinations, and neither a single AI search call nor 24 of
// them back to back reliably fit inside Netlify's real execution limits (30s
// for a cron-triggered invocation, 60s for a manual one). So each
// invocation works through as many combinations as fit in its own safe time
// budget, saves progress after every one that succeeds, and picks up where
// it left off next time. netlify.toml triggers this on a five-minute cron
// *window* every Monday morning (not a single tick) specifically so there
// are many chances to finish the full sweep, not just one.
//
// Required environment variables:
//   ANTHROPIC_API_KEY - same key gazette.js uses
//   BLOBS_TOKEN        - same Netlify personal access token gazette.js and
//                         categories.js use for Blobs access (see lib/blobStore.js)
//
// Optional:
//   MANUAL_TRIGGER_SECRET - if set, allows a manual GET run via
//                            ?secret=... for testing without waiting for Monday
//
// Also runs on demand from the admin panel's "Refresh all categories now"
// button (admin.html), authenticated the same way as the rest of the admin
// panel — a POST with an x-admin-password header matching ADMIN_PASSWORD.
// The button itself now calls this repeatedly (see admin.html) until the
// response says the week's sweep is complete, since one 60-second click can
// no longer be assumed to finish all 24 combinations by itself.
// A POST with no such header is assumed to be Netlify's own scheduled cron
// invocation and runs unauthenticated, same as before.
//
// Note: this previously cached to a Supabase project, which was found to
// have been deleted (see commit history) — it now shares the same Netlify
// Blobs cache that gazette.js reads from, so there's no separate external
// account to keep alive.

const { loadAll } = require('./lib/categories');
const { callAI, SCHEDULED_MAX_SEARCH_USES } = require('./lib/ai');
const { setCached } = require('./lib/cache');
const { isoWeekId, loadProgress, saveProgress, timeBudgetMs, markDone } = require('./lib/sweepProgress');

// Matches the periods the site actually offers (see index.html's period
// buttons) — previously this list (3/6/12/24) didn't match what the app
// requests (1/3/6), so the cache this function built was never being read.
const PERIODS = [1, 3, 6];

const PROGRESS_STORE = 'scheduler-progress';
const PROGRESS_KEY = 'current-sweep';

function periodLabel(months) {
  const end = new Date();
  const start = new Date();
  start.setMonth(start.getMonth() - months);
  const fmt = function (d) { return d.toLocaleString('en-US', { month: 'long', year: 'numeric' }); };
  return fmt(start) + ' to ' + fmt(end);
}

// The AI call's own timeout has to fit inside ONE invocation's time budget
// (see lib/sweepProgress.js's timeBudgetMs), with room left over for
// loading categories and saving progress — a cron-triggered invocation has
// far less room to work with than a manual one.
function aiTimeoutMs(isManual) {
  return isManual ? 40000 : 18000;
}

async function fetchNotices(category, months, apiKey, isManual) {
  const currentYear = new Date().getFullYear();
  const prompt = 'Search for South African Government Gazette notices about ' + category.label + ' published in ' + currentYear + '. '
    + 'Keywords: ' + category.keywords + '. Find notices from the last ' + months + ' months (' + periodLabel(months) + '). '
    + 'Return exactly 8 notices as a JSON array starting with [ and ending with ]. '
    + 'Use web search results for real notices, supplement with your knowledge to reach 8. '
    + 'For each notice, include the real source URL you found it at if possible — the user needs to be able to click through and read the full official notice. '
    + 'Set category field to "' + category.id + '" for all entries.';
  return callAI(apiKey, prompt, true, { maxSearchUses: SCHEDULED_MAX_SEARCH_USES, requestTimeoutMs: aiTimeoutMs(isManual) });
}

exports.handler = async (event) => {
  const apiKey = process.env.ANTHROPIC_API_KEY;

  if (!apiKey) {
    console.error('Gazette scheduler cannot run — missing ANTHROPIC_API_KEY');
    return { statusCode: 500, body: JSON.stringify({ error: 'Missing environment variable: ANTHROPIC_API_KEY' }) };
  }

  // Allow manual trigger for testing, guarded by a secret so this can't be
  // used to run up the Anthropic bill by anyone who finds the URL.
  const isManualGet = event.httpMethod === 'GET';
  if (isManualGet) {
    if (!process.env.MANUAL_TRIGGER_SECRET || event.queryStringParameters?.secret !== process.env.MANUAL_TRIGGER_SECRET) {
      return { statusCode: 401, body: 'Unauthorised' };
    }
  }

  // Admin panel trigger: a POST carrying the same x-admin-password header
  // used everywhere else in the admin UI. Netlify's own scheduled cron also
  // invokes this via POST but never sends this header, so a plain POST with
  // no header still runs unauthenticated exactly as it always has.
  const suppliedAdminPw = event.headers && (event.headers['x-admin-password'] || event.headers['X-Admin-Password']);
  let isManualAdmin = false;
  if (event.httpMethod === 'POST' && suppliedAdminPw) {
    if (!process.env.ADMIN_PASSWORD || suppliedAdminPw !== process.env.ADMIN_PASSWORD) {
      return { statusCode: 401, headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ error: 'Invalid admin password' }) };
    }
    isManualAdmin = true;
  }

  const isManual = isManualGet || isManualAdmin;

  const categories = (await loadAll()).filter(function (c) { return c.active !== false; });
  const allCombos = [];
  categories.forEach(function (category) {
    PERIODS.forEach(function (months) {
      allCombos.push({ category: category, months: months, key: category.id + ':' + months });
    });
  });

  const runId = isoWeekId(new Date());
  const progress = await loadProgress(PROGRESS_STORE, PROGRESS_KEY, runId);
  const budgetMs = timeBudgetMs(isManual);
  const loopStart = Date.now();

  console.log('Gazette scheduler tick (' + (isManual ? 'manual' : 'cron') + '):', new Date().toISOString(),
    '— week ' + runId + ', ' + progress.doneKeys.length + '/' + allCombos.length + ' already done');

  const results = [];
  for (const combo of allCombos) {
    if (progress.doneKeys.indexOf(combo.key) !== -1) continue; // already done this week
    if (Date.now() - loopStart > budgetMs) break; // out of time this invocation — pick up next time

    try {
      console.log('Fetching ' + combo.key + '...');
      const notices = await fetchNotices(combo.category, combo.months, apiKey, isManual);
      const saved = await setCached(combo.category.id, combo.months, notices);
      markDone(progress, combo.key);
      await saveProgress(PROGRESS_STORE, PROGRESS_KEY, progress); // persist after EVERY success, not just at the end
      results.push({ category: combo.category.id, months: combo.months, count: notices.length, saved: saved });
      console.log('  Done: ' + notices.length + ' notices, saved=' + saved);
    } catch (e) {
      // Not marked done — a future invocation will retry this exact combo.
      console.error('  Error for ' + combo.key + ':', e.message);
      results.push({ category: combo.category.id, months: combo.months, error: e.message });
    }
  }

  const remaining = allCombos.length - progress.doneKeys.length;
  if (remaining === 0 && !progress.completedAt) {
    progress.completedAt = new Date().toISOString();
    await saveProgress(PROGRESS_STORE, PROGRESS_KEY, progress);
    console.log('Scheduler sweep complete for week ' + runId);
  }

  console.log('Scheduler tick complete: ' + results.length + ' processed this run, ' + progress.doneKeys.length + '/' + allCombos.length + ' done overall');
  return {
    statusCode: 200,
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      week: runId,
      processedThisRun: results.length,
      results: results,
      doneSoFar: progress.doneKeys.length,
      totalCombinations: allCombos.length,
      remaining: remaining,
      weekComplete: remaining === 0,
    }),
  };
};
