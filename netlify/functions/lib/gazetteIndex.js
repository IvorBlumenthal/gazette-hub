// netlify/functions/lib/gazetteIndex.js
// Builds a REAL, verified index of South African Government Gazette
// documents from gazettes.africa (a free, current, government-authorised
// gazette archive run by OpenUp/Code for Africa) and uses it to turn a
// gazette number into a genuine, working document link.
//
// Why this exists: the AI that writes notice summaries can only ever GUESS
// at a source URL from its web search — sometimes it finds nothing,
// sometimes it invents a plausible-looking link that turns out to be dead
// or login-walled. Neither is good enough for a "View full notice" button.
// This module instead fetches gazettes.africa's own yearly index page
// (which lists every gazette published that year, each linking to its real
// document page) and matches against that — so a link is only ever shown
// once we've actually found the gazette number in a real, current index.
//
// Important: we only ever fetch the YEARLY INDEX page ourselves
// (https://gazettes.africa/gazettes/za/<year>) — gazettes.africa's own
// robots.txt allows that page to be crawled. We never fetch the
// individual document pages server-side; those are opened directly by a
// person in their own browser, exactly like any other link on the web.
// The index page is large (roughly 1MB for a full year) and doesn't
// change retroactively, so it's cached in Blobs and only re-fetched about
// once a week.

const { getBlobStore } = require('./blobStore');

const STORE_NAME = 'gazette-index';
const INDEX_MAX_AGE_MS = 7 * 24 * 60 * 60 * 1000; // 7 days
const FETCH_TIMEOUT_MS = 25000;

function store() {
  return getBlobStore(STORE_NAME);
}

// Matches every <a href="https://gazettes.africa/akn/za/officialGazette/...">
// on the yearly index page, capturing the gazette-series slug, the ISO
// date, and the gazette number (which may carry a "-part-1" style suffix).
const LINK_RE = /https:\/\/gazettes\.africa\/akn\/za\/officialGazette\/([a-z0-9-]+)\/(\d{4}-\d{2}-\d{2})\/([0-9]+(?:-part-\d+)?)\/eng@\2/g;

function normaliseNumber(raw) {
  // Gazette numbers sometimes arrive as "55238", "No. 55238", "GG55238",
  // etc. Keep only the digits so AI-extracted and index-extracted numbers
  // compare on equal footing.
  const digits = String(raw || '').replace(/[^0-9]/g, '');
  return digits || null;
}

async function fetchYearIndex(year) {
  const url = 'https://gazettes.africa/gazettes/za/' + year;
  const controller = new AbortController();
  const timer = setTimeout(function () { controller.abort(); }, FETCH_TIMEOUT_MS);
  let html;
  try {
    const res = await fetch(url, {
      signal: controller.signal,
      headers: { 'User-Agent': 'Mozilla/5.0 (compatible; ArkKonsultGazetteHub/1.0; +https://gazette-hub.netlify.app)' },
    });
    if (!res.ok) throw new Error('gazettes.africa index HTTP ' + res.status);
    html = await res.text();
  } finally {
    clearTimeout(timer);
  }

  const byNumber = {};
  let m;
  LINK_RE.lastIndex = 0;
  while ((m = LINK_RE.exec(html)) !== null) {
    const series = m[1];
    const date = m[2];
    const numberRaw = m[3];
    const number = normaliseNumber(numberRaw.split('-part-')[0]);
    if (!number) continue;
    const docUrl = 'https://gazettes.africa/akn/za/officialGazette/' + series + '/' + date + '/' + numberRaw + '/eng@' + date;
    // Prefer the main "government-gazette" series if the same number also
    // shows up in a sub-series (e.g. Legal Notices A/B/C).
    const existing = byNumber[number];
    if (!existing || (series === 'government-gazette' && existing.series !== 'government-gazette')) {
      byNumber[number] = { url: docUrl, date: date, series: series };
    }
  }
  return byNumber;
}

async function getYearIndex(year) {
  const key = String(year);
  let cached = null;
  try {
    cached = await store().get(key, { type: 'json' });
  } catch (e) {
    console.error('Gazette index read:', e.message);
  }

  const isFresh = cached && cached.fetchedAt && (Date.now() - cached.fetchedAt) < INDEX_MAX_AGE_MS;
  if (isFresh) return cached.byNumber;

  try {
    const byNumber = await fetchYearIndex(year);
    try {
      await store().setJSON(key, { fetchedAt: Date.now(), byNumber: byNumber });
    } catch (e) {
      console.error('Gazette index write:', e.message);
    }
    return byNumber;
  } catch (e) {
    console.error('Gazette index fetch failed for ' + year + ':', e.message);
    // Serve a stale cached index rather than nothing, if we have one —
    // better than losing every link on a transient network hiccup.
    return cached ? cached.byNumber : {};
  }
}

// Given a gazette number and an approximate date (YYYY-MM-DD, or just a
// year), returns the real, verified gazettes.africa URL, or null if that
// gazette number isn't found in the current index. Callers should treat
// null as "no link available" — never fall back to a guess.
async function getVerifiedUrl(gazetteNo, dateOrYear) {
  const number = normaliseNumber(gazetteNo);
  if (!number) return null;
  const year = String(dateOrYear || '').slice(0, 4);
  if (!/^\d{4}$/.test(year)) return null;

  const index = await getYearIndex(year);
  const entry = index[number];
  return entry ? entry.url : null;
}

module.exports = { getVerifiedUrl, fetchYearIndex, getYearIndex };
