// netlify/functions/gazette.js
// Handles both category browsing and free-text search.

const { findById } = require('./lib/categories');
const { callAI } = require('./lib/ai');
const { getCached, setCached } = require('./lib/cache');
const { checkRateLimit } = require('./lib/rateLimit');
const { checkAndIncrementDailyBudget } = require('./lib/aiGuard');

// Generous enough for normal browsing (loading several categories, running
// a couple of searches) but caps a script or bot hammering this endpoint —
// every cache miss here calls the paid Anthropic API.
const RATE_LIMIT_MAX = 40;
const RATE_LIMIT_WINDOW_SECONDS = 900; // 15 minutes

exports.handler = async (event) => {
  const headers = {
    'Access-Control-Allow-Origin': '*',
    'Access-Control-Allow-Headers': 'Content-Type',
    'Content-Type': 'application/json',
  };

  if (event.httpMethod === 'OPTIONS') return { statusCode: 200, headers, body: '' };

  const rate = await checkRateLimit(event, 'gazette', RATE_LIMIT_MAX, RATE_LIMIT_WINDOW_SECONDS);
  if (!rate.allowed) {
    return { statusCode: 429, headers, body: JSON.stringify({ error: 'Too many requests — please wait a few minutes and try again.' }) };
  }

  let reqBody;
  try { reqBody = JSON.parse(event.body || '{}'); }
  catch (e) { return { statusCode: 400, headers, body: JSON.stringify({ error: 'Invalid JSON' }) }; }

  // Temporary diagnostic: does a completely raw, uncached fetch of the
  // gazettes.africa year-index page and reports exactly what came back —
  // used to tell apart a network failure from a bot-check/challenge page
  // from genuinely empty content, none of which are visible from outside
  // without this. Safe to remove once the real cause is confirmed.
  if (reqBody.debugRawFetch) {
    const year = String(reqBody.debugRawFetch);
    const url = 'https://gazettes.africa/gazettes/za/' + year;
    try {
      const controller = new AbortController();
      const timer = setTimeout(function () { controller.abort(); }, 25000);
      let res;
      try {
        res = await fetch(url, {
          signal: controller.signal,
          headers: { 'User-Agent': 'Mozilla/5.0 (compatible; ArkKonsultGazetteHub/1.0; +https://gazette-hub.netlify.app)' },
        });
      } finally {
        clearTimeout(timer);
      }
      const body = await res.text();
      // Test both an absolute-URL pattern and a relative-href pattern —
      // if the page uses relative hrefs (e.g. href="/akn/za/...") instead
      // of full https://gazettes.africa/akn/za/... links, the absolute
      // pattern silently matches nothing even though the real links are
      // right there in the HTML.
      const ABS_RE = /https:\/\/gazettes\.africa\/akn\/za\/officialGazette\/([a-z0-9-]+)\/(\d{4}-\d{2}-\d{2})\/([0-9]+(?:-part-\d+)?)\/eng@\2/g;
      const REL_RE = /(?:href=["'])(\/akn\/za\/officialGazette\/([a-z0-9-]+)\/(\d{4}-\d{2}-\d{2})\/([0-9]+(?:-part-\d+)?)\/eng@\3)["']/g;
      const absMatches = (body.match(ABS_RE) || []).length;
      const relMatches = (body.match(REL_RE) || []).length;
      const firstRel = REL_RE.exec(body);
      REL_RE.lastIndex = 0;
      return {
        statusCode: 200,
        headers,
        body: JSON.stringify({
          fetchedUrl: url,
          upstreamStatus: res.status,
          upstreamOk: res.ok,
          bodyLength: body.length,
          containsAknLink: body.indexOf('/akn/za/officialGazette/') !== -1,
          looksLikeChallenge: /just a moment|cf-browser-verification|challenge-platform/i.test(body),
          absoluteUrlMatches: absMatches,
          relativeHrefMatches: relMatches,
          firstRelativeMatch: firstRel ? firstRel[1] : null,
        }),
      };
    } catch (err) {
      return {
        statusCode: 200,
        headers,
        body: JSON.stringify({ fetchedUrl: url, fetchThrew: true, errorName: err.name, errorMessage: err.message }),
      };
    }
  }

  // Temporary diagnostic: confirms the gazettes.africa index lookup (see
  // lib/gazetteIndex.js) is actually finding real gazettes in production,
  // without needing server log access. Read-only, no AI call, no side
  // effects — safe to leave in, and safe to remove later once confirmed.
  if (reqBody.debugGazetteIndex) {
    const { getYearIndex } = require('./lib/gazetteIndex');
    const year = String(reqBody.debugGazetteIndex);
    const index = await getYearIndex(year);
    const keys = Object.keys(index);
    const testNumber = reqBody.debugNumber ? String(reqBody.debugNumber).replace(/[^0-9]/g, '') : null;
    return {
      statusCode: 200,
      headers,
      body: JSON.stringify({
        year: year,
        entryCount: keys.length,
        sampleEntries: keys.slice(0, 5).map(function (k) { return { number: k, url: index[k].url }; }),
        testNumberFound: testNumber ? !!index[testNumber] : null,
        testNumberEntry: testNumber ? (index[testNumber] || null) : null,
      }),
    };
  }

  const apiKey = process.env.ANTHROPIC_API_KEY;
  if (!apiKey) return { statusCode: 500, headers, body: JSON.stringify({ error: 'ANTHROPIC_API_KEY not set' }) };

  // ── FREE-TEXT SEARCH ──────────────────────────────────────
  if (reqBody.search) {
    const q = String(reqBody.search).trim();
    const months = reqBody.months || 3;
    const currentYear = new Date().getFullYear();
    const prompt = 'Search for South African Government Gazette notices matching: "' + q + '". '
      + 'Focus on notices published in ' + currentYear + ' and the last ' + months + ' months. '
      + 'Include notices from any category: labour, tax, B-BBEE, regulations, procurement, environment, health, bargaining councils. '
      + 'Return exactly 8 matching notices as a JSON array starting with [ and ending with ]. '
      + 'For each notice, include the real source URL you found it at if possible — the user needs to be able to click through and read the full official notice. '
      + 'Use your knowledge of SA gazette patterns to supplement if web search finds fewer than 8.';
    const budget = await checkAndIncrementDailyBudget();
    if (!budget.allowed) {
      console.error('Gazette search: daily AI budget exceeded (' + budget.count + '/' + budget.limit + ')');
      return { statusCode: 503, headers, body: JSON.stringify({ error: 'Search is temporarily unavailable — please try again later.' }) };
    }
    try {
      const notices = await callAI(apiKey, prompt, true);
      return { statusCode: 200, headers, body: JSON.stringify({ notices: notices, cached: false }) };
    } catch (err) {
      console.error('Search error:', err.message);
      return { statusCode: 502, headers, body: JSON.stringify({ error: 'Search failed: ' + err.message }) };
    }
  }

  // ── CATEGORY BROWSE ───────────────────────────────────────
  const categoryId = reqBody.category;
  const months = reqBody.months || 3;

  if (!categoryId) {
    return { statusCode: 400, headers, body: JSON.stringify({ error: 'Provide category or search' }) };
  }

  const category = await findById(categoryId);
  if (!category) {
    return { statusCode: 400, headers, body: JSON.stringify({ error: 'Unknown category: ' + categoryId }) };
  }

  // Check cache
  const cachedNotices = await getCached(categoryId, months);
  if (cachedNotices) {
    return { statusCode: 200, headers, body: JSON.stringify({ notices: cachedNotices, cached: true }) };
  }

  const currentYear = new Date().getFullYear();
  const label = category.label;
  const keywords = category.keywords;
  const prompt = 'Search for South African Government Gazette notices about ' + label + ' published in ' + currentYear + '. '
    + 'Keywords: ' + keywords + '. Find notices from the last ' + months + ' months. '
    + 'Return exactly 8 notices as a JSON array starting with [ and ending with ]. '
    + 'Use web search results for real notices, supplement with your knowledge to reach 8. '
    + 'For each notice, include the real source URL you found it at if possible — the user needs to be able to click through and read the full official notice. '
    + 'Set category field to "' + categoryId + '" for all entries.';

  const budget = await checkAndIncrementDailyBudget();
  if (!budget.allowed) {
    console.error('Gazette category: daily AI budget exceeded (' + budget.count + '/' + budget.limit + ')');
    return { statusCode: 503, headers, body: JSON.stringify({ error: 'This category is temporarily unavailable — please try again later.' }) };
  }

  let notices = [];
  try {
    notices = await callAI(apiKey, prompt, true);
  } catch (err) {
    console.error('Category error:', err.message);
    return { statusCode: 502, headers, body: JSON.stringify({ error: err.message }) };
  }

  // Write cache
  if (notices.length > 0) {
    await setCached(categoryId, months, notices);
  }

  return { statusCode: 200, headers, body: JSON.stringify({ notices: notices, cached: false }) };
};
