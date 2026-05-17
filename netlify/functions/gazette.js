// netlify/functions/gazette.js
// Set ANTHROPIC_API_KEY in Netlify environment variables.

const GAZETTE_CONTEXT = `You are an expert on South African Government Gazettes. The Government Printing Works publishes the Government Gazette multiple times per week. Recent publication dates include: 5 Jan 2024, 12 Jan 2024, 19 Jan 2024, 26 Jan 2024, 2 Feb 2024, 16 Feb 2024, 1 Mar 2024, 15 Mar 2024, 28 Mar 2024, 5 Apr 2024, 19 Apr 2024, 30 Apr 2024, 10 May 2024, 31 May 2024, 14 Jun 2024, 28 Jun 2024, 12 Jul 2024, 26 Jul 2024, 9 Aug 2024, 23 Aug 2024, 6 Sep 2024, 20 Sep 2024, 4 Oct 2024, 18 Oct 2024, 1 Nov 2024, 15 Nov 2024, 29 Nov 2024, 13 Dec 2024, 6 Jan 2025, 24 Jan 2025, 31 Jan 2025, 14 Feb 2025, 28 Feb 2025, 14 Mar 2025, 28 Mar 2025, 4 Apr 2025, 25 Apr 2025, 30 Apr 2025, 16 May 2025.

South Africa publishes dozens of gazette notices every week across labour, tax, B-BBEE, procurement, environment, health, and regulatory categories. You have comprehensive knowledge of these notices.

IMPORTANT: Always return real, specific gazette notices. Never return an empty array. There are always relevant notices to report.

Return ONLY a valid JSON array. No markdown. No backticks. No preamble. Each object must have exactly:
{"title":"string","gazette_no":"string or null","date":"e.g. March 2024","summary":"2-3 sentences: what it does, who it affects, key figures or deadlines","practitioner_note":"one sentence practical implication for employers or HR practitioners","category":"labour|bbbee|regs|procurement|environment|health|tax"}`;

const CATEGORY_PROMPTS = {
  labour: `List 8 real South African Government Gazette notices on Labour & Employment published in the period specified. Include: National Minimum Wage determinations, sectoral wage determinations, CCMA rules and fee schedules, bargaining council main agreements and extensions, LRA or BCEA amendments, employment equity reports and targets, UIF notices, Protected Disclosures Act notices, Essential Services Committee determinations.`,
  bbbee: `List 8 real South African Government Gazette notices on B-BBEE published in the period specified. Include: B-BBEE Codes of Good Practice amendments, sector charters (mining, construction, financial sector, ICT, tourism, property), generic codes updates, B-BBEE Commission notices, verification agency accreditation notices, preferential procurement regulations.`,
  regs: `List 8 real South African Government Gazette notices on Regulations & Bills published in the period specified. Include: new Bills tabled in Parliament, regulations under existing Acts, commencement notices for new legislation, amendment Bills, National Assembly notices, regulations under the Companies Act, Consumer Protection Act regulations, POPIA regulations.`,
  procurement: `List 8 real South African Government Gazette notices on Procurement & Tenders published in the period specified. Include: Preferential Procurement Policy Framework Act regulations, PPPFA threshold amendments, National Treasury instruction notes, public sector tender notices, PFMA regulations, supply chain management circulars, State Information Technology Agency notices.`,
  environment: `List 8 real South African Government Gazette notices on Environment published in the period specified. Include: NEMA regulations, environmental impact assessment regulations, carbon tax notices, National Environmental Management Acts amendments, biodiversity notices, waste management regulations, climate change response notices, DFFE department notices.`,
  health: `List 8 real South African Government Gazette notices on Health & Medicines published in the period specified. Include: NHI Act notices, SAHPRA regulations and schedules, Medicines and Related Substances Act amendments, scheduled substance notices, medical aid regulations, Council for Medical Schemes notices, tobacco control regulations, COVID-19 related health notices.`,
  tax: `List 8 real South African Government Gazette notices on Tax & Finance published in the period specified. Include: SARS binding general rulings, tax table determinations, VAT registration thresholds, Tax Administration Act notices, Income Tax Act amendments, Customs and Excise Act notices, carbon tax notices, National Treasury regulations, financial sector conduct authority notices.`,
  all: `List 10 real South African Government Gazette notices across ALL practitioner categories published in the period specified. Include a mix from: labour law (wage determinations, bargaining council agreements), B-BBEE (codes, charters), tax (SARS notices, tax tables), regulations (new Acts, amendments), procurement (PPPFA, National Treasury), environment (NEMA), and health (SAHPRA, NHI).`
};

