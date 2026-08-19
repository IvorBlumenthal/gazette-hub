// netlify/functions/gazette.js
// Handles both category browsing and free-text search.

const { findById } = require('./lib/categories');
const { callAI } = require('./lib/ai');

exports.handler = async (event) => {
  const headers = {
    'Access-Control-Allow-Origin': '*',
    'Access-Control-Allow-Headers': 'Content-Type',
    'Content-Type': 'application/json',
  };

  if (event.httpMethod === 'OPTIONS') return { statusCode: 200, headers, body: '' };

  let reqBody;
  try { reqBody = JSON.parse(event.body || '{}'); }
  catch (e) { return { statusCode: 400, headers, body: JSON.stringify({ error: 'Invalid JSON' }) }; }

  const apiKey = process.env.ANTHROPIC_API_KEY;
  if (!apiKey) return { statusCode: 500, headers, body: JSON.stringify({ error: 'ANTHROPIC_API_KEY not set' }) };

  const supabaseUrl = process.env.SUPABASE_URL;
  const supabaseKey = process.env.SUPABASE_ANON_KEY;

  // ── FREE-TEXT SEARCH ──────────────────────────────────────
  if (reqBody.search) {
    const q = String(reqBody.search).trim();
    const months = reqBody.months || 3;
    const currentYear = new Date().getFullYear();
    const prompt = 'Search for South African Government Gazette notices matching: "' + q + '". '
      + 'Focus on notices published in ' + currentYear + ' and the last ' + months + ' months. '
      + 'Include notices from any category: labour, tax, B-BBEE, regulations, procurement, environment, health, bargaining councils. '
      + 'Return exactly 8 matching notices as a JSON array starting with [ and ending with ]. '
      + 'Use your knowledge of SA gazette patterns to supplement if web search finds fewer than 8.';
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
  if (supabaseUrl && supabaseKey) {
    try {
      const cacheUrl = supabaseUrl + '/rest/v1/gazette_cache?category=eq.' + encodeURIComponent(categoryId) + '&months=eq.' + months + '&select=notices,updated_at';
      const cacheRes = await fetch(cacheUrl, { headers: { apikey: supabaseKey, Authorization: 'Bearer ' + supabaseKey } });
      if (cacheRes.ok) {
        const rows = await cacheRes.json();
        if (rows && rows.length > 0 && Array.isArray(rows[0].notices) && rows[0].notices.length > 0) {
          const ageHours = (Date.now() - new Date(rows[0].updated_at).getTime()) / 3600000;
          if (ageHours < 168) return { statusCode: 200, headers, body: JSON.stringify({ notices: rows[0].notices, cached: true }) };
        }
      }
    } catch (e) { console.error('Cache read:', e.message); }
  }

  const currentYear = new Date().getFullYear();
  const label = category.label;
  const keywords = category.keywords;
  const prompt = 'Search for South African Government Gazette notices about ' + label + ' published in ' + currentYear + '. '
    + 'Keywords: ' + keywords + '. Find notices from the last ' + months + ' months. '
    + 'Return exactly 8 notices as a JSON array starting with [ and ending with ]. '
    + 'Use web search results for real notices, supplement with your knowledge to reach 8. '
    + 'Set category field to "' + categoryId + '" for all entries.';

  let notices = [];
  try {
    notices = await callAI(apiKey, prompt, true);
  } catch (err) {
    console.error('Category error:', err.message);
    return { statusCode: 502, headers, body: JSON.stringify({ error: err.message }) };
  }

  // Write cache
  if (supabaseUrl && supabaseKey && notices.length > 0) {
    try {
      await fetch(supabaseUrl + '/rest/v1/gazette_cache', {
        method: 'POST',
        headers: { apikey: supabaseKey, Authorization: 'Bearer ' + supabaseKey, 'Content-Type': 'application/json', Prefer: 'resolution=merge-duplicates' },
        body: JSON.stringify({ category: categoryId, months: months, notices: notices, updated_at: new Date().toISOString() }),
      });
    } catch (e) { console.error('Cache write:', e.message); }
  }

  return { statusCode: 200, headers, body: JSON.stringify({ notices: notices, cached: false }) };
};
