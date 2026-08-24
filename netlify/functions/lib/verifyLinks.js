// netlify/functions/lib/verifyLinks.js
// Makes sure a notice's "View full notice" link is one that actually
// works, and actually points at the notice it claims to, before it's
// ever shown.
//
// Only one source of links is used: the AI's own guessed source_url, and
// only if ALL three of these hold:
//
//   1. It looks like a specific document — a direct PDF/Word file, never
//      a generic webpage (see looksLikeSpecificDocument below).
//
//   2. The notice's own gazette number appears in the URL itself. A URL
//      that loads fine and is a real PDF can still be the WRONG PDF — the
//      AI can pair a fabricated or mismatched notice with a real, live,
//      unrelated document, and nothing about "it loads" catches that. If
//      the gazette number isn't in the address, we have no way to confirm
//      it's actually that gazette, so it's rejected.
//
//   3. It actually loads (a real GET request, not just a plausible-looking
//      address).
//
// gazettes.africa's own per-document index (gazetteIndex.js) used to be a
// fallback here, but real end-user clicks on those links have been shown
// to intermittently 403 or hang behind Cloudflare's bot-check — not just a
// scraping problem, a real problem for a person clicking the link. So it's
// no longer used as a link source at all, even though the underlying
// documents are real.
//
// If the checks above don't all pass, source_url is cleared rather than
// left as an unverified guess — the site's own rendering code already
// only shows a "View full notice" button when source_url is present, so a
// missing link means "we could not confirm a real, matching document,"
// never "here's a link that might be dead, wrong, or login-walled."

const LIVE_CHECK_TIMEOUT_MS = 8000;

// Gazette numbers arrive in different shapes ("55238", "No. 55238",
// "GG55238"...) — keep only the digits so the AI-supplied number and the
// digits found in a URL compare on equal footing.
function normaliseNumber(raw) {
  const digits = String(raw || '').replace(/[^0-9]/g, '');
  return digits || null;
}

// True only if the notice's own gazette number shows up as a run of
// digits somewhere in the URL — e.g. gazette_no "55238" matches
// ".../55238.pdf" or ".../notice-55238-2026.pdf", but not a URL that
// merely loads successfully and happens to be some other document.
function urlContainsGazetteNumber(url, gazetteNo) {
  const number = normaliseNumber(gazetteNo);
  if (!number) return false;
  const digitRuns = String(url).match(/\d+/g) || [];
  return digitRuns.indexOf(number) !== -1;
}

// A URL that loads successfully isn't the same as a URL that points at the
// actual notice. A generic path-length check isn't enough to tell the two
// apart — confirmed by a real example: gpwonline.co.za's own "Gazette
// Enquiries" contact page has a long, date-shaped address
// ("/2025/07/31/gazette-enquiries/") and loads perfectly fine (200 OK),
// but it's a blog post, not a notice. So this only accepts a direct PDF
// (or Word doc) file — every real source we've found (gov.za, SARS,
// provincial departments, labour.gov.za...) serves the actual notice as a
// PDF file, never as a generic webpage.
//
// gazettes.africa's own per-document URLs used to be accepted here too —
// structurally they're impossible to confuse with a listing page — but
// real end-user clicks on those have been shown to intermittently 403 or
// hang behind Cloudflare's bot-check. That's not a "does it look right"
// problem, it's a "does it actually work for a person" problem, so
// gazettes.africa is deliberately excluded rather than special-cased back
// in: only a direct document file is ever accepted.
function looksLikeSpecificDocument(url) {
  let parsed;
  try {
    parsed = new URL(url);
  } catch (e) {
    return false;
  }
  return /\.(pdf|docx?|rtf)$/i.test(parsed.pathname);
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
    if (guessed && urlContainsGazetteNumber(guessed, notice.gazette_no) && (await liveVerify(guessed))) {
      notice.source_url = guessed;
      notice.link_verified = true;
      notice.link_source = 'ai-guess-live-verified';
      return;
    }
  } catch (e) {
    console.error('Live link verification errored for ' + guessed + ':', e.message);
  }

  // No fallback: a mismatched or unreachable guess is worse than no link.
  notice.source_url = null;
  notice.link_verified = false;
  notice.link_source = null;
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
