// netlify/functions/gazette-scheduler.js
// Runs every Monday at 06:00 SAST (04:00 UTC) via netlify.toml cron
// Pre-fetches gazette notices for all categories and caches them in Supabase
// so the app loads instantly without waiting for API calls.
//
// Required environment variables:
//   ANTHROPIC_API_KEY   - your Anthropic key
//   SUPABASE_URL        - your Supabase project URL
//   SUPABASE_SERVICE_KEY - your Supabase service_role key

const CATEGORIES = ['labour','bbbee','regs','procurement','environment','health','tax'];
const PERIODS = [3, 6, 12, 24];

const GAZETTE_CONTEXT = 'You are an expert on South African Government Gazettes. Return only valid JSON arrays. Each object must have: title, gazette_no, date, summary, practitioner_note, category.';

const CATEGORY_PROMPTS = {
  labour: 'List 8 real SA Government Gazette notices on Labour and Employment for the period. Include wage determinations, CCMA rules, bargaining council agreements, LRA/BCEA amendments, UIF notices.',
  bbbee: 'List 8 real SA Government Gazette notices on B-BBEE for the period. Include Codes of Good Practice, sector charters, B-BBEE Commission notices.',
  regs: 'List 8 real SA Government Gazette notices on Regulations and Bills for the period. Include new Bills, commencement notices, Companies Act regulations, POPIA.',
  procurement: 'List 8 real SA Government Gazette notices on Procurement for the period. Include PPPFA regulations, National Treasury instruction notes, PFMA regulations.',
  environment: 'List 8 real SA Government Gazette notices on Environment for the period. Include NEMA regulations, carbon tax, biodiversity, waste management.',
  health: 'List 8 real SA Government Gazette notices on Health for the period. Include NHI notices, SAHPRA regulations, Medicines Act amendments.',
  tax: 'List 8 real SA Government Gazette notices on Tax and Finance for the period. Include SARS rulings, tax tables, VAT thresholds, National Treasury regulations.',
};

const PERIOD_TEXT = {
  3: 'February 2025 to May 2025',
  6: 'November 2024 to May 2025',
  12: 'May 2024 to May 2025',
  24: 'May 2023 to May 2025',
};

async function fetchNotices(category, months, apiKey) {
  const prompt = CATEGORY_PROMPTS[category] + ' Period: ' + PERIOD_TEXT[months] + '. Return the JSON array now.';
  const resp = await fetch('https://api.anthropic.com/v1/messages', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'x-api-key': apiKey, 'anthropic-version': '2023-06-01' },
    body: JSON.stringify({ model: 'claude-opus-4-7', max_tokens: 2000, system: GAZETTE_CONTEXT, messages: [{ role: 'user', content: prompt }] }),
  });
  if (!resp.ok) throw new Error('Anthropic error ' + resp.status);
  const data = await resp.json();
  const text = (data.content || []).filter(b => b.type === 'text').map(b => b.text).join('');
  const match = text.replace(/```json|```/g, '').trim().match(/\[[\s\S]*\]/);
  return match ? JSON.parse(match[0]) : [];
}

async function upsertCache(supabaseUrl, serviceKey, category, months, notices) {
  const resp = await fetch(supabaseUrl + '/rest/v1/gazette_cache', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'apikey': serviceKey,
      'Authorization': 'Bearer ' + serviceKey,
      'Prefer': 'resolution=merge-duplicates',
    },
    body: JSON.stringify({
      category,
      months,
      notices: JSON.stringify(notices),
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
    return { statusCode: 500, body: JSON.stringify({ error: 'Missing environment variables' }) };
  }

  // Allow manual trigger for testing
  const isManual = event.httpMethod === 'GET';
  if (isManual && event.queryStringParameters?.secret !== process.env.MANUAL_TRIGGER_SECRET) {
    return { statusCode: 401, body: 'Unauthorised' };
  }

  const results = [];
  console.log('Gazette scheduler started:', new Date().toISOString());

  for (const category of CATEGORIES) {
    for (const months of PERIODS) {
      try {
        console.log(`Fetching ${category} / ${months} months...`);
        const notices = await fetchNotices(category, months, apiKey);
        const saved = await upsertCache(supabaseUrl, serviceKey, category, months, notices);
        results.push({ category, months, count: notices.length, saved });
        console.log(`  Done: ${notices.length} notices`);
        // Delay between calls to avoid rate limits
        await new Promise(r => setTimeout(r, 2000));
      } catch (e) {
        console.error(`  Error for ${category}/${months}:`, e.message);
        results.push({ category, months, error: e.message });
      }
    }
  }

  console.log('Scheduler complete:', results.length, 'combinations processed');
  return { statusCode: 200, body: JSON.stringify({ processed: results.length, results }) };
};
