// netlify/functions/register-visitor.js
// Public POST endpoint behind the access gate on index.html and
// newsletter.html. A visitor must submit their company name, email, and
// cellphone number once per browser before they can view the site.
//
// This is intentionally separate from subscribe.js / lib/subscribers.js:
// registering here only grants access and adds the visitor to the
// administrator's contact list (see visitors-admin.js) — it never adds
// anyone to the newsletter mailing list and never sends email. Newsletter
// subscription stays a distinct, double opt-in action.

const { isValidEmail, isValidPhone, addVisitor } = require('./lib/visitors');
const { checkRateLimit } = require('./lib/rateLimit');

// A real visitor only submits this once. Generous limit accounts for a
// shared office IP with several people registering close together, while
// still stopping a script from flooding the visitor list with junk.
const RATE_LIMIT_MAX = 8;
const RATE_LIMIT_WINDOW_SECONDS = 600; // 10 minutes

exports.handler = async (event) => {
  const headers = {
    'Access-Control-Allow-Origin': '*',
    'Access-Control-Allow-Headers': 'Content-Type',
    'Content-Type': 'application/json',
  };

  if (event.httpMethod === 'OPTIONS') return { statusCode: 200, headers, body: '' };
  if (event.httpMethod !== 'POST') return { statusCode: 405, headers, body: JSON.stringify({ error: 'Method not allowed' }) };

  const rate = await checkRateLimit(event, 'register-visitor', RATE_LIMIT_MAX, RATE_LIMIT_WINDOW_SECONDS);
  if (!rate.allowed) {
    return { statusCode: 429, headers, body: JSON.stringify({ error: 'Too many attempts — please wait a few minutes and try again.' }) };
  }

  let body;
  try { body = JSON.parse(event.body || '{}'); }
  catch (e) { return { statusCode: 400, headers, body: JSON.stringify({ error: 'Invalid JSON' }) }; }

  const email = String(body.email || '').trim();
  const phone = String(body.phone || '').trim();
  const company = String(body.company || '').trim();

  if (!company) return { statusCode: 400, headers, body: JSON.stringify({ error: 'Please enter your company name.' }) };
  if (!isValidEmail(email)) return { statusCode: 400, headers, body: JSON.stringify({ error: 'Please enter a valid email address.' }) };
  if (!isValidPhone(phone)) return { statusCode: 400, headers, body: JSON.stringify({ error: 'Please enter a valid cellphone number.' }) };

  try {
    await addVisitor({ email: email, phone: phone, company: company, page: body.page });
  } catch (e) {
    console.error('register-visitor: could not save:', e.message);
    return { statusCode: 500, headers, body: JSON.stringify({ error: 'Could not save your details. Please try again.' }) };
  }

  return { statusCode: 200, headers, body: JSON.stringify({ ok: true }) };
};
