// netlify/functions/gazette.js
// Web search for real SA gazette notices, strict JSON output.
// max_uses:1 keeps it well within timeout.

const CATEGORY_DESC = {
  labour:      'Labour Employment wage determinations CCMA employment equity sectoral UIF 2025 2026',
  tax:         'SARS tax National Treasury VAT customs income tax amendments 2025 2026',
  bbbee:       'B-BBEE transformation codes charters verification DTI 2025 2026',
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

  const category = reqBody.category;
  const months = reqBody.months || 3;

  if (!category || !CATEGORY_DESC[category]) {
    return { statusCode: 400, headers, body: JSON.stringify({ error: 'Invalid category' }) };
  }

  const supabaseUrl = process.env.SUPABASE_URL;
  const supabaseKey = process.env.SUPABASE_ANON_KEY;
  const apiKey = process.env.ANTHROPIC_API_KEY;

  if (!apiKey) return { statusCode: 500, headers, body: JSON.stringify({ error: 'ANTHROPIC_API_KEY not set' }) };

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

  const systemPrompt = 'You are a South African government gazette database. Output ONLY a raw JSON array. Start with [ end with ]. Each object: {"title":"string","gazette_no":"string","date":"YYYY-MM-DD","summary":"string","practitioner_note":"string","category":"string"}. No text before or after the array.';

  const userPrompt = 'Search South African Government Gazette ' + currentYear + ': ' + keywords
    + '. Find real gazette notices from the last ' + months + ' months with gazette numbers and dates.'
    + ' Then output ONLY a JSON array of 6-8 notices. Start with [ end with ].';

  let notices = [];
  try {
    const aiRes = await fetch('https://api.anthropic.com/v1/messages', {
      method: 'POST',
      headers: { 'x-api-key': apiKey, 'anthropic-version': '2023-06-01', 'Content-Type': 'application/json' },
      body: JSON.stringify({
        model: 'claude-haiku-4-5-20251001',
        max_tokens: 2000,
        system: systemPrompt,
        tools: [{ type: 'web_search_20250305', name: 'web_search', max_uses: 1 }],
        messages: [{ role: 'user', content: userPrompt }],
      }),
    });

    if (!aiRes.ok) throw new Error('HTTP ' + aiRes.status + ': ' + (await aiRes.text()).slice(0, 100));

    const aiData = await aiRes.json();
    const text = (aiData.content || []).filter(function(b) { return b.type === 'text'; }).map(function(b) { return b.text; }).join('');
    console.log('stop_reason:', aiData.stop_reason, 'text_len:', text.length, 'preview:', text.slice(0, 150));

    const si = text.indexOf('[');
    const ei = text.lastIndexOf(']');
    if (si === -1 || ei <= si) throw new Error('No JSON array. Text: ' + text.slice(0, 100));
    notices = JSON.parse(text.slice(si, ei + 1));
    if (!Array.isArray(notices)) notices = [];

  } catch (err) {
    console.error('AI error:', err.message);
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
