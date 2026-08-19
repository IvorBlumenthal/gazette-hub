// netlify/functions/lib/subscribers.js
// Shared helper for the newsletter subscriber list, stored in Netlify Blobs
// (same pattern as lib/categories.js and lib/cache.js).
//
// Double opt-in by design: a new subscriber starts as "pending" and only
// becomes "confirmed" after clicking the link in a confirmation email. Only
// "confirmed" subscribers are ever emailed. This, plus the unsubscribe link
// on every email, is standard practice for POPIA-friendly consent — though
// worth a proper legal check if that matters for your business beyond
// standard best practice.

const { getBlobStore } = require('./blobStore');
const crypto = require('crypto');

const STORE_NAME = 'newsletter-subscribers';
const KEY = 'subscribers';

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
  // Deliberately simple — good enough to catch typos without rejecting
  // valid-but-unusual addresses.
  return typeof email === 'string' && /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email.trim());
}

function newToken() {
  return crypto.randomBytes(24).toString('hex');
}

// Adds a new pending subscriber, or re-issues a fresh token for an existing
// pending one (e.g. they lost the email). Confirmed subscribers who sign up
// again are left alone — returns their existing record unchanged.
async function addPending(email) {
  const normalised = email.trim().toLowerCase();
  const list = await loadAll();
  const existing = list.find(function (s) { return s.email === normalised; });

  if (existing && existing.status === 'confirmed') return existing;

  const token = newToken();
  const now = new Date().toISOString();

  if (existing) {
    existing.status = 'pending';
    existing.token = token;
    existing.subscribedAt = now;
  } else {
    list.push({ email: normalised, status: 'pending', token: token, subscribedAt: now, confirmedAt: null, unsubscribedAt: null });
  }
  await saveAll(list);
  return list.find(function (s) { return s.email === normalised; });
}

async function confirmByToken(token) {
  const list = await loadAll();
  const sub = list.find(function (s) { return s.token === token && s.status === 'pending'; });
  if (!sub) return null;
  sub.status = 'confirmed';
  sub.confirmedAt = new Date().toISOString();
  await saveAll(list);
  return sub;
}

async function unsubscribeByToken(token) {
  const list = await loadAll();
  const sub = list.find(function (s) { return s.token === token; });
  if (!sub) return null;
  sub.status = 'unsubscribed';
  sub.unsubscribedAt = new Date().toISOString();
  await saveAll(list);
  return sub;
}

async function confirmedList() {
  const list = await loadAll();
  return list.filter(function (s) { return s.status === 'confirmed'; });
}

module.exports = { loadAll, saveAll, isValidEmail, addPending, confirmByToken, unsubscribeByToken, confirmedList };
