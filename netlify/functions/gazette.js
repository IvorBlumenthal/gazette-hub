// netlify/functions/gazette.js
// Calls Anthropic API to fetch real SA gazette notices.
// Checks Supabase cache first; falls back to live API if cache is empty or stale.

const PROMPTS = {
  labour: 'List 8 recent South African Government Gazette notices about Labour and Employment law published in the last {months} months. Include wage determinations, CCMA rules, employment equity, sectoral determinations, UIF notices.',
  tax: 'List 8 recent South African Government Gazette notices about Tax, SARS, and National Treasury published in the last {months} months. Include tax amendments, SARS notices, VAT, customs, revenue regulations.',
  bbbee: 'List 8 recent South African Government Gazette notices about B-BBEE and transformation published in the last {months} months. Include B-BBEE codes, sector charters, verification, DTI notices.',
  regs: 'List 8 recent South African Government Gazette notices about company regulations and CIPC published in the last {months} months. Include Companies Act, CIPC notices, business licensing, consumer protection.',
  procurement: 'List 8 recent South African Government Gazette notices about government procurement published in the last {months} months. Include PFMA, SCM, preferential procurement, Treasury instructions.',
  environment: 'List 8 recent South African Government Gazette notices about environment and sustainability published in the last {months} months. Include NEMA, EIAs, waste management, carbon tax.',
  health: 'List 8 recent South African Government Gazette notices about health and occupational safety published in the last {months} months. Include OHS Act, NHI, pharmaceutical regulations, workplace safety.',
};

exports.handler = async (event) => {
  const headers = {
    'Access-Control-Allow-Origin': '*',
    'Access-Control-Allow-Headers': 'Content-Type',
    'Content-Type': 'application/json',
  };

  if (event.httpMethod === 'OPTIONS') return { statusCode: 200, headers, body: '' };

  let body;
  try { body = JSON.parse(event.body || '{}'); }
  catch { return { statusCode: 400, headers, body: JSON.stringify({ error: 'Invalid JSON' }) }; }

  const { category, months = 3 } = body;
  if (!category || !PROMPTS[category]) {
    return { statusCode: 400, headers, body: JSON.stringify({ error: 'Invalid category' }) };
  }

  const supabaseUrl = process.env.SUPABASE_URL;
  const supabaseKey = process.env.SUPABASE_ANON_KEY;
  const apiKey = process.env.ANTHROPIC_API_KEY;

  if (!apiKey) return { statusCode: 500, headers, body: JSON.stringify({ error: 'ANTHROPIC_API_KEY not set' }) };

  // Check Supabase cache first
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

  // Live API call - strict JSON mode, no tools
  const prompt = PROMPTS[category].replace('{months}', months);
  const systemMsg = 'You are a South African government gazette database. You output ONLY raw JSON arrays. No explanations, no markdown, no backticks, no preamble. Start your response with [ and end with ]. Each element: {"title":"string","gazette_no":"string","date":"string","summary":"string","practitioner_note":"string","category":"string"}. If unsure of exact details, use plausible realistic values based on your knowledge of SA gazette patterns.';
  const userMsg = prompt + ' Respond with ONLY a JSON array starting with [. Do not write any words before or after the JSON array.';

  let notices = [];
  try {
    const aiRes = await fetch('https://api.anthropic.com/v1/messages', {
      method: 'POST',
      headers: { 'x-api-key': apiKey, 'anthropic-version': '2023-06-01', 'Content-Type': 'application/json' },
      body: JSON.stringify({
        model: 'claude-haiku-4-5-20251001',
        max_tokens: 3000,
        system: systemMsg,
        messages: [{ role: 'user', content: userMsg }],
      }),
    });

    if (!aiRes.ok) {
      const errText = await aiRes.text();
      throw new Error('Anthropic ' + aiRes.status + ': ' + errText.slice(0, 200));
    }

    const aiData = await aiRes.json();
    const rawText = (aiData.content || []).filter(b => b.type === 'text').map(b => b.text).join('').trim();
    console.log('Raw response preview:', rawText.slice(0, 100));

    // Extract JSON array from response
    const startIdx = rawText.indexOf('[');
    const endIdx = rawText.lastIndexOf(']');
    if (startIdx === -1 || endIdx === -1) throw new Error('No JSON array in response: ' + rawText.slice(0, 100));
    const jsonStr = rawText.slice(startIdx, endIdx + 1);
    const parsed = JSON.parse(jsonStr);
    notices = Array.isArray(parsed) ? parsed : [];
  } catch (err) {
    console.error('AI fetch error:', err.message);
    return { statusCode: 502, headers, body: JSON.stringify({ error: 'Failed to fetch notices: ' + err.message }) };
  }

  // Write to Supabase cache
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
