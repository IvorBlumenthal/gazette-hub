// netlify/functions/gazette-scheduler.js
// Runs every Monday at 06:00 SAST (04:00 UTC) via netlify.toml cron.
// Pre-fetches gazette notices for every active category and caches them in
// Netlify Blobs so the app loads instantly without waiting for a live AI
// call.
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
// Note: this previously cached to a Supabase project, which was found to
// have been deleted (see commit history) — it now shares the same Netlify
// Blobs cache that gazette.js reads from, so there's no separate external
// account to keep alive.

const { loadAll } = require('./lib/categories');
const { callAI } = require('./lib/ai');
const { setCached } = require('./lib/cache');

// Matches the periods the site actually offers (see index.html's period
// buttons) — previously this list (3/6/12/24) didn't match what the app
// requests (1/3/6), so the cache this function built was never being read.
const PERIODS = [1, 3, 6];

function periodLabel(months) {
  const end = new Date();
  const start = new Date();
  start.setMonth(start.getMonth() - months);
  const fmt = function (d) { return d.toLocaleString('en-US', { month: 'long', year: 'numeric' }); };
  return fmt(start) + ' to ' + fmt(end);
}

async function fetchNotices(category, months, apiKey) {
  const currentYear = new Date().getFullYear();
  const prompt = 'Search for South African Government Gazette notices about ' + category.label + ' published in ' + currentYear + '. '
    + 'Keywords: ' + category.keywords + '. Find notices from the last ' + months + ' months (' + periodLabel(months) + '). '
    + 'Return exactly 8 notices as a JSON array starting with [ and ending with ]. '
    + 'Use web search results for real notices, supplement with your knowledge to reach 8. '
    + 'Set category field to "' + category.id + '" for all entries.';
  return callAI(apiKey, prompt, true);
}

exports.handler = async (event) => {
  const apiKey = process.env.ANTHROPIC_API_KEY;

  if (!apiKey) {
    console.error('Gazette scheduler cannot run — missing ANTHROPIC_API_KEY');
    return { statusCode: 500, body: JSON.stringify({ error: 'Missing environment variable: ANTHROPIC_API_KEY' }) };
  }

  // Allow manual trigger for testing, guarded by a secret so this can't be
  // used to run up the Anthropic bill by anyone who finds the URL.
  const isManual = event.httpMethod === 'GET';
  if (isManual) {
    if (!process.env.MANUAL_TRIGGER_SECRET || event.queryStringParameters?.secret !== process.env.MANUAL_TRIGGER_SECRET) {
      return { statusCode: 401, body: 'Unauthorised' };
    }
  }

  const categories = (await loadAll()).filter(function (c) { return c.active !== false; });
  const results = [];
  console.log('Gazette scheduler started:', new Date().toISOString(), '—', categories.length, 'active categories');

  for (const category of categories) {
    for (const months of PERIODS) {
      try {
        console.log('Fetching ' + category.id + ' / ' + months + ' months...');
        const notices = await fetchNotices(category, months, apiKey);
        const saved = await setCached(category.id, months, notices);
        results.push({ category: category.id, months: months, count: notices.length, saved: saved });
        console.log('  Done: ' + notices.length + ' notices, saved=' + saved);
        // Small delay between calls to stay well clear of rate limits.
        await new Promise(function (r) { setTimeout(r, 2000); });
      } catch (e) {
        console.error('  Error for ' + category.id + '/' + months + ':', e.message);
        results.push({ category: category.id, months: months, error: e.message });
      }
    }
  }

  console.log('Scheduler complete:', results.length, 'combinations processed');
  return { statusCode: 200, body: JSON.stringify({ processed: results.length, results: results }) };
};
