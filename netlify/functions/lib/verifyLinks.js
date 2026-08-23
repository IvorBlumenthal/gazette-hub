// netlify/functions/lib/verifyLinks.js
// Replaces every notice's AI-guessed source_url with a REAL, verified link
// looked up from gazettes.africa's own index (see gazetteIndex.js), keyed
// by the notice's gazette number. If no verified link is found, source_url
// is cleared rather than left as an unverified guess — the site's own
// rendering code already only shows a "View full notice" button when
// source_url is present, so a missing link now means "we could not
// confirm a real document exists" rather than "here's a link that might
// be dead or login-walled."

const { getVerifiedUrl } = require('./gazetteIndex');

async function verifyNoticeLinks(notices) {
  if (!Array.isArray(notices)) return notices;
  for (const notice of notices) {
    if (!notice || typeof notice !== 'object') continue;
    try {
      const verified = await getVerifiedUrl(notice.gazette_no, notice.date);
      notice.source_url = verified || null;
      notice.link_verified = !!verified;
    } catch (e) {
      console.error('Link verification failed for gazette_no ' + notice.gazette_no + ':', e.message);
      notice.source_url = null;
      notice.link_verified = false;
    }
  }
  return notices;
}

module.exports = { verifyNoticeLinks };
