// netlify/functions/gazette.js
// Handles both category browsing and free-text search.

const CATEGORY_DESC = {
  labour:      'Labour Employment wage determinations CCMA employment equity sectoral UIF 2025 2026',
  tax:         'SARS tax National Treasury VAT customs income tax amendments 2025 2026',
  bbbee:       'B-BBEE transformation codes charters verification DTI empowerment 2025 2026',
  regs:        'Companies Act CIPC business regulations licensing consumer protection 2025 2026',
  procurement: 'government procurement PFMA supply chain preferential Treasury 2025 2026',
  environment: 'NEMA environmental impact waste management carbon tax 2025 2026',
  health:      'OHS occupational health NHI pharmaceutical workplace safety 2025 2026',
};

const CATEGORY_LABEL = {
  labour:      'Labour and Employment',
  tax:         'Tax and Revenue',
  bbbee:       'B-BBEE and Transformation',
  regs:        'Company Regulations',
  procurement: 'Government Procurement',
  environment: 'Environment and Sustainability',
  health:      'Health and OHS',
};

const JSON_SYSTEM = 'You are a South African government gazette expert. Output ONLY a raw JSON array. Start with [ and end with ]. Each object: {"title":"string","gazette_no":"string","date":"YYYY-MM-DD","summary":"2-3 sentences","practitioner_note":"1 sentence for employers","category":"string"}. No text before or after the array.';

async function callAI(apiKey, userPrompt, useSearch) {
  const body = {
    model: 'claude-haiku-4-5-20251001',
    max_tokens: 2500,
    system: JSON_SYSTEM,
    messages: [{ role: 'user', content: userPrompt }],
  };
  if (useSearch) body.tools = [{ type: 'web_search_20250305', name: 'web_search', max_uses: 1 }];

  const res = await fetch('https://api.anthropic.com/v1/messages', {
    method: 'POST',
    headers: { 'x-api-key': apiKey, 'anthropic-version': '2023-06-01', 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });
  if (!res.ok) throw new Error('Anthropic HTTP ' + res.status + ': ' + (await res.text()).slice(0, 100));
  const data = await res.json();
  const text = (data.content || []).filter(function(b) { return b.type === 'text'; }).map(function(b) { return b.text; }).join('');
  console.log('AI response preview:', text.slice(0, 150));
  const si = text.indexOf('[');
  const ei = text.lastIndexOf(']');
  if (si === -1 || ei <= si) throw new Error('No JSON array found. Got: ' + text.slice(0, 100));
  const parsed = JSON.parse(text.slice(si, ei + 1));
  return Array.isArray(parsed) ? parsed : [];
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
      + 'Include notices from any category: labour, tax, B-BBEE, regulations, procurement, environment, health. '
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
  const category = reqBody.category;
  const months = reqBody.months || 3;

  if (!category || !CATEGORY_DESC[category]) {
    return { statusCode: 400, headers, body: JSON.stringify({ error: 'Provide category or search' }) };
  }

  // Check cache
  if (supabaseUrl && supabaseKey) {
    try {
      const cacheUrl = supabaseUrl + '/rest/v1/gazette_cache?category=eq.' + encodeURIComponent(category) + '&months=eq.' + months + '&select=notices,updated_at';
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
  const label = CATEGORY_LABEL[category];
  const keywords = CATEGORY_DESC[category];
  const prompt = 'Search for South African Government Gazette notices about ' + label + ' published in ' + currentYear + '. '
    + 'Keywords: ' + keywords + '. Find notices from the last ' + months + ' months. '
    + 'Return exactly 8 notices as a JSON array starting with [ and ending with ]. '
    + 'Use web search results for real notices, supplement with your knowledge to reach 8. '
    + 'Set category field to "' + category + '" for all entries.';

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
        body: JSON.stringify({ category: category, months: months, notices: notices, updated_at: new Date().toISOString() }),
      });
    } catch (e) { console.error('Cache write:', e.message); }
  }

  return { statusCode: 200, headers, body: JSON.stringify({ notices: notices, cached: false }) };
};
