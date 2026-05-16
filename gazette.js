// netlify/functions/gazette.js
// Secure server-side proxy — the Anthropic API key never reaches the browser.
// Set ANTHROPIC_API_KEY in Netlify → Site settings → Environment variables.

exports.handler = async (event) => {
  // Only accept POST
  if (event.httpMethod !== 'POST') {
    return { statusCode: 405, body: JSON.stringify({ error: 'Method not allowed' }) };
  }

  const apiKey = process.env.ANTHROPIC_API_KEY;
  if (!apiKey) {
    console.error('ANTHROPIC_API_KEY environment variable is not set');
    return {
      statusCode: 500,
      body: JSON.stringify({ error: 'Server configuration error — API key not set' }),
    };
  }

  let payload;
  try {
    payload = JSON.parse(event.body);
  } catch {
    return { statusCode: 400, body: JSON.stringify({ error: 'Invalid JSON body' }) };
  }

  const { type, userMsg, prompt } = payload;

  // ── GAZETTE SEARCH ─────────────────────────────────────────────────────
  if (type === 'gazette') {
    if (!userMsg) {
      return { statusCode: 400, body: JSON.stringify({ error: 'Missing userMsg' }) };
    }

    try {
      const resp = await fetch('https://api.anthropic.com/v1/messages', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'x-api-key': apiKey,
          'anthropic-version': '2023-06-01',
        },
        body: JSON.stringify({
          model: 'claude-sonnet-4-20250514',
          max_tokens: 2000,
          system:
            'You are a South African government gazette analyst. ' +
            'You use web search to find real, verified gazette notices. ' +
            'You return only valid JSON arrays as instructed. ' +
            'You never invent notices. If nothing is found, return [].',
          tools: [{ type: 'web_search_20250305', name: 'web_search' }],
          messages: [{ role: 'user', content: userMsg }],
        }),
      });

      if (!resp.ok) {
        const err = await resp.json().catch(() => ({}));
        console.error('Anthropic API error:', err);
        return {
          statusCode: 502,
          body: JSON.stringify({ error: err.error?.message || 'Anthropic API error' }),
        };
      }

      const data = await resp.json();
      const text = (data.content || [])
        .filter((b) => b.type === 'text')
        .map((b) => b.text)
        .join('');

      const cleaned = text.replace(/```json|```/g, '').trim();
      const match = cleaned.match(/\[[\s\S]*\]/);
      const notices = match ? JSON.parse(match[0]) : [];

      return {
        statusCode: 200,
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ notices }),
      };
    } catch (e) {
      console.error('gazette handler error:', e);
      return {
        statusCode: 500,
        body: JSON.stringify({ error: 'Internal error: ' + e.message }),
      };
    }
  }

  // ── CLAUSE EXTRACTION ──────────────────────────────────────────────────
  if (type === 'extract') {
    if (!prompt) {
      return { statusCode: 400, body: JSON.stringify({ error: 'Missing prompt' }) };
    }

    try {
      const resp = await fetch('https://api.anthropic.com/v1/messages', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'x-api-key': apiKey,
          'anthropic-version': '2023-06-01',
        },
        body: JSON.stringify({
          model: 'claude-sonnet-4-20250514',
          max_tokens: 700,
          messages: [{ role: 'user', content: prompt }],
        }),
      });

      if (!resp.ok) {
        const err = await resp.json().catch(() => ({}));
        return {
          statusCode: 502,
          body: JSON.stringify({ error: err.error?.message || 'Anthropic API error' }),
        };
      }

      const data = await resp.json();
      const text = (data.content || [])
        .filter((b) => b.type === 'text')
        .map((b) => b.text)
        .join('')
        .trim();

      return {
        statusCode: 200,
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ text }),
      };
    } catch (e) {
      console.error('extract handler error:', e);
      return {
        statusCode: 500,
        body: JSON.stringify({ error: 'Internal error: ' + e.message }),
      };
    }
  }

  return { statusCode: 400, body: JSON.stringify({ error: 'Unknown request type' }) };
};
