// netlify/functions/confirm-subscription.js
// Public GET endpoint — the link in the confirmation email points here.
// Marks the subscriber confirmed, then redirects to the newsletter page
// with a friendly banner rather than showing raw JSON.

const { confirmByToken } = require('./lib/subscribers');
const { SITE_URL } = require('./lib/site');

exports.handler = async (event) => {
  const token = event.queryStringParameters && event.queryStringParameters.token;
  let ok = false;
  if (token) {
    try {
      const sub = await confirmByToken(token);
      ok = !!sub;
    } catch (e) {
      console.error('Confirm subscription failed:', e.message);
    }
  }
  return {
    statusCode: 302,
    headers: { Location: SITE_URL + '/newsletter.html?confirmed=' + (ok ? '1' : '0') },
    body: '',
  };
};
