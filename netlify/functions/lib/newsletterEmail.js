// netlify/functions/lib/newsletterEmail.js
// Renders a published newsletter issue into the HTML actually emailed to
// subscribers. Kept separate from newsletter-admin.js so the template is
// easy to find and tweak on its own.

const { gazetteSearchUrl } = require('./searchLink');

function escHtml(s) {
  return String(s == null ? '' : s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
}

// Narrows a full published issue down to just the sections a given
// subscriber actually wants, per their stored category preferences. An
// empty/missing categories list means "everything" (see
// lib/subscribers.js), so that subscriber's issue is returned unchanged.
function pickSectionsForSubscriber(issue, categories) {
  const cats = Array.isArray(categories) ? categories : [];
  if (cats.length === 0) return issue.sections || [];
  return (issue.sections || []).filter(function (s) { return cats.indexOf(s.categoryId) !== -1; });
}

function renderEmailHtml(issue, unsubscribeUrl, manageUrl) {
  const sections = (issue.sections || []).map(function (s) {
    const notices = (s.notices || []).map(function (n) {
      // A verified link (when we have one) is the primary action; the
      // search link is always offered too, so a reader can double-check
      // the AI's summary against the real gazette even when we DO have a
      // confirmed link, and has an actual next step even when we don't.
      const viewLink = n.source_url ? ' — <a href="' + escHtml(n.source_url) + '">view notice</a>' : '';
      const searchLink = ' — <a href="' + escHtml(gazetteSearchUrl(n)) + '" style="color:#8A8A8A">search for it</a>';
      return '<li>' + escHtml(n.title) + (n.date ? ' (' + escHtml(n.date) + ')' : '') + viewLink + searchLink + '</li>';
    }).join('');
    return '<h2 style="color:#1A2E3B;font-size:16px;margin:24px 0 8px">' + escHtml(s.categoryLabel) + '</h2>'
      + '<p style="color:#2C2C2C;font-size:14px;line-height:1.6;margin:0 0 8px">' + escHtml(s.synthesis) + '</p>'
      + '<ul style="font-size:13px;color:#5A5A5A;line-height:1.7;margin:0 0 8px;padding-left:18px">' + notices + '</ul>';
  }).join('');

  return '<div style="font-family:Segoe UI,system-ui,sans-serif;max-width:600px;margin:0 auto">'
    + '<div style="background:#1A2E3B;color:#fff;padding:20px 24px">'
    + '<div style="font-size:18px;font-weight:700">' + escHtml(issue.title) + '</div>'
    + '<div style="font-size:12px;color:#aaa;margin-top:4px">South African Government Gazette Intelligence &middot; ArkKonsult</div>'
    + '</div>'
    + '<div style="padding:20px 24px">'
    + '<p style="font-size:14px;color:#2C2C2C;line-height:1.6">' + escHtml(issue.intro) + '</p>'
    + sections
    + '</div>'
    + '<div style="padding:16px 24px;font-size:11px;color:#8A8A8A;border-top:1px solid #DDD8CF">'
    + 'ArkKonsult PTY Limited &middot; '
    + (manageUrl ? '<a href="' + escHtml(manageUrl) + '" style="color:#8A8A8A">Manage your topics</a> &middot; ' : '')
    + '<a href="' + escHtml(unsubscribeUrl) + '" style="color:#8A8A8A">Unsubscribe</a>'
    + '</div>'
    + '</div>';
}

module.exports = { renderEmailHtml, pickSectionsForSubscriber, escHtml };
