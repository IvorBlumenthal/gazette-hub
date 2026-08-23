// netlify/functions/lib/visitors.js
// Shared helper for the site-access contact list, stored in Netlify Blobs
// (same pattern as lib/subscribers.js and lib/categories.js).
//
// This is deliberately separate from newsletter-subscribers.js: registering
// here just grants browsing access to the site and adds the visitor to the
// administrator's contact list in admin.html. It does NOT opt anyone into
// the monthly newsletter — subscribing to marketing email stays a distinct,
// double opt-in action so the two consent purposes are never conflated.

const { getBlobStore } = require('./blobStore');
const crypto = require('crypto');

const STORE_NAME = 'site-visitors';
const KEY = 'visitors';

function store() {
  return getBlobStore(STORE_NAME);
}

async function loadAll() {
  const data = await store().get(KEY, { type: 'json' });
  return Array.isArray(data) ? data : [];
}

async function saveAll(list) {
  await store().setJSON(KEY, list);
}

function isValidEmail(email) {
  return typeof email === 'string' && /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email.trim());
}

function isValidPhone(phone) {
  // Deliberately simple — accepts digits, spaces, +, -, ( ) — just enough to
  // catch empty/garbage input without rejecting valid international formats.
  return typeof phone === 'string' && /^[\d\s+\-()]{7,20}$/.test(phone.trim());
}

// Adds a new visitor record, or refreshes an existing one (same email) with
// their latest details rather than creating a duplicate row.
async function addVisitor({ email, phone, company, page }) {
  const normalised = email.trim().toLowerCase();
  const list = await loadAll();
  const existing = list.find(function (v) { return v.email === normalised; });
  const now = new Date().toISOString();

  if (existing) {
    existing.phone = phone.trim();
    existing.company = company.trim();
    existing.lastSeenAt = now;
    await saveAll(list);
    return existing;
  }

  const record = {
    id: crypto.randomBytes(8).toString('hex'),
    email: normalised,
    phone: phone.trim(),
    company: company.trim(),
    registeredAt: now,
    lastSeenAt: now,
    page: page || null,
  };
  list.push(record);
  await saveAll(list);
  return record;
}

module.exports = { loadAll, isValidEmail, isValidPhone, addVisitor };
