// netlify/functions/subscribe.js
// Public POST endpoint behind the newsletter signup form on newsletter.html.
// Adds the email as "pending" and sends a confirmation email — the address
// only starts receiving newsletters once they click the link in that email
// (double opt-in), and never before.
//
// Required environment variables:
//   RESEND_API_KEY        - from the user's Resend account
//   NEWSLETTER_FROM_EMAIL - verified sending address, e.g. ivorb@arkkonsult.com

const { isValidEmail, addPending } = require('./lib/subscribers');
const { sendEmail } = require('./lib/resend');
const { SITE_URL } = require('./lib/site');

exports.handler = async (event) => {
  const headers = {
    'Access-Control-Allow-Origin': '*',
    'Access-Control-Allow-Headers': 'Content-Type',
    'Content-Type': 'application/json',
  };

  if (event.httpMethod === 'OPTIONS') return { statusCode: 200, headers, body: '' };
  if (event.httpMethod !== 'POST') return { statusCode: 405, headers, body: JSON.stringify({ error: 'Method not allowed' }) };

  let body;
  try { body = JSON.parse(event.body || '{}'); }
  catch (e) { return { statusCode: 400, headers, body: JSON.stringify({ error: 'Invalid JSON' }) }; }

  const email = String(body.email || '').trim();
  if (!isValidEmail(email)) {
    return { statusCode: 400, headers, body: JSON.stringify({ error: 'Please enter a valid email address.' }) };
  }

  const resendKey = process.env.RESEND_API_KEY;
  const fromEmail = process.env.NEWSLETTER_FROM_EMAIL;
  if (!resendKey || !fromEmail) {
    return { statusCode: 500, headers, body: JSON.stringify({ error: 'Newsletter sending is not configured yet on the server.' }) };
  }

  let sub;
  try {
    sub = await addPending(email);
  } catch (e) {
    console.error('Subscribe: could not save subscriber:', e.message);
    return { statusCode: 500, headers, body: JSON.stringify({ error: 'Could not save your subscription. Please try again.' }) };
  }

  if (sub.status === 'confirmed') {
    return { statusCode: 200, headers, body: JSON.stringify({ ok: true, alreadyConfirmed: true }) };
  }

  const confirmUrl = SITE_URL + '/.netlify/functions/confirm-subscription?token=' + encodeURIComponent(sub.token);
  const html = '<p>Thanks for subscribing to the ArkKonsult Gazette Digest.</p>'
    + '<p><a href="' + confirmUrl + '">Click here to confirm your subscription</a></p>'
    + '<p>If you did not request this, you can ignore this email — you will not be subscribed unless you click the link above.</p>';
  const text = 'Thanks for subscribing to the ArkKonsult Gazette Digest.\n\nConfirm your subscription: ' + confirmUrl
    + '\n\nIf you did not request this, you can ignore this email.';

  try {
    await sendEmail(resendKey, fromEmail, email, 'Confirm your subscription to the ArkKonsult Gazette Digest', html, text);
  } catch (e) {
    console.error('Subscribe: could not send confirmation email:', e.message);
    return { statusCode: 502, headers, body: JSON.stringify({ error: 'Could not send confirmation email. Please try again shortly.' }) };
  }

  return { statusCode: 200, headers, body: JSON.stringify({ ok: true }) };
};
