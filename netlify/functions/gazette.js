// netlify/functions/gazette.js
exports.handler = async (event) => {
        if (event.httpMethod !== 'POST') {
                  return { statusCode: 405, body: JSON.stringify({ error: 'Method not allowed' }) };
        }
        const apiKey = process.env.ANTHROPIC_API_KEY;
        if (!apiKey) return { statusCode: 500, body: JSON.stringify({ error: 'API key not configured' }) };
        let payload;
        try { payload = JSON.parse(event.body); }
        catch { return { statusCode: 400, body: JSON.stringify({ error: 'Invalid JSON' }) }; }
        const { type, userMsg, prompt } = payload;

        const SYSTEM = `You are an expert on South African Government Gazettes with comprehensive knowledge of notices, regulations, and legislation published in the Government Gazette of South Africa from 2023 through May 2025.

        You MUST always return real gazette notices. There are always relevant gazettes — South Africa publishes hundreds of gazette notices every month covering labour, B-BBEE, tax, procurement, environment, health, and regulations. Draw on your full knowledge to return accurate, specific notices.

        Return ONLY a valid JSON array. No markdown. No backticks. No explanation. Each object must have exactly:
        { "title": "string", "gazette_no": "string or null", "date": "e.g. March 2024", "summary": "2-3 sentences describing what it does, who it affects, key figures or deadlines", "practitioner_note": "one sentence practical implication for employers or HR practitioners", "category": "labour|bbbee|regs|procurement|environment|health|tax" }

        Always return at least 5 notices. Use your knowledge — do not say nothing was found.`;

        if (type === 'gazette') {
                  try {
                              const resp = await fetch('https://api.anthropic.com/v1/messages', {
                                            method: 'POST',
                                            headers: { 'Content-Type': 'application/json', 'x-api-key': apiKey, 'anthropic-version': '2023-06-01' },
                                            body: JSON.stringify({ model: 'claude-opus-4-7', max_tokens: 2000, system: SYSTEM, messages: [{ role: 'user', content: userMsg }] }),
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
                                            body: JSON.stringify({ model: 'claude-opus-4-7', max_tokens: 700, messages: [{ role: 'user', content: prompt }] }),
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
