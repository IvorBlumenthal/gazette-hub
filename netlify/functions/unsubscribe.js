// netlify/functions/unsubscribe.js
// Public GET endpoint — every newsletter email includes a personalised link
// here so a subscriber can opt out in one click, no login required.

const { unsubscribeByToken } = require('./lib/subscribers');
const { SITE_URL } = require('./lib/site');

exports.handler = async (event) => {
  const token = event.queryStringParameters && event.queryStringParameters.token;
  let ok = false;
  if (token) {
    try {
      const sub = await unsubscribeByToken(token);
      ok = !!sub;
    } catch (e) {
      console.error('Unsubscribe failed:', e.message);
    }
  }
  return {
    statusCode: 302,
    headers: { Location: SITE_URL + '/newsletter.html?unsubscribed=' + (ok ? '1' : '0') },
    body: '',
  };
};
