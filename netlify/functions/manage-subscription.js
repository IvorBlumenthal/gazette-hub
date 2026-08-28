// netlify/functions/manage-subscription.js
// Public, token-authenticated endpoint (same pattern as unsubscribe.js —
// possessing the token is the credential, no password needed) behind
// newsletter.html's "Manage your topics" flow.
//
//   GET  ?token=...                    -> { email, status, categories }
//   POST { token, categories }         -> updates the subscriber's category
//                                          preferences, returns the same shape
//
// categories is always returned/accepted as an array of category ids; an
// empty array means "every category" — see lib/subscribers.js.

const { findByToken, updateCategoriesByToken } = require('./lib/subscribers');
const { loadAll: loadCategories } = require('./lib/categories');
const { checkRateLimit } = require('./lib/rateLimit');

exports.handler = async (event) => {
  const headers = {
    'Access-Control-Allow-Origin': '*',
    'Access-Control-Allow-Headers': 'Content-Type',
    'Content-Type': 'application/json',
  };

  if (event.httpMethod === 'OPTIONS') return { statusCode: 200, headers, body: '' };

  if (event.httpMethod === 'GET') {
    const token = event.queryStringParameters && event.queryStringParameters.token;
    if (!token) return { statusCode: 400, headers, body: JSON.stringify({ error: 'Missing token' }) };
    const sub = await findByToken(token);
    if (!sub) return { statusCode: 404, headers, body: JSON.stringify({ error: 'That link is invalid or has expired.' }) };
    return { statusCode: 200, headers, body: JSON.stringify({ email: sub.email, status: sub.status, categories: sub.categories || [] }) };
  }

  if (event.httpMethod === 'POST') {
    const rate = await checkRateLimit(event, 'manage-subscription', 10, 600);
    if (!rate.allowed) {
      return { statusCode: 429, headers, body: JSON.stringify({ error: 'Too many attempts — please wait a few minutes and try again.' }) };
    }

    let body;
    try { body = JSON.parse(event.body || '{}'); }
    catch (e) { return { statusCode: 400, headers, body: JSON.stringify({ error: 'Invalid JSON' }) }; }

    const token = body.token;
    if (!token) return { statusCode: 400, headers, body: JSON.stringify({ error: 'Missing token' }) };

    let requested = Array.isArray(body.categories) ? body.categories : [];
    try {
      const validIds = (await loadCategories()).filter(function (c) { return c.active !== false; }).map(function (c) { return c.id; });
      requested = requested.filter(function (id) { return validIds.indexOf(id) !== -1; });
      if (requested.length > 0 && requested.length >= validIds.length) requested = [];
    } catch (e) {
      console.error('Manage subscription: could not validate categories:', e.message);
      requested = [];
    }

    let sub;
    try {
      sub = await updateCategoriesByToken(token, requested);
    } catch (e) {
      console.error('Manage subscription: could not save:', e.message);
      return { statusCode: 500, headers, body: JSON.stringify({ error: 'Could not save your preferences. Please try again.' }) };
    }
    if (!sub) return { statusCode: 404, headers, body: JSON.stringify({ error: 'That link is invalid or has expired.' }) };

    return { statusCode: 200, headers, body: JSON.stringify({ ok: true, email: sub.email, status: sub.status, categories: sub.categories || [] }) };
  }

  return { statusCode: 405, headers, body: JSON.stringify({ error: 'Method not allowed' }) };
};
