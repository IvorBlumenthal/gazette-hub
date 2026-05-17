// netlify/functions/gazette.js
// Single Anthropic API call with web_search tool.
// Handles mixed response (tool use + text) correctly.
// Checks Supabase cache first (7 day TTL).

const CATEGORY_DESC = {
  labour:      'Labour and Employment: wage determinations, CCMA notices, employment equity, sectoral determinations, UIF',
  tax:         'Tax and Revenue: SARS notices, VAT, customs, National Treasury, income tax amendments',
  bbbee:       'B-BBEE and Transformation: codes of good practice, sector charters, verification, DTI notices',
  regs:        'Company Regulations: Companies Act amendments, CIPC notices, business licensing, consumer protection',
  procurement: 'Government Procurement: PFMA, supply chain management, preferential procurement, Treasury instructions',
  environment: 'Environment and Sustainability: NEMA, environmental impact assessments, waste management, carbon tax',
  health:      'Health and OHS: OHS Act, NHI notices, pharmaceutical regulations, workplace safety',
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

  let reqBody;
  try {
    reqBody = JSON.parse(event.body || '{}');
  } catch (e) {
    return { statusCode: 400, headers, body: JSON.stringify({ error: 'Invalid JSON' }) };
  }

  const category = reqBody.category;
  const months = reqBody.months || 3;

  if (!category || !CATEGORY_DESC[category]) {
    return { statusCode: 400, headers, body: JSON.stringify({ error: 'Invalid category' }) };
  }

  const supabaseUrl = process.env.SUPABASE_URL;
  const supabaseKey = process.env.SUPABASE_ANON_KEY;
  const apiKey = process.env.ANTHROPIC_API_KEY;

  if (!apiKey) {
    return { statusCode: 500, headers, body: JSON.stringify({ error: 'ANTHROPIC_API_KEY not set' }) };
  }

  if (supabaseUrl && supabaseKey) {
    try {
      const cacheUrl = supabaseUrl + '/rest/v1/gazette_cache?category=eq.' + encodeURIComponent(category) + '&months=eq.' + months + '&select=notices,updated_at';
      const cacheRes = await fetch(cacheUrl, {
        headers: { apikey: supabaseKey, Authorization: 'Bearer ' + supabaseKey },
      });
      if (cacheRes.ok) {
        const rows = await cacheRes.json();
        if (rows && rows.length > 0 && Array.isArray(rows[0].notices) && rows[0].notices.length > 0) {
          const ageHours = (Date.now() - new Date(rows[0].updated_at).getTime()) / 3600000;
          if (ageHours < 168) {
            return { statusCode: 200, headers, body: JSON.stringify({ notices: rows[0].notices, cached: true }) };
          }
        }
      }
    } catch (cacheErr) {
      console.error('Cache read error:', cacheErr.message);
    }
  }

  const currentYear = new Date().getFullYear();
  const desc = CATEGORY_DESC[category];

  const userPrompt = 'Search for real South African Government Gazette notices published in ' + currentYear + ' about: ' + desc + '. '
    + 'Search gpwonline.co.za and gov.za. Find gazette numbers, publication dates, and notice titles from the last ' + months + ' months. '
    + 'After searching, return ONLY a JSON array. No text before or after the JSON. '
    + 'Each element: {"title":"...","gazette_no":"...","date":"...","summary":"2-3 sentences","practitioner_note":"1 sentence for employers","category":"' + category + '"}. '
    + 'Return 6 to 8 notices. Start your response with [ and end with ].';

  const systemPrompt = 'You are a South African government gazette analyst. '
    + 'You use web search to find real gazette notices. '
    + 'After searching, you output ONLY a valid JSON array starting with [ and ending with ]. '
    + 'No markdown, no backticks, no explanation text. Just the raw JSON array.';

  let notices = [];
  try {
    const aiRes = await fetch('https://api.anthropic.com/v1/messages', {
      method: 'POST',
      headers: {
        'x-api-key': apiKey,
        'anthropic-version': '2023-06-01',
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        model: 'claude-haiku-4-5-20251001',
        max_tokens: 3000,
        system: systemPrompt,
        tools: [{ type: 'web_search_20250305', name: 'web_search', max_uses: 3 }],
        messages: [{ role: 'user', content: userPrompt }],
      }),
    });

    if (!aiRes.ok) {
      const errBody = await aiRes.text();
      throw new Error('Anthropic HTTP ' + aiRes.status + ': ' + errBody.slice(0, 200));
    }

    const aiData = await aiRes.json();
    const textParts = (aiData.content || [])
      .filter(function(b) { return b.type === 'text'; })
      .map(function(b) { return b.text; })
      .join('');

    console.log('Response preview:', textParts.slice(0, 200));

    const startIdx = textParts.indexOf('[');
    const endIdx = textParts.lastIndexOf(']');

    if (startIdx === -1 || endIdx === -1 || endIdx <= startIdx) {
      throw new Error('No JSON array found. Got: ' + textParts.slice(0, 150));
    }

    const parsed = JSON.parse(textParts.slice(startIdx, endIdx + 1));
    notices = Array.isArray(parsed) ? parsed : [];

  } catch (aiErr) {
    console.error('AI error:', aiErr.message);
    return { statusCode: 502, headers, body: JSON.stringify({ error: 'Failed to fetch notices: ' + aiErr.message }) };
  }

  if (supabaseUrl && supabaseKey && notices.length > 0) {
    try {
      await fetch(supabaseUrl + '/rest/v1/gazette_cache', {
        method: 'POST',
        headers: {
          apikey: supabaseKey,
          Authorization: 'Bearer ' + supabaseKey,
          'Content-Type': 'application/json',
          Prefer: 'resolution=merge-duplicates',
        },
        body: JSON.stringify({ category: category, months: months, notices: notices, updated_at: new Date().toISOString() }),
      });
    } catch (writeErr) {
      console.error('Cache write error:', writeErr.message);
    }
  }

  return { statusCode: 200, headers, body: JSON.stringify({ notices: notices, cached: false }) };
};
