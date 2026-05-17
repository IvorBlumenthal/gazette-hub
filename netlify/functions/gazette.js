// netlify/functions/gazette.js
// Checks Supabase cache first for instant results.
// Falls back to live Anthropic API (Haiku + web search) if cache is empty.
// Set ANTHROPIC_API_KEY, SUPABASE_URL, SUPABASE_ANON_KEY in Netlify env vars.

const GAZETTE_CONTEXT =
  'You are an expert on South African Government Gazettes. ' +
  'Use web search to find real, verified gazette notices. ' +
  'Return ONLY a valid JSON array, no markdown, no backticks, no preamble. ' +
  'Never return an empty array. ' +
  'Each object must have: title, gazette_no, date, summary (2-3 sentences), ' +
  'practitioner_note (1 sentence), category (labour|bbbee|regs|procurement|environment|health|tax).';

const PROMPTS = {
  labour:
    'Search for South African Government Gazette notices on Labour and Employment published in the last {months} months. ' +
    'Include: wage determinations, labour law amendments, CCMA notices, employment equity reports, ' +
    'sectoral determinations, UIF/COIDA notices. Return 8 real notices as a JSON array.',
  tax:
    'Search for South African Government Gazette notices on Tax, SARS, and National Treasury published in the last {months} months. ' +
    'Include: tax law amendments, SARS notices, budget-related gazettes, VAT/customs notices, revenue regulations. ' +
    'Return 8 real notices as a JSON array.',
  bbbee:
    'Search for South African Government Gazette notices on B-BBEE, transformation, and empowerment published in the last {months} months. ' +
    'Include: B-BBEE codes, sector charters, BEE verification, empowerment certificates, DTI notices. ' +
    'Return 8 real notices as a JSON array.',
  regs:
    'Search for South African Government Gazette notices on company regulations, CIPC, and business compliance published in the last {months} months. ' +
    'Include: Companies Act amendments, CIPC notices, business licensing, consumer protection regulations. ' +
    'Return 8 real notices as a JSON array.',
  procurement:
    'Search for South African Government Gazette notices on government procurement and tenders published in the last {months} months. ' +
    'Include: PFMA amendments, SCM regulations, preferential procurement, National Treasury instructions. ' +
    'Return 8 real notices as a JSON array.',
  environment:
    'Search for South African Government Gazette notices on environment, climate, and sustainability published in the last {months} months. ' +
    'Include: NEMA amendments, environmental impact assessments, waste management regulations, carbon tax notices. ' +
    'Return 8 real notices as a JSON array.',
  health:
    'Search for South African Government Gazette notices on health, occupational health, and safety published in the last {months} months. ' +
    'Include: OHS Act amendments, health regulations, NHI notices, pharmaceutical regulations, workplace safety. ' +
    'Return 8 real notices as a JSON array.',
};

exports.handler = async (event) => {
  const headers = {
    'Access-Control-Allow-Origin': '*',
    'Access-Control-Allow-Headers': 'Content-Type',
    'Content-Type': 'application/json',
  };

  if (event.httpMethod === 'OPTIONS') {
    return { statusCode: 200, headers, body: '' };
  }

  let body;
  try {
    body = JSON.parse(event.body || '{}');
  } catch {
    return { statusCode: 400, headers, body: JSON.stringify({ error: 'Invalid JSON' }) };
  }

  const { category, months = 3 } = body;

  if (!category || !PROMPTS[category]) {
    return {
      statusCode: 400,
      headers,
      body: JSON.stringify({ error: 'Invalid category. Use: ' + Object.keys(PROMPTS).join(', ') }),
    };
  }

  const supabaseUrl = process.env.SUPABASE_URL;
  const supabaseKey = process.env.SUPABASE_ANON_KEY;
  const apiKey = process.env.ANTHROPIC_API_KEY;

  if (!apiKey) {
    return { statusCode: 500, headers, body: JSON.stringify({ error: 'ANTHROPIC_API_KEY not set' }) };
  }

  if (supabaseUrl && supabaseKey) {
    try {
      const cacheRes = await fetch(
        supabaseUrl + '/rest/v1/gazette_cache?category=eq.' + encodeURIComponent(category) + '&months=eq.' + months + '&select=notices,updated_at',
        { headers: { apikey: supabaseKey, Authorization: 'Bearer ' + supabaseKey } }
      );
      if (cacheRes.ok) {
        const cacheData = await cacheRes.json();
        if (cacheData && cacheData.length > 0) {
          const row = cacheData[0];
          const ageHours = (Date.now() - new Date(row.updated_at).getTime()) / 3600000;
          if (ageHours < 168 && Array.isArray(row.notices) && row.notices.length > 0) {
            return { statusCode: 200, headers, body: JSON.stringify({ notices: row.notices, cached: true }) };
          }
        }
      }
    } catch (err) { console.error('Cache read error:', err.message); }
  }

  const userMsg = PROMPTS[category].replace('{months}', months);
  let notices = [];
  try {
    const aiRes = await fetch('https://api.anthropic.com/v1/messages', {
      method: 'POST',
      headers: { 'x-api-key': apiKey, 'anthropic-version': '2023-06-01', 'Content-Type': 'application/json' },
      body: JSON.stringify({
        model: 'claude-haiku-4-5-20251001',
        max_tokens: 2000,
        system: GAZETTE_CONTEXT,
        tools: [{ type: 'web_search_20250305', name: 'web_search', max_uses: 3 }],
        messages: [{ role: 'user', content: userMsg }],
      }),
    });
    if (!aiRes.ok) throw new Error('Anthropic API ' + aiRes.status + ': ' + await aiRes.text());
    const aiData = await aiRes.json();
    const textBlocks = (aiData.content || []).filter((b) => b.type === 'text').map((b) => b.text).join('');
    const clean = textBlocks.replace(/```json|```/g, '').trim();
    const parsed = JSON.parse(clean);
    notices = Array.isArray(parsed) ? parsed : [];
  } catch (err) {
    console.error('AI fetch error:', err.message);
    return { statusCode: 502, headers, body: JSON.stringify({ error: 'Failed to fetch notices: ' + err.message }) };
  }

  if (supabaseUrl && supabaseKey && notices.length > 0) {
    try {
      await fetch(supabaseUrl + '/rest/v1/gazette_cache', {
        method: 'POST',
        headers: { apikey: supabaseKey, Authorization: 'Bearer ' + supabaseKey, 'Content-Type': 'application/json', Prefer: 'resolution=merge-duplicates' },
        body: JSON.stringify({ category, months, notices, updated_at: new Date().toISOString() }),
      });
    } catch (err) { console.error('Cache write error:', err.message); }
  }

  return { statusCode: 200, headers, body: JSON.stringify({ notices, cached: false }) };
};
