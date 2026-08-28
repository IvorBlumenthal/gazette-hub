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
// The notice's own title is included WITHOUT quotes deliberately — it's an
// AI-written paraphrase, not necessarily the gazette's exact official
// wording, so forcing an exact-phrase match could hide a real result that
// uses slightly different words.

function gazetteSearchUrl(notice) {
  const gazetteNo = String((notice && notice.gazette_no) || '').trim();
  const title = String((notice && notice.title) || '').trim();
  const terms = [gazetteNo, 'government gazette', title, 'site:gov.za OR site:gpwonline.co.za']
    .filter(function (t) { return t; })
    .join(' ');
  return 'https://www.google.com/search?q=' + encodeURIComponent(terms);
}

module.exports = { gazetteSearchUrl };
