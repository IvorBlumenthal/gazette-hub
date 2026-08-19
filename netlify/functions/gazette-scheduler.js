// netlify/functions/gazette-scheduler.js
// Runs every Monday at 06:00 SAST (04:00 UTC) via netlify.toml cron.
// Pre-fetches gazette notices for every active category and caches them in
// Supabase so the app loads instantly without waiting for a live AI call.
//
// Required environment variables:
//   ANTHROPIC_API_KEY     - same key gazette.js uses
//   SUPABASE_URL          - your Supabase project URL
//   SUPABASE_SERVICE_KEY  - your Supabase service_role key (NOT the anon key —
//                            this needs to be able to write to gazette_cache
//                            for every category on a schedule, so it uses the
//                            elevated service role rather than the public key)
//
// Optional:
//   MANUAL_TRIGGER_SECRET - if set, allows a manual GET run via
//                            ?secret=... for testing without waiting for Monday

const { loadAll } = require('./lib/categories');
const { callAI } = require('./lib/ai');

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

async function upsertCache(supabaseUrl, serviceKey, categoryId, months, notices) {
  const resp = await fetch(supabaseUrl + '/rest/v1/gazette_cache', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      apikey: serviceKey,
      Authorization: 'Bearer ' + serviceKey,
      Prefer: 'resolution=merge-duplicates',
    },
    body: JSON.stringify({
      category: categoryId,
      months: months,
      // NOTE: notices is passed as a real array here, not JSON.stringify()'d.
      // The previous version double-encoded this into a string, which meant
      // gazette.js's Array.isArray(rows[0].notices) cache-read check always
      // failed silently and the cache was never actually being used.
      notices: notices,
      updated_at: new Date().toISOString(),
    }),
  });
  return resp.ok;
}

exports.handler = async (event) => {
  const apiKey = process.env.ANTHROPIC_API_KEY;
  const supabaseUrl = process.env.SUPABASE_URL;
  const serviceKey = process.env.SUPABASE_SERVICE_KEY;

  if (!apiKey || !supabaseUrl || !serviceKey) {
    const missing = [
      !apiKey && 'ANTHROPIC_API_KEY',
      !supabaseUrl && 'SUPABASE_URL',
      !serviceKey && 'SUPABASE_SERVICE_KEY',
    ].filter(Boolean).join(', ');
    console.error('Gazette scheduler cannot run — missing environment variable(s):', missing);
    return { statusCode: 500, body: JSON.stringify({ error: 'Missing environment variable(s): ' + missing }) };
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
        const saved = await upsertCache(supabaseUrl, serviceKey, category.id, months, notices);
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
