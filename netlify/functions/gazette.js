// netlify/functions/gazette.js
// Secure server-side proxy. Set ANTHROPIC_API_KEY in Netlify environment variables.

exports.handler = async (event) => {
    if (event.httpMethod !== 'POST') {
          return { statusCode: 405, body: JSON.stringify({ error: 'Method not allowed' }) };
    }

    const apiKey = process.env.ANTHROPIC_API_KEY;
    if (!apiKey) {
          return { statusCode: 500, body: JSON.stringify({ error: 'API key not configured' }) };
    }

    let payload;
    try { payload = JSON.parse(event.body); }
    catch { return { statusCode: 400, body: JSON.stringify({ error: 'Invalid JSON' }) }; }

    const { type, userMsg, prompt } = payload;

    if (type === 'gazette') {
          try {
                  const resp = await fetch('https://api.anthropic.com/v1/messages', {
                            method: 'POST',
                            headers: { 'Content-Type': 'application/json', 'x-api-key': apiKey, 'anthropic-version': '2023-06-01' },
                            body: JSON.stringify({
                                        model: 'claude-3-haiku-20240307',
                                        max_tokens: 2000,
                                        system: 'You are a South African government gazette analyst with deep knowledge of SA Government Gazettes published up to May 2025. Return only valid JSON arrays. Never invent notices. If nothing found, return [].',
                                        messages: [{ role: 'user', content: userMsg }],
                            }),
                  });
                  if (!resp.ok) {
                            const err = await resp.json().catch(() => ({}));
                            console.error('Anthropic error:', JSON.stringify(err));
                            return { statusCode: 502, body: JSON.stringify({ error: err.error?.message || 'API error' }) };
                  }
                  const data = await resp.json();
                  const text = (data.content || []).filter(b => b.type === 'text').map(b => b.text).join('');
                  const match = text.replace(/```json|```/g, '').trim().match(/\[[\s\S]*\]/);
                  const notices = match ? JSON.parse(match[0]) : [];
                  return { statusCode: 200, headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ notices }) };
          } catch (e) {
                  console.error('gazette error:', e.message);
                  return { statusCode: 500, body: JSON.stringify({ error: e.message }) };
          }
    }

    if (type === 'extract') {
          try {
                  const resp = await fetch('https://api.anthropic.com/v1/messages', {
                            method: 'POST',
                            headers: { 'Content-Type': 'application/json', 'x-api-key': apiKey, 'anthropic-version': '2023-06-01' },
                            body: JSON.stringify({
                                        model: 'claude-3-haiku-20240307',
                                        max_tokens: 700,
                                        messages: [{ role: 'user', content: prompt }],
                            }),
                  });
                  if (!resp.ok) {
                            const err = await resp.json().catch(() => ({}));
                            return { statusCode: 502, body: JSON.stringify({ error: err.error?.message || 'API error' }) };
                  }
                  const data = await resp.json();
                  const text = (data.content || []).filter(b => b.type === 'text').map(b => b.text).join('').trim();
                  return { statusCode: 200, headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ text }) };
          } catch (e) {
                  return { statusCode: 500, body: JSON.stringify({ error: e.message }) };
          }
    }

    return { statusCode: 400, body: JSON.stringify({ error: 'Unknown type' }) };
};
