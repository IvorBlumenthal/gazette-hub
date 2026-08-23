// netlify/functions/gazette-alert.js
// Runs every Friday at 06:00 SAST (04:00 UTC) via netlify.toml cron.
//
// Scans the 1-month window for every active category (the window most
// likely to contain anything genuinely new), compares the results against
// what was seen on the last run, and — only if something new turns up —
// emails a summary to the administrator. Nothing is sent when there's
// nothing new that week.
//
// This is separate from gazette-scheduler.js (the Monday full refresh
// across all three time windows, which keeps the site itself fresh) — this
// function's job is purely to flag change, not to be the site's main cache
// refresh. It does still update the 1-month cache entry as a side effect,
// so the site also benefits from a second refresh mid-week.
//
// Required environment variables:
//   ANTHROPIC_API_KEY     - same key gazette.js / gazette-scheduler.js use
//   BLOBS_TOKEN            - same Netlify Blobs access token used elsewhere
//   RESEND_API_KEY         - from the user's Resend account
//   NEWSLETTER_FROM_EMAIL  - verified sending address, e.g. ivorb@arkkonsult.co.za
//   ADMIN_ALERT_EMAIL      - inbox that should receive the "what's new" summary
//
// Optional:
//   MANUAL_TRIGGER_SECRET - if set, allows a manual GET run via ?secret=...
//                            for testing without waiting for Friday (same
//                            secret gazette-scheduler.js uses)

const { loadAll } = require('./lib/categories');
const { callAI } = require('./lib/ai');
const { setCached } = require('./lib/cache');
const { getSeen, markSeenAndDiff } = require('./lib/seen');
const { sendEmail } = require('./lib/resend');

function escHtml(s) {
  return String(s == null ? '' : s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
}

async function fetchNotices(category, apiKey) {
  const currentYear = new Date().getFullYear();
  const prompt = 'Search for South African Government Gazette notices about ' + category.label + ' published in ' + currentYear + '. '
    + 'Keywords: ' + category.keywords + '. Find notices from the last 1 month. '
    + 'Return exactly 8 notices as a JSON array starting with [ and ending with ]. '
    + 'Use web search results for real notices, supplement with your knowledge to reach 8. '
    + 'For each notice, include the real source URL you found it at if possible — the user needs to be able to click through and read the full official notice. '
    + 'Set category field to "' + category.id + '" for all entries.';
  return callAI(apiKey, prompt, true);
}

function buildEmail(report) {
  const sections = report.map(function (r) {
    const items = r.newNotices.map(function (n) {
      const link = n.source_url ? ' — <a href="' + escHtml(n.source_url) + '" target="_blank" rel="noopener">view notice ↗</a>' : '';
      return '<li style="padding:6px 0;border-top:1px solid #DDD8CF;">' + escHtml(n.title || 'Untitled notice') + (n.date ? ' — ' + escHtml(n.date) : '') + link + '</li>';
    }).join('');
    return '<h3 style="color:#1A2E3B;margin-top:20px;margin-bottom:6px;">' + escHtml(r.label) + ' (' + r.newNotices.length + ' new)</h3>'
      + '<ul style="list-style:none;padding:0;margin:0;font-size:14px;color:#2C2C2C;">' + items + '</ul>';
  }).join('');

  const html = '<div style="font-family:sans-serif;max-width:600px;">'
    + '<h2 style="color:#1A2E3B;">New gazette notices this week</h2>'
    + '<p style="color:#5A5A5A;font-size:14px;">SA Gazette Hub found new notices in ' + report.length + ' categor' + (report.length === 1 ? 'y' : 'ies') + ' since last week\'s scan.</p>'
    + sections
    + '</div>';

  const text = 'New gazette notices this week\n\n' + report.map(function (r) {
    return r.label + ' (' + r.newNotices.length + ' new):\n' + r.newNotices.map(function (n) {
      return '- ' + (n.title || 'Untitled notice') + (n.date ? ' — ' + n.date : '') + (n.source_url ? ' — ' + n.source_url : '');
    }).join('\n');
  }).join('\n\n');

  return { html: html, text: text };
}

exports.handler = async (event) => {
  const apiKey = process.env.ANTHROPIC_API_KEY;
  if (!apiKey) {
    console.error('Gazette alert cannot run — missing ANTHROPIC_API_KEY');
    return { statusCode: 500, body: JSON.stringify({ error: 'Missing environment variable: ANTHROPIC_API_KEY' }) };
  }

  const isManual = event.httpMethod === 'GET';
  if (isManual) {
    if (!process.env.MANUAL_TRIGGER_SECRET || event.queryStringParameters?.secret !== process.env.MANUAL_TRIGGER_SECRET) {
      return { statusCode: 401, body: 'Unauthorised' };
    }
  }

  const categories = (await loadAll()).filter(function (c) { return c.active !== false; });
  const report = [];
  console.log('Gazette alert started:', new Date().toISOString(), '—', categories.length, 'active categories');

  for (const category of categories) {
    try {
      const previouslySeenCount = (await getSeen(category.id)).length;
      const notices = await fetchNotices(category, apiKey);

      // Keep the 1-month cache fresh as a side effect of scanning it.
      if (notices.length > 0) await setCached(category.id, 1, notices);

      const newOnes = await markSeenAndDiff(category.id, notices);

      // First time we've ever scanned this category: prime the "seen" list
      // but don't report anything, or the very first run would flag every
      // existing notice as "new".
      if (previouslySeenCount > 0 && newOnes.length > 0) {
        report.push({ label: category.label, newNotices: newOnes });
      }
      console.log('  ' + category.id + ': ' + notices.length + ' scanned, ' + newOnes.length + ' new' + (previouslySeenCount === 0 ? ' (first scan — not reported)' : ''));
      await new Promise(function (r) { setTimeout(r, 2000); });
    } catch (e) {
      console.error('  Error for ' + category.id + ':', e.message);
    }
  }

  let emailResult = null;
  if (report.length > 0) {
    const resendKey = process.env.RESEND_API_KEY;
    const fromEmail = process.env.NEWSLETTER_FROM_EMAIL;
    const toEmail = process.env.ADMIN_ALERT_EMAIL;
    if (!resendKey || !fromEmail || !toEmail) {
      console.error('Gazette alert: found new notices but cannot email — missing RESEND_API_KEY, NEWSLETTER_FROM_EMAIL, or ADMIN_ALERT_EMAIL');
    } else {
      const totalNew = report.reduce(function (sum, r) { return sum + r.newNotices.length; }, 0);
      const { html, text } = buildEmail(report);
      try {
        await sendEmail(resendKey, fromEmail, toEmail, 'New gazette notices this week (' + totalNew + ')', html, text);
        emailResult = { sent: true, totalNew: totalNew };
      } catch (e) {
        console.error('Gazette alert: send failed:', e.message);
        emailResult = { sent: false, error: e.message };
      }
    }
  }

  console.log('Gazette alert complete:', report.length, 'categories with new notices');
  return { statusCode: 200, headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ categoriesWithNew: report.length, email: emailResult }) };
};
