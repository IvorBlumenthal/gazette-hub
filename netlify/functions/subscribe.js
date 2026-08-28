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
const { loadAll: loadCategories } = require('./lib/categories');
const { sendEmail } = require('./lib/resend');
const { SITE_URL } = require('./lib/site');
const { checkRateLimit } = require('./lib/rateLimit');

// Stops this from being used to email-bomb an address with confirmation
// emails, or to spam the subscriber list.
const RATE_LIMIT_MAX = 5;
const RATE_LIMIT_WINDOW_SECONDS = 600; // 10 minutes

exports.handler = async (event) => {
  const headers = {
    'Access-Control-Allow-Origin': '*',
    'Access-Control-Allow-Headers': 'Content-Type',
    'Content-Type': 'application/json',
  };

  if (event.httpMethod === 'OPTIONS') return { statusCode: 200, headers, body: '' };
  if (event.httpMethod !== 'POST') return { statusCode: 405, headers, body: JSON.stringify({ error: 'Method not allowed' }) };

  const rate = await checkRateLimit(event, 'subscribe', RATE_LIMIT_MAX, RATE_LIMIT_WINDOW_SECONDS);
  if (!rate.allowed) {
    return { statusCode: 429, headers, body: JSON.stringify({ error: 'Too many attempts — please wait a few minutes and try again.' }) };
  }

  let body;
  try { body = JSON.parse(event.body || '{}'); }
  catch (e) { return { statusCode: 400, headers, body: JSON.stringify({ error: 'Invalid JSON' }) }; }

  const email = String(body.email || '').trim();
  if (!isValidEmail(email)) {
    return { statusCode: 400, headers, body: JSON.stringify({ error: 'Please enter a valid email address.' }) };
  }

  // Only keep category ids that are real and currently active — anything
  // else (a stale id from a since-deleted category, or a tampered request)
  // is silently dropped rather than stored. An empty result here means
  // "every category", same as not sending the field at all — see
  // lib/subscribers.js's normaliseCategories.
  let requestedCategories = Array.isArray(body.categories) ? body.categories : [];
  try {
    const validIds = (await loadCategories()).filter(function (c) { return c.active !== false; }).map(function (c) { return c.id; });
    requestedCategories = requestedCategories.filter(function (id) { return validIds.indexOf(id) !== -1; });
    // If the subscriber's selection covers every active category, store it
    // as "all" (empty array) instead of the full list, so they automatically
    // pick up any category added later instead of being frozen on today's set.
    if (requestedCategories.length > 0 && requestedCategories.length >= validIds.length) requestedCategories = [];
  } catch (e) {
    console.error('Subscribe: could not validate categories, defaulting to all:', e.message);
    requestedCategories = [];
  }

  const resendKey = process.env.RESEND_API_KEY;
  const fromEmail = process.env.NEWSLETTER_FROM_EMAIL;
  if (!resendKey || !fromEmail) {
    return { statusCode: 500, headers, body: JSON.stringify({ error: 'Newsletter sending is not configured yet on the server.' }) };
  }

  let sub;
  try {
    sub = await addPending(email, requestedCategories);
  } catch (e) {
    console.error('Subscribe: could not save subscriber:', e.message);
    return { statusCode: 500, headers, body: JSON.stringify({ error: 'Could not save your subscription. Please try again.' }) };
  }

  if (sub.status === 'confirmed') {
    return { statusCode: 200, headers, body: JSON.stringify({ ok: true, alreadyConfirmed: true }) };
  }

  const confirmUrl = SITE_URL + '/.netlify/functions/confirm-subscription?token=' + encodeURIComponent(sub.token);
  const manageUrl = SITE_URL + '/newsletter.html?manage=' + encodeURIComponent(sub.token);
  const html = '<p>Thanks for subscribing to the ArkKonsult Gazette Digest.</p>'
    + '<p><a href="' + confirmUrl + '">Click here to confirm your subscription</a></p>'
    + '<p>You can change which topics you receive at any time here: <a href="' + manageUrl + '">manage your topics</a>.</p>'
    + '<p>If you did not request this, you can ignore this email — you will not be subscribed unless you click the link above.</p>';
  const text = 'Thanks for subscribing to the ArkKonsult Gazette Digest.\n\nConfirm your subscription: ' + confirmUrl
    + '\n\nManage which topics you receive: ' + manageUrl
    + '\n\nIf you did not request this, you can ignore this email.';

  try {
    await sendEmail(resendKey, fromEmail, email, 'Confirm your subscription to the ArkKonsult Gazette Digest', html, text);
  } catch (e) {
    console.error('Subscribe: could not send confirmation email:', e.message);
    return { statusCode: 502, headers, body: JSON.stringify({ error: 'Could not send confirmation email. Please try again shortly.' }) };
  }

  return { statusCode: 200, headers, body: JSON.stringify({ ok: true }) };
};
