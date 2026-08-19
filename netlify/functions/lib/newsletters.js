// netlify/functions/lib/newsletters.js
// Shared helper for newsletter storage in Netlify Blobs. Two kinds of
// entries in the same store:
//   - key "draft"        -> the current unpublished draft (if any), written
//                            by the monthly generator, overwritten each time
//                            it regenerates until someone publishes it.
//   - key "issue-YYYY-MM" -> a published, permanent issue, plus its id is
//                            added to the "index" key so the archive can be
//                            listed without scanning every possible key.

const { getBlobStore } = require('./blobStore');

const STORE_NAME = 'newsletter-issues';
const DRAFT_KEY = 'draft';
const INDEX_KEY = 'index';

function store() {
  return getBlobStore(STORE_NAME);
}

async function getDraft() {
  return store().get(DRAFT_KEY, { type: 'json' });
}

async function saveDraft(draft) {
  await store().setJSON(DRAFT_KEY, draft);
}

async function clearDraft() {
  await store().delete(DRAFT_KEY);
}

async function getIndex() {
  const idx = await store().get(INDEX_KEY, { type: 'json' });
  return Array.isArray(idx) ? idx : [];
}

async function getIssue(month) {
  return store().get('issue-' + month, { type: 'json' });
}

// Publishes a draft as a permanent issue for its month, adds it to the
// archive index (most recent first), and clears the draft slot.
async function publish(draft) {
  const month = draft.month; // e.g. "2026-08"
  const published = Object.assign({}, draft, { publishedAt: new Date().toISOString() });
  await store().setJSON('issue-' + month, published);

  const idx = await getIndex();
  const withoutThisMonth = idx.filter(function (e) { return e.month !== month; });
  withoutThisMonth.unshift({ month: month, title: published.title, subject: published.subject, publishedAt: published.publishedAt });
  await store().setJSON(INDEX_KEY, withoutThisMonth);

  await clearDraft();
  return published;
}

module.exports = { getDraft, saveDraft, clearDraft, getIndex, getIssue, publish };
