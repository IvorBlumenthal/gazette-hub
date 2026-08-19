// netlify/functions/lib/resend.js
// Thin wrapper around the Resend email API (https://resend.com), used for
// subscription confirmation emails and the published monthly newsletter.
//
// Required environment variables:
//   RESEND_API_KEY      - from the user's Resend account (Settings > API Keys)
//   NEWSLETTER_FROM_EMAIL - the verified sending address, e.g.
//                            ivorb@arkkonsult.com. The domain part must be
//                            verified in Resend before real sends work —
//                            see https://resend.com/domains

const REQUEST_TIMEOUT_MS = 20000;

async function resendFetch(apiKey, path, body) {
  const controller = new AbortController();
  const timer = setTimeout(function () { controller.abort(); }, REQUEST_TIMEOUT_MS);
  let res;
  try {
    res = await fetch('https://api.resend.com' + path, {
      method: 'POST',
      headers: { Authorization: 'Bearer ' + apiKey, 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
      signal: controller.signal,
    });
  } catch (e) {
    if (e.name === 'AbortError') throw new Error('Resend request timed out after ' + (REQUEST_TIMEOUT_MS / 1000) + 's');
    throw e;
  } finally {
    clearTimeout(timer);
  }
  const data = await res.json().catch(function () { return {}; });
  if (!res.ok) throw new Error('Resend HTTP ' + res.status + ': ' + JSON.stringify(data).slice(0, 200));
  return data;
}

// Sends a single email — used for the "confirm your subscription" message.
async function sendEmail(apiKey, from, to, subject, html, text) {
  return resendFetch(apiKey, '/emails', { from: from, to: [to], subject: subject, html: html, text: text });
}

// Sends up to 100 emails in one Resend batch call (their per-call limit).
// Each item is its own independent email (own "to", own html), so every
// subscriber gets their own personalised unsubscribe link. Larger lists are
// automatically split into multiple batch calls. Returns
// { sent, failed, errors: [...] } rather than throwing, so one bad batch
// doesn't stop the rest from sending.
async function sendBatch(apiKey, emails) {
  const CHUNK = 100;
  let sent = 0;
  const errors = [];
  for (let i = 0; i < emails.length; i += CHUNK) {
    const chunk = emails.slice(i, i + CHUNK);
    try {
      await resendFetch(apiKey, '/emails/batch', chunk);
      sent += chunk.length;
    } catch (e) {
      errors.push('Batch starting at #' + i + ': ' + e.message);
    }
  }
  return { sent: sent, failed: emails.length - sent, errors: errors };
}

module.exports = { sendEmail, sendBatch };
