// netlify/functions/lib/searchLink.js
// Builds a "search for this yourself" link for a notice — used everywhere a
// notice is rendered (the live site, the newsletter page, the newsletter
// email, the admin alert email) alongside (or, when verification failed, in
// place of) the verified "View full notice" button.
//
// Why this exists: lib/verifyLinks.js only ever shows a "View full notice"
// button when it has confirmed a real, matching document — for every other
// notice, source_url is simply null, and until now that meant the notice
// offered no way at all to check it against the real gazette. This doesn't
// try to guess a direct document link (that's exactly the failure mode
// verifyLinks.js exists to prevent) — it hands the reader a plain search
// query, scoped to the official government domains, that THEY run in their
// own browser. A search query can't 404, can't be the wrong document, and
// doesn't depend on any one site's uptime or bot-protection the way a
// specific guessed link would.
//
// Deliberately NOT scoped to gazettes.africa: real end-user clicks on
// gazettes.africa's individual document pages have been shown to
// intermittently 403 or hang behind Cloudflare's bot-check (see
// verifyLinks.js) — including for a real person, not just an automated
// fetch — so steering readers there isn't an improvement over no link at
// all. site:gov.za also matches every department subdomain-style domain
// (sars.gov.za, labour.gov.za, etc.), not just gov.za itself, since Google's
// site: operator matches on hostname suffix.
//
// The query deliberately leads with the gazette number, not the notice's
// own title. The title is an AI-written paraphrase, not the gazette's exact
// official wording — earlier this function included the whole title, and in
// practice that made queries so long and specific (a dozen-plus required
// words, often with punctuation like a colon) that Google returned zero
// results even when a real matching document existed. The gazette number is
// the one piece of the notice that IS the document's actual identifier, so
// it's far more likely to appear on the real page. This can land on the
// broader gazette issue rather than the specific notice within it (one
// issue often bundles many notices under one number), but that's still the
// genuine official document to search from. Only when a notice has no
// gazette number at all does this fall back to the first few words of the
// title, kept short for the same reason — a short fragment is still likely
// to match real text, where the full title usually isn't.

function firstWords(str, n) {
  return String(str || '').trim().split(/\s+/).slice(0, n).join(' ');
}

function gazetteSearchUrl(notice) {
  const gazetteNo = String((notice && notice.gazette_no) || '').trim();
  const title = String((notice && notice.title) || '').trim();
  const leadTerms = gazetteNo ? [gazetteNo, 'government gazette'] : [firstWords(title, 6), 'government gazette'];
  const terms = leadTerms.concat(['site:gov.za OR site:gpwonline.co.za'])
    .filter(function (t) { return t; })
    .join(' ');
  return 'https://www.google.com/search?q=' + encodeURIComponent(terms);
}

module.exports = { gazetteSearchUrl };
