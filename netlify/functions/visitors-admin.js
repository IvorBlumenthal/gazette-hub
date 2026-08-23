// netlify/functions/visitors-admin.js
// Admin-only endpoint (same x-admin-password pattern as categories.js and
// newsletter-admin.js) that lists everyone who has registered through the
// site access gate — company name, email, cellphone, and when they first
// and last registered. Used by the "Site visitors" section of admin.html.

const { loadAll } = require('./lib/visitors');

exports.handler = async (event) => {
  const headers = { 'Content-Type': 'application/json' };
  if (event.httpMethod === 'OPTIONS') return { statusCode: 200, headers, body: '' };

  const adminPassword = process.env.ADMIN_PASSWORD;
  if (!adminPassword) return { statusCode: 500, headers, body: JSON.stringify({ error: 'ADMIN_PASSWORD is not configured on the server.' }) };
  const supplied = event.headers['x-admin-password'] || event.headers['X-Admin-Password'];
  if (supplied !== adminPassword) return { statusCode: 401, headers, body: JSON.stringify({ error: 'Invalid admin password' }) };

  if (event.httpMethod !== 'GET') return { statusCode: 405, headers, body: JSON.stringify({ error: 'Method not allowed' }) };

  const list = (await loadAll()).slice().sort(function (a, b) {
    return new Date(b.registeredAt).getTime() - new Date(a.registeredAt).getTime();
  });
  return { statusCode: 200, headers, body: JSON.stringify({ visitors: list }) };
};