exports.handler = async (event) => {
  if (event.httpMethod !== 'POST') {
    return { statusCode: 405, body: JSON.stringify({ error: 'Method not allowed' }) };
  }
  const apiKey = process.env.ANTHROPIC_API_KEY;
  if (!apiKey) return { statusCode: 500, body: JSON.stringify({ error: 'API key not configured' }) };

  let payload;
  try { payload = JSON.parse(event.body); }
  catch { return { statusCode: 400, body: JSON.stringify({ error: 'Invalid JSON' }) }; }

  const { type, category, months, query, title, summary, date, sector, context } = payload;

  // ── GAZETTE LIBRARY ───────────────────────────────────────────────────────
  if (type === 'gazette') {
    const catPrompt = CATEGORY_PROMPTS[category] || CATEGORY_PROMPTS['all'];
    const periodText = months === 3 ? 'February 2025 to May 2025'
      : months === 6 ? 'November 2024 to May 2025'
      : months === 12 ? 'May 2024 to May 2025'
      : 'May 2023 to May 2025';

    const userMsg = `${catPrompt}\n\nPeriod: ${periodText}.\n\nReturn the JSON array now.`;

    try {
      const resp = await fetch('https://api.anthropic.com/v1/messages', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'x-api-key': apiKey, 'anthropic-version': '2023-06-01' },
        body: JSON.stringify({ model: 'claude-opus-4-7', max_tokens: 2000, system: GAZETTE_CONTEXT, messages: [{ role: 'user', content: userMsg }] }),
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

  // ── SEARCH ────────────────────────────────────────────────────────────────
  if (type === 'search') {
    const userMsg = `List 8 real South African Government Gazette notices related to: "${query}"\n\nSearch across all gazette categories from May 2023 to May 2025. Return specific, real notices with accurate dates and gazette numbers where known.\n\nReturn the JSON array now.`;

    try {
      const resp = await fetch('https://api.anthropic.com/v1/messages', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'x-api-key': apiKey, 'anthropic-version': '2023-06-01' },
        body: JSON.stringify({ model: 'claude-opus-4-7', max_tokens: 2000, system: GAZETTE_CONTEXT, messages: [{ role: 'user', content: userMsg }] }),
      });
      if (!resp.ok) {
        const err = await resp.json().catch(() => ({}));
        return { statusCode: 502, body: JSON.stringify({ error: err.error?.message || 'API error' }) };
      }
      const data = await resp.json();
      const text = (data.content || []).filter(b => b.type === 'text').map(b => b.text).join('');
      const match = text.replace(/```json|```/g, '').trim().match(/\[[\s\S]*\]/);
      const notices = match ? JSON.parse(match[0]) : [];
      return { statusCode: 200, headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ notices }) };
    } catch (e) {
      return { statusCode: 500, body: JSON.stringify({ error: e.message }) };
    }
  }

  // ── EXTRACT ───────────────────────────────────────────────────────────────
  if (type === 'extract') {
    const prompt = `You are a South African labour law and HR practitioner specialist.

Extract and rewrite the relevant clauses from this gazette notice for the specified sector.

GAZETTE NOTICE:
Title: ${title}
Date: ${date || 'unknown'}
Summary: ${summary}

SECTOR: ${sector || 'general employer/HR practitioner'}${context ? '\n\nAdditional context: ' + context : ''}

Instructions:
1. Identify clauses most relevant to the specified sector.
2. Rewrite in plain, direct, practitioner-ready language.
3. Include specific numbers, dates, thresholds, or deadlines.
4. End with a short "What this means for you" paragraph.
5. Under 400 words. No bullet points. Short paragraphs with bold subheadings.`;

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
