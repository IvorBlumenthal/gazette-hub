// netlify/functions/gazette.js
// Two-step approach: Step 1 uses web_search to find real notices.
// Step 2 converts the search results into strict JSON.
// Checks Supabase cache first (7 day TTL).

const SEARCH_QUERIES = {
  labour:      'South African Government Gazette labour employment wage determination {year} site:gpwonline.co.za OR site:gov.za',
  tax:         'South African Government Gazette SARS tax treasury {year} site:gpwonline.co.za OR site:gov.za',
  bbbee:       'South African Government Gazette B-BBEE transformation codes charter {year} site:gpwonline.co.za OR site:gov.za',
  regs:        'South African Government Gazette Companies Act CIPC regulations {year} site:gpwonline.co.za OR site:gov.za',
  procurement: 'South African Government Gazette procurement tender PFMA treasury {year} site:gpwonline.co.za OR site:gov.za',
  environment: 'South African Government Gazette NEMA environment carbon {year} site:gpwonline.co.za OR site:gov.za',
  health:      'South African Government Gazette OHS health NHI occupational {year} site:gpwonline.co.za OR site:gov.za',
};

const CATEGORY_DESC = {
  labour:      'Labour and Employment (wages, CCMA, equity, sectoral determinations, UIF)',
  tax:         'Tax and Revenue (SARS, VAT, customs, Treasury, income tax)',
  bbbee:       'B-BBEE and Transformation (codes, charters, verification, DTI)',
  regs:        'Company Regulations (Companies Act, CIPC, business licensing)',
  procurement: 'Government Procurement (PFMA, SCM, preferential procurement)',
  environment: 'Environment and Sustainability (NEMA, EIA, waste, carbon tax)',
  health:      'Health and OHS (OHS Act, NHI, pharmaceuticals, workplace safety)',
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
  if (!category || !SEARCH_QUERIES[category]) {
    return { statusCode: 400, headers, body: JSON.stringify({ error: 'Invalid category' }) };
  }

  const supabaseUrl = process.env.SUPABASE_URL;
  const supabaseKey = process.env.SUPABASE_ANON_KEY;
  const apiKey = process.env.ANTHROPIC_API_KEY;
  if (!apiKey) return { statusCode: 500, headers, body: JSON.stringify({ error: 'ANTHROPIC_API_KEY not set' }) };

  // Step 1: Check Supabase cache
  if (supabaseUrl && supabaseKey) {
    try {
      const cacheRes = await fetch(
        supabaseUrl + '/rest/v1/gazette_cache?category=eq.' + encodeURIComponent(category) + '&months=eq.' + months + '&select=notices,updated_at',
        { headers: { apikey: supabaseKey, Authorization: 'Bearer ' + supabaseKey } }
      );
      if (cacheRes.ok) {
        const rows = await cacheRes.json();
        if (rows && rows.length > 0) {
          const ageHours = (Date.now() - new Date(rows[0].updated_at).getTime()) / 3600000;
          if (ageHours < 168 && Array.isArray(rows[0].notices) && rows[0].notices.length > 0) {
            return { statusCode: 200, headers, body: JSON.stringify({ notices: rows[0].notices, cached: true }) };
          }
        }
      }
    } catch (err) { console.error('Cache read:', err.message); }
  }

  // Step 2: Web search via Anthropic to get raw gazette info
  const currentYear = new Date().getFullYear();
  const searchQuery = SEARCH_QUERIES[category].replace('{year}', currentYear);
  const monthsAgo = new Date(Date.now() - months * 30 * 24 * 3600000);
  const dateStr = monthsAgo.toISOString().slice(0, 10);

  let rawSearchContent = '';
  try {
    const searchRes = await fetch('https://api.anthropic.com/v1/messages', {
      method: 'POST',
      headers: { 'x-api-key': apiKey, 'anthropic-version': '2023-06-01', 'Content-Type': 'application/json' },
      body: JSON.stringify({
        model: 'claude-haiku-4-5-20251001',
        max_tokens: 2000,
        tools: [{ type: 'web_search_20250305', name: 'web_search', max_uses: 4 }],
        messages: [{
          role: 'user',
          content: 'Search for real South African Government Gazette notices about ' + CATEGORY_DESC[category] + ' published after ' + dateStr + '. Find gazette numbers, dates, and notice titles. Search: ' + searchQuery
        }],
      }),
    });
    if (searchRes.ok) {
      const searchData = await searchRes.json();
      rawSearchContent = (searchData.content || []).filter(b => b.type === 'text').map(b => b.text).join(' ');
      console.log('Search content length:', rawSearchContent.length);
    }
  } catch (err) { console.error('Search step error:', err.message); }

  // Step 3: Convert to strict JSON
  const jsonSystemMsg = 'You output ONLY a raw JSON array. No words before or after. Start with [ end with ]. Each element must have exactly these fields: title, gazette_no, date, summary, practitioner_note, category. Use real gazette data from the search results provided. If search results are sparse, supplement with your knowledge of recent SA gazettes in this category.';
  const jsonUserMsg = (rawSearchContent
    ? 'Using these search results about SA Government Gazettes:

' + rawSearchContent.slice(0, 3000) + '

'
    : '') +
    'Create a JSON array of 8 South African Government Gazette notices about ' + CATEGORY_DESC[category] + ' from the last ' + months + ' months (after ' + dateStr + '). Respond with ONLY the JSON array, nothing else.';

  let notices = [];
  try {
    const jsonRes = await fetch('https://api.anthropic.com/v1/messages', {
      method: 'POST',
      headers: { 'x-api-key': apiKey, 'anthropic-version': '2023-06-01', 'Content-Type': 'application/json' },
      body: JSON.stringify({
        model: 'claude-haiku-4-5-20251001',
        max_tokens: 3000,
        system: jsonSystemMsg,
        messages: [{ role: 'user', content: jsonUserMsg }],
      }),
    });
    if (!jsonRes.ok) throw new Error('JSON step HTTP ' + jsonRes.status);
    const jsonData = await jsonRes.json();
    const rawText = (jsonData.content || []).filter(b => b.type === 'text').map(b => b.text).join('').trim();
    console.log('JSON response preview:', rawText.slice(0, 150));
    const startIdx = rawText.indexOf('[');
    const endIdx = rawText.lastIndexOf(']');
    if (startIdx === -1 || endIdx === -1) throw new Error('No JSON array found: ' + rawText.slice(0, 100));
    notices = JSON.parse(rawText.slice(startIdx, endIdx + 1));
    if (!Array.isArray(notices)) notices = [];
  } catch (err) {
    console.error('JSON step error:', err.message);
    return { statusCode: 502, headers, body: JSON.stringify({ error: 'Failed to format notices: ' + err.message }) };
  }

  // Step 4: Cache in Supabase
  if (supabaseUrl && supabaseKey && notices.length > 0) {
    try {
      await fetch(supabaseUrl + '/rest/v1/gazette_cache', {
        method: 'POST',
        headers: { apikey: supabaseKey, Authorization: 'Bearer ' + supabaseKey, 'Content-Type': 'application/json', Prefer: 'resolution=merge-duplicates' },
        body: JSON.stringify({ category, months, notices, updated_at: new Date().toISOString() }),
      });
    } catch (err) { console.error('Cache write:', err.message); }
  }

  return { statusCode: 200, headers, body: JSON.stringify({ notices, cached: false }) };
};
