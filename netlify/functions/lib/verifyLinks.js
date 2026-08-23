// netlify/functions/lib/verifyLinks.js
// Makes sure a notice's "View full notice" link is one that actually
// works, before it's ever shown.
//
// Two checks are tried, in order:
//
//   1. Live-verify the AI's own guessed source_url. The AI's web search
//      already sometimes finds the real document — on gov.za, SARS,
//      gazettes.africa, a provincial site, wherever it actually is — the
//      original flaw wasn't that it searched, it's that nothing ever
//      confirmed the result actually loaded before showing it as a
//      button. This fetches it for real and only keeps it if it resolves
//      successfully.
//
//   2. If that fails (or there was no guess), fall back to looking the
//      gazette number up in gazettes.africa's own real index (see
//      gazetteIndex.js).
//
// If neither succeeds, source_url is cleared rather than left as an
// unverified guess — the site's own rendering code already only shows a
// "View full notice" button when source_url is present, so a missing
// link means "we could not confirm a real document exists," never "here's
// a link that might be dead or login-walled."

const { getVerifiedUrl } = require('./gazetteIndex');

const LIVE_CHECK_TIMEOUT_MS = 8000;

// A URL that loads successfully isn't the same as a URL that points at the
// actual notice — "https://www.gpwonline.co.za" (no path at all) loads
// just fine and is completely useless as a "View full notice" link. This
// rejects anything that's just a bare domain / homepage before it's even
// worth spending a network request to check.
function looksLikeSpecificDocument(url) {
  let parsed;
  try {
    parsed = new URL(url);
  } catch (e) {
    return false;
  }
  const path = parsed.pathname.replace(/\/+$/, ''); // strip trailing slash(es)
  if (path.length === 0) return false; // bare domain root
  // A single short path segment (e.g. "/gazettes" or "/documents") reads
  // as a generic section of a site, not a specific notice — require
  // something with a bit more substance, which real document URLs
  // (PDF filenames, deep AKN paths, numbered notice pages) always have.
  if (path.length < 10) return false;
  return true;
}

async function liveVerify(url) {
  if (!url || typeof url !== 'string' || !/^https?:\/\//i.test(url)) return false;
  if (!looksLikeSpecificDocument(url)) return false;
  const controller = new AbortController();
  const timer = setTimeout(function () { controller.abort(); }, LIVE_CHECK_TIMEOUT_MS);
  try {
    // GET rather than HEAD — some document servers (gov.za among them)
    // don't support HEAD properly and will wrongly 404/405 a request that
    // would have succeeded as a GET.
    const res = await fetch(url, {
      method: 'GET',
      redirect: 'follow',
      signal: controller.signal,
      headers: { 'User-Agent': 'Mozilla/5.0 (compatible; ArkKonsultGazetteHub/1.0; +https://gazette-hub.netlify.app)' },
    });
    return res.ok;
  } catch (e) {
    return false;
  } finally {
    clearTimeout(timer);
  }
}

async function verifyOneNotice(notice) {
  if (!notice || typeof notice !== 'object') return;
  const guessed = notice.source_url;

  try {
    if (guessed && (await liveVerify(guessed))) {
      notice.source_url = guessed;
      notice.link_verified = true;
      notice.link_source = 'ai-guess-live-verified';
      return;
    }
  } catch (e) {
    console.error('Live link verification errored for ' + guessed + ':', e.message);
  }

  try {
    const verified = await getVerifiedUrl(notice.gazette_no, notice.date);
    notice.source_url = verified || null;
    notice.link_verified = !!verified;
    notice.link_source = verified ? 'gazettes-africa-index' : null;
  } catch (e) {
    console.error('Gazette index lookup failed for gazette_no ' + notice.gazette_no + ':', e.message);
    notice.source_url = null;
    notice.link_verified = false;
    notice.link_source = null;
  }
}

async function verifyNoticeLinks(notices) {
  if (!Array.isArray(notices)) return notices;
  // All notices are checked in parallel — each check is its own network
  // call, so doing them one at a time would multiply the added latency by
  // up to 8 instead of it costing roughly one check's worth of time.
  await Promise.all(notices.map(verifyOneNotice));
  return notices;
}

module.exports = { verifyNoticeLinks };
