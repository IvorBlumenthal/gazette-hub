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
//
// gazettes.africa sits behind bot-protection that intermittently returns a
// 403 challenge page instead of the real index, even for this allowed
// page — confirmed by testing directly against production. This module is
// built around that reality rather than assuming a clean fetch: it retries
// once, it never lets a blocked or empty fetch overwrite a previously good
// cached index, and a stale-but-real index is always preferred over an
// empty one. The practical effect is that link coverage can vary run to
// run, but a link that IS shown is always real — links are still never
// guessed.

const { getBlobStore } = require('./blobStore');

const STORE_NAME = 'gazette-index';
const INDEX_MAX_AGE_MS = 7 * 24 * 60 * 60 * 1000; // 7 days
const FETCH_TIMEOUT_MS = 25000;
const RETRY_DELAY_MS = 2000;

function store() {
  return getBlobStore(STORE_NAME);
}

// Matches every gazette link on the yearly index page, whether it's written
// as a relative href ("/akn/za/officialGazette/...") or a full absolute URL
// ("https://gazettes.africa/akn/za/officialGazette/..." ) — the page was
// found to use relative hrefs, but this tolerates either. Captures the
// gazette-series slug, the ISO date, and the gazette number (which may
// carry a "-part-1" style suffix).
const LINK_RE = /href=["'](?:https:\/\/gazettes\.africa)?(\/akn\/za\/officialGazette\/([a-z0-9-]+)\/(\d{4}-\d{2}-\d{2})\/([0-9]+(?:-part-\d+)?)\/eng@\3)["']/g;

function normaliseNumber(raw) {
  // Gazette numbers sometimes arrive as "55238", "No. 55238", "GG55238",
  // etc. Keep only the digits so AI-extracted and index-extracted numbers
  // compare on equal footing.
  const digits = String(raw || '').replace(/[^0-9]/g, '');
  return digits || null;
}

function sleep(ms) {
  return new Promise(function (resolve) { setTimeout(resolve, ms); });
}

async function fetchOnce(url) {
  const controller = new AbortController();
  const timer = setTimeout(function () { controller.abort(); }, FETCH_TIMEOUT_MS);
  try {
    const res = await fetch(url, {
      signal: controller.signal,
      headers: {
        'User-Agent': 'Mozilla/5.0 (compatible; ArkKonsultGazetteHub/1.0; +https://gazette-hub.netlify.app)',
        'Accept': 'text/html',
      },
    });
    if (!res.ok) throw new Error('gazettes.africa index HTTP ' + res.status);
    return await res.text();
  } finally {
    clearTimeout(timer);
  }
}

function parseIndex(html) {
  const byNumber = {};
  let m;
  LINK_RE.lastIndex = 0;
  while ((m = LINK_RE.exec(html)) !== null) {
    const path = m[1];
    const series = m[2];
    const date = m[3];
    const numberRaw = m[4];
    const number = normaliseNumber(numberRaw.split('-part-')[0]);
    if (!number) continue;
    const docUrl = 'https://gazettes.africa' + path;
    // Prefer the main "government-gazette" series if the same number also
    // shows up in a sub-series (e.g. Legal Notices A/B/C).
    const existing = byNumber[number];
    if (!existing || (series === 'government-gazette' && existing.series !== 'government-gazette')) {
      byNumber[number] = { url: docUrl, date: date, series: series };
    }
  }
  return byNumber;
}

// Fetches and parses the yearly index, retrying once on failure (including
// a "successful" fetch that parsed zero entries, which almost always means
// a bot-check page came back instead of the real page rather than the year
// genuinely having no gazettes). Throws if both attempts fail — the caller
// is responsible for falling back to a cached index rather than treating
// that as "there are no gazettes this year."
async function fetchYearIndex(year) {
  const url = 'https://gazettes.africa/gazettes/za/' + year;
  let lastErr = null;
  for (let attempt = 0; attempt < 2; attempt++) {
    if (attempt > 0) await sleep(RETRY_DELAY_MS);
    try {
      const html = await fetchOnce(url);
      const byNumber = parseIndex(html);
      if (Object.keys(byNumber).length > 0) return byNumber;
      lastErr = new Error('gazettes.africa index parsed 0 entries (likely a bot-check page, not the real index)');
    } catch (e) {
      lastErr = e;
    }
  }
  throw lastErr || new Error('Unknown error fetching gazette index for ' + year);
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
    // gazettes.africa's bot-check makes this the normal path sometimes,
    // not just a rare hiccup, so a stale-but-real index is far better
    // than an empty one.
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
