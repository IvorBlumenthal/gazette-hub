// netlify/functions/gazette.js
// Handles both category browsing and free-text search.

const { findById } = require('./lib/categories');

const JSON_SYSTEM = 'You are a South African government gazette expert. Output ONLY a raw JSON array. Start with [ and end with ]. '
  + 'Each object: {"title":"string","gazette_no":"string","date":"YYYY-MM-DD","summary":"2-3 sentences","practitioner_note":"1 sentence for employers","category":"string"}. '
  + 'No text before or after the array. This rule applies no matter what: even if your search finds few or no results, you must still return a JSON array of '
  + '8 objects using your general knowledge of real or representative SA gazette notices for the topic and period — never explain that results were limited, '
  + 'never write a sentence like "Based on the search results", never apologise, never add markdown code fences. Your entire reply must be parseable JSON, nothing else.';

const RETRY_NOTE = '\n\nIMPORTANT: Your previous attempt did not return valid JSON. This time, respond with ONLY the JSON array — no introductory sentence, '
  + 'no explanation of search results, no markdown fences. Start your reply with the character [ and end it with ].';

function extractJsonArray(text) {
  const si = text.indexOf('[');
  const ei = text.lastIndexOf(']');
  if (si === -1 || ei <= si) return null;
  let slice = text.slice(si, ei + 1);
  // Best-effort cleanup for trailing commas, which occasionally show up in
  // truncated or hastily-formatted model output.
  slice = slice.replace(/,\s*([\]}])/g, '$1');
  try {
    const parsed = JSON.parse(slice);
    return Array.isArray(parsed) ? parsed : null;
  } catch (e) {
    return null;
  }
}

async function callAIOnce(apiKey, userPrompt, useSearch, maxTokens) {
  const body = {
    model: 'claude-haiku-4-5-20251001',
    max_tokens: maxTokens,
    system: JSON_SYSTEM,
    messages: [{ role: 'user', content: userPrompt }],
  };
  if (useSearch) body.tools = [{ type: 'web_search_20250305', name: 'web_search', max_uses: 1 }];

  const res = await fetch('https://api.anthropic.com/v1/messages', {
    method: 'POST',
    headers: { 'x-api-key': apiKey, 'anthropic-version': '2023-06-01', 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });
  if (!res.ok) throw new Error('Anthropic HTTP ' + res.status + ': ' + (await res.text()).slice(0, 200));
  const data = await res.json();
  const text = (data.content || []).filter(function (b) { return b.type === 'text'; }).map(function (b) { return b.text; }).join('');
  console.log('AI response preview:', text.slice(0, 150));
  return text;
}

// Resilient wrapper: tries up to 2 times before giving up —
//   1) normal call with web search
//   2) fallback call without web search + an explicit corrective instruction
//      (relies on the model's own knowledge, which tends to comply with the
//      strict JSON format far more reliably than a search-augmented reply
//      does when live results are thin). Kept to 2 attempts, not 3, so total
//      latency stays comfortably inside the function's 26s timeout.
async function callAI(apiKey, userPrompt, useSearch) {
  const attempts = [
    { prompt: userPrompt, search: useSearch, maxTokens: 3000 },
    { prompt: userPrompt + RETRY_NOTE, search: false, maxTokens: 3000 },
  ];

  let lastErr = null;
  for (let i = 0; i < attempts.length; i++) {
    const attempt = attempts[i];
    try {
      const text = await callAIOnce(apiKey, attempt.prompt, attempt.search, attempt.maxTokens);
      const parsed = extractJsonArray(text);
      if (parsed) return parsed;
      lastErr = new Error('No JSON array found. Got: ' + text.slice(0, 150));
    } catch (err) {
      lastErr = err;
    }
  }
  throw lastErr || new Error('Unknown error generating notices');
}

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
