// netlify/functions/lib/ai.js
// Shared helper for asking Claude for a JSON array of gazette notices.
// Used by both gazette.js (live, on-demand requests) and
// gazette-scheduler.js (weekly cache warm-up), so the same reliability
// fixes apply everywhere instead of drifting between the two.

const MODEL = 'claude-haiku-4-5-20251001';

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
    model: MODEL,
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
//      does when live results are thin).
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

module.exports = { callAI, extractJsonArray, MODEL };

