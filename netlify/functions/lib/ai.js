// netlify/functions/lib/ai.js
// Shared helper for asking Claude for a JSON array of gazette notices.
// Used by both gazette.js (live, on-demand requests) and
// gazette-scheduler.js (weekly cache warm-up), so the same reliability
// fixes apply everywhere instead of drifting between the two.

const MODEL = 'claude-haiku-4-5-20251001';

const JSON_SYSTEM = 'You are a South African government gazette expert. Output ONLY a raw JSON array. Start with [ and end with ]. '
  + 'Each object: {"title":"string","gazette_no":"string","date":"YYYY-MM-DD","summary":"2-3 sentences","practitioner_note":"1 sentence for employers","category":"string","source_url":"string"}. '
  + 'For "source_url": if your web search found the actual gazette notice, PDF, or an official page describing it, use that exact URL. '
  + 'If you could not find a specific verifiable URL for this notice, use the general official South African Government Gazette portal instead: '
  + '"https://www.gov.za/documents/govt-gazette" — never invent or guess a specific-looking URL you did not actually see in search results, '
  + 'since a fabricated deep link is worse than the general portal link. '
  + 'No text before or after the array. This rule applies no matter what: even if your search finds few or no results, you must still return a JSON array of '
  + '8 objects using your general knowledge of real or representative SA gazette notices for the topic and period — never explain that results were limited, '
  + 'never write a sentence like "Based on the search results", never apologise, never add markdown code fences. Your entire reply must be parseable JSON, nothing else.';

const RETRY_NOTE = '\n\nIMPORTANT: Your previous attempt did not return valid JSON. This time, respond with ONLY the JSON array — no introductory sentence, '
  + 'no explanation of search results, no markdown fences. Start your reply with the character [ and end it with ].';

// How long to wait for a single Anthropic API call before giving up on it and
// moving on. Without this, a single hung request (rare, but it happens) could
// silently eat the scheduler's entire 15-minute budget and leave most
// categories without a fresh cache for the week — worse than one category
// failing on its own.
const REQUEST_TIMEOUT_MS = 45000;

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

// Same idea as extractJsonArray, but for a single {...} object rather than
// an array — used by the newsletter writer, which returns one JSON object.
function extractJsonObject(text) {
  const si = text.indexOf('{');
  const ei = text.lastIndexOf('}');
  if (si === -1 || ei <= si) return null;
  let slice = text.slice(si, ei + 1);
  slice = slice.replace(/,\s*([\]}])/g, '$1');
  try {
    const parsed = JSON.parse(slice);
    return (parsed && typeof parsed === 'object' && !Array.isArray(parsed)) ? parsed : null;
  } catch (e) {
    return null;
  }
}

async function callAIOnce(apiKey, systemPrompt, userPrompt, useSearch, maxTokens) {
  const body = {
    model: MODEL,
    max_tokens: maxTokens,
    system: systemPrompt,
    messages: [{ role: 'user', content: userPrompt }],
  };
  if (useSearch) body.tools = [{ type: 'web_search_20250305', name: 'web_search', max_uses: 1 }];

  const controller = new AbortController();
  const timer = setTimeout(function () { controller.abort(); }, REQUEST_TIMEOUT_MS);

  let res;
  try {
    res = await fetch('https://api.anthropic.com/v1/messages', {
      method: 'POST',
      headers: { 'x-api-key': apiKey, 'anthropic-version': '2023-06-01', 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
      signal: controller.signal,
    });
  } catch (e) {
    if (e.name === 'AbortError') throw new Error('Anthropic request timed out after ' + (REQUEST_TIMEOUT_MS / 1000) + 's');
    throw e;
  } finally {
    clearTimeout(timer);
  }
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
      const text = await callAIOnce(apiKey, JSON_SYSTEM, attempt.prompt, attempt.search, attempt.maxTokens);
      const parsed = extractJsonArray(text);
      if (parsed) return parsed;
      lastErr = new Error('No JSON array found. Got: ' + text.slice(0, 150));
    } catch (err) {
      lastErr = err;
    }
  }
  throw lastErr || new Error('Unknown error generating notices');
}

// System prompt for the monthly newsletter writer. Unlike callAI above, this
// is never given raw search access — it's handed the real, already-verified
// notices for the month (title/date/summary/source_url, gathered the same
// way the rest of the site gathers them) and asked only to write readable
// prose around them. Keeping it to plain-text fields (no HTML) means the
// site can safely render the output itself, the same way it already
// escapes and formats notice text elsewhere.
const NEWSLETTER_SYSTEM = 'You are writing a monthly email newsletter digest of South African Government Gazette notices for employers, on behalf of ArkKonsult. '
  + 'You will be given real notices grouped by category. Output ONLY a raw JSON object. Start with { and end with }. '
  + 'Shape: {"subject":"string - email subject line, specific and useful, e.g. \'ArkKonsult Gazette Digest — August 2026\'","title":"string - newsletter headline","intro":"string - 2-3 plain-text sentences overviewing the month, no HTML tags","sections":[{"categoryId":"string - must exactly match one of the category ids given to you","synthesis":"string - 2-4 plain-text sentences summarising what happened in this category this month and why an employer should care, no HTML tags"}]}. '
  + 'Only include a section for a categoryId that was actually given notices. Do not invent notices or details beyond what was provided. '
  + 'No text before or after the JSON object, no markdown fences, no HTML tags anywhere in the values — plain sentences only, since the site adds its own formatting.';

const NEWSLETTER_RETRY_NOTE = '\n\nIMPORTANT: Your previous attempt did not return valid JSON. This time, respond with ONLY the JSON object — no introductory sentence, '
  + 'no explanation, no markdown fences, no HTML tags in any value. Start your reply with the character { and end it with }.';

// Writes the monthly newsletter's prose (subject/title/intro/per-category
// synthesis) from real notices the caller already gathered — no web search
// needed here, so this is faster and cheaper than callAI, and can't
// hallucinate notices that don't exist.
async function callAINewsletter(apiKey, userPrompt) {
  const attempts = [
    { prompt: userPrompt, maxTokens: 2000 },
    { prompt: userPrompt + NEWSLETTER_RETRY_NOTE, maxTokens: 2000 },
  ];

  let lastErr = null;
  for (let i = 0; i < attempts.length; i++) {
    const attempt = attempts[i];
    try {
      const text = await callAIOnce(apiKey, NEWSLETTER_SYSTEM, attempt.prompt, false, attempt.maxTokens);
      const parsed = extractJsonObject(text);
      if (parsed) return parsed;
      lastErr = new Error('No JSON object found. Got: ' + text.slice(0, 150));
    } catch (err) {
      lastErr = err;
    }
  }
  throw lastErr || new Error('Unknown error generating newsletter text');
}

module.exports = { callAI, callAINewsletter, extractJsonArray, extractJsonObject, MODEL };
