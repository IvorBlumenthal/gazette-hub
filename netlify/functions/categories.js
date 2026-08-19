// netlify/functions/categories.js
// GET  -> public, returns the list of active gazette categories (used by index.html)
// POST/PUT/DELETE -> admin only, requires header x-admin-password matching
//                     the ADMIN_PASSWORD environment variable. Used by admin.html
//                     to create, edit, and remove categories without a code change.

const { loadAll, saveAll, slugify } = require('./lib/categories');

exports.handler = async (event) => {
  const headers = { 'Content-Type': 'application/json' };

  if (event.httpMethod === 'OPTIONS') return { statusCode: 200, headers, body: '' };

  if (event.httpMethod === 'GET' && event.queryStringParameters && event.queryStringParameters.verify === '1') {
    // Used by admin.html to check a password before showing the admin UI.
    // Does not read or write category data.
    const adminPassword = process.env.ADMIN_PASSWORD;
    if (!adminPassword) return { statusCode: 500, headers, body: JSON.stringify({ error: 'ADMIN_PASSWORD is not configured on the server.' }) };
    const supplied = event.headers['x-admin-password'] || event.headers['X-Admin-Password'];
    if (supplied !== adminPassword) return { statusCode: 401, headers, body: JSON.stringify({ error: 'Invalid admin password' }) };
    return { statusCode: 200, headers, body: JSON.stringify({ ok: true }) };
  }

  if (event.httpMethod === 'GET') {
    const all = await loadAll();
    const includeInactive = event.queryStringParameters && event.queryStringParameters.all === '1';
    const list = (includeInactive ? all : all.filter(function (c) { return c.active !== false; }))
      .slice()
      .sort(function (a, b) { return (a.sortOrder || 0) - (b.sortOrder || 0); });
    return { statusCode: 200, headers, body: JSON.stringify({ categories: list }) };
  }

  if (event.httpMethod === 'POST' || event.httpMethod === 'PUT' || event.httpMethod === 'DELETE') {
    const adminPassword = process.env.ADMIN_PASSWORD;
    if (!adminPassword) {
      return { statusCode: 500, headers, body: JSON.stringify({ error: 'ADMIN_PASSWORD is not configured on the server. Add it in Netlify environment variables to enable the admin panel.' }) };
    }
    const supplied = event.headers['x-admin-password'] || event.headers['X-Admin-Password'];
    if (supplied !== adminPassword) {
      return { statusCode: 401, headers, body: JSON.stringify({ error: 'Invalid admin password' }) };
    }

    let body;
    try { body = JSON.parse(event.body || '{}'); }
    catch (e) { return { statusCode: 400, headers, body: JSON.stringify({ error: 'Invalid JSON' }) }; }

    const list = await loadAll();

    if (event.httpMethod === 'POST') {
      const label = (body.label || '').trim();
      const keywords = (body.keywords || '').trim();
      if (!label || !keywords) {
        return { statusCode: 400, headers, body: JSON.stringify({ error: 'label and keywords are required' }) };
      }
      const id = slugify(body.id || label);
      if (!id) return { statusCode: 400, headers, body: JSON.stringify({ error: 'Could not derive a valid id from that label' }) };
      if (list.some(function (c) { return c.id === id; })) {
        return { statusCode: 409, headers, body: JSON.stringify({ error: 'A category with id "' + id + '" already exists' }) };
      }
      const maxOrder = list.reduce(function (m, c) { return Math.max(m, c.sortOrder || 0); }, 0);
      const newCat = { id: id, icon: (body.icon || '📄').trim(), label: label, keywords: keywords, sortOrder: maxOrder + 10, active: true };
      list.push(newCat);
      await saveAll(list);
      return { statusCode: 200, headers, body: JSON.stringify({ categories: list, created: newCat }) };
    }

    if (event.httpMethod === 'PUT') {
      const id = body.id;
      const idx = list.findIndex(function (c) { return c.id === id; });
      if (idx === -1) return { statusCode: 404, headers, body: JSON.stringify({ error: 'Category not found' }) };
      const existing = list[idx];
      list[idx] = {
        id: existing.id,
        label: body.label !== undefined ? String(body.label).trim() : existing.label,
        icon: body.icon !== undefined ? String(body.icon).trim() : existing.icon,
        keywords: body.keywords !== undefined ? String(body.keywords).trim() : existing.keywords,
        sortOrder: body.sortOrder !== undefined ? Number(body.sortOrder) : existing.sortOrder,
        active: body.active !== undefined ? !!body.active : existing.active,
      };
      await saveAll(list);
      return { statusCode: 200, headers, body: JSON.stringify({ categories: list }) };
    }

    if (event.httpMethod === 'DELETE') {
      const id = (event.queryStringParameters && event.queryStringParameters.id) || body.id;
      const idx = list.findIndex(function (c) { return c.id === id; });
      if (idx === -1) return { statusCode: 404, headers, body: JSON.stringify({ error: 'Category not found' }) };
      list.splice(idx, 1);
      await saveAll(list);
      return { statusCode: 200, headers, body: JSON.stringify({ categories: list }) };
    }
  }

  return { statusCode: 405, headers, body: JSON.stringify({ error: 'Method not allowed' }) };
};
