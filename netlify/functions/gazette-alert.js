// netlify/functions/gazette-alert.js
// Scans every active category's 1-month window (the window most likely to
// contain anything genuinely new), compares the results against what was
// seen on the last run, and — only once the whole sweep for the week is
// done, and only if something new turned up — emails a summary to the
// administrator. Nothing is sent when there's nothing new that week.
//
// This is a RESUMABLE SWEEP across possibly many invocations, not a single
// loop — see lib/sweepProgress.js for the full reasoning (the short version:
// a single AI search call and Netlify's real 30s cron / 60s manual limits
// don't leave room to reliably scan every category in one shot). Each
// invocation scans as many categories as fit in its own safe time budget,
// accumulates "what's new" findings in Blobs as it goes, and only sends the
// admin email once every category for the week has been scanned — see
// netlify.toml for the cron window this relies on to get there.
//
// This is separate from gazette-scheduler.js (the Monday full refresh
// across all three time windows, which keeps the site itself fresh) — this
// function's job is purely to flag change, not to be the site's main cache
// refresh. It does still update the 1-month cache entry as a side effect,
// so the site also benefits from this sweep mid-week.
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
const { callAI, SCHEDULED_MAX_SEARCH_USES } = require('./lib/ai');
const { setCached } = require('./lib/cache');
const { getSeen, markSeenAndDiff } = require('./lib/seen');
const { sendEmail } = require('./lib/resend');
const { isoWeekId, loadProgress, saveProgress, timeBudgetMs, markDone } = require('./lib/sweepProgress');
const { gazetteSearchUrl } = require('./lib/searchLink');

const PROGRESS_STORE = 'alert-progress';
const PROGRESS_KEY = 'current-sweep';

function escHtml(s) {
  return String(s == null ? '' : s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
}

// Same reasoning as gazette-scheduler.js's aiTimeoutMs: has to fit inside
// ONE invocation's time budget, with less room on a cron tick than a manual
// run.
function aiTimeoutMs(isManual) {
  return isManual ? 40000 : 18000;
}

async function fetchNotices(category, apiKey, isManual) {
  const currentYear = new Date().getFullYear();
  const prompt = 'Search for South African Government Gazette notices about ' + category.label + ' published in ' + currentYear + '. '
    + 'Keywords: ' + category.keywords + '. Find notices from the last 1 month. '
    + 'Return exactly 8 notices as a JSON array starting with [ and ending with ]. '
    + 'Use web search results for real notices, supplement with your knowledge to reach 8. '
    + 'For each notice, include the real source URL you found it at if possible — the user needs to be able to click through and read the full official notice. '
    + 'Set category field to "' + category.id + '" for all entries.';
  return callAI(apiKey, prompt, true, { maxSearchUses: SCHEDULED_MAX_SEARCH_USES, requestTimeoutMs: aiTimeoutMs(isManual) });
}

function buildEmail(report) {
  const sections = report.map(function (r) {
    const items = r.newNotices.map(function (n) {
      const viewLink = n.source_url ? ' — <a href="' + escHtml(n.source_url) + '" target="_blank" rel="noopener">view notice ↗</a>' : '';
      const searchLink = ' — <a href="' + escHtml(gazetteSearchUrl(n)) + '" target="_blank" rel="noopener" style="color:#8A8A8A">search for it</a>';
      return '<li style="padding:6px 0;border-top:1px solid #DDD8CF;">' + escHtml(n.title || 'Untitled notice') + (n.date ? ' — ' + escHtml(n.date) : '') + viewLink + searchLink + '</li>';
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
      const viewPart = n.source_url ? ' — ' + n.source_url : '';
      return '- ' + (n.title || 'Untitled notice') + (n.date ? ' — ' + n.date : '') + viewPart + ' — search: ' + gazetteSearchUrl(n);
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
  const runId = isoWeekId(new Date());
  const progress = await loadProgress(PROGRESS_STORE, PROGRESS_KEY, runId);
  if (!Array.isArray(progress.report)) progress.report = [];
  if (progress.emailSent === undefined) progress.emailSent = false;

  const budgetMs = timeBudgetMs(isManual);
  const loopStart = Date.now();

  console.log('Gazette alert tick (' + (isManual ? 'manual' : 'cron') + '):', new Date().toISOString(),
    '— week ' + runId + ', ' + progress.doneKeys.length + '/' + categories.length + ' already scanned');

  const processedThisRun = [];
  for (const category of categories) {
    if (progress.doneKeys.indexOf(category.id) !== -1) continue; // already scanned this week
    if (Date.now() - loopStart > budgetMs) break; // out of time this invocation — pick up next time

    try {
      const previouslySeenCount = (await getSeen(category.id)).length;
      const notices = await fetchNotices(category, apiKey, isManual);

      // Keep the 1-month cache fresh as a side effect of scanning it.
      if (notices.length > 0) await setCached(category.id, 1, notices);

      const newOnes = await markSeenAndDiff(category.id, notices);

      // First time we've ever scanned this category: prime the "seen" list
      // but don't report anything, or the very first run would flag every
      // existing notice as "new".
      if (previouslySeenCount > 0 && newOnes.length > 0) {
        progress.report.push({ label: category.label, newNotices: newOnes });
      }
      markDone(progress, category.id);
      await saveProgress(PROGRESS_STORE, PROGRESS_KEY, progress); // persist after EVERY success

      processedThisRun.push({ category: category.id, scanned: notices.length, new: newOnes.length, firstScan: previouslySeenCount === 0 });
      console.log('  ' + category.id + ': ' + notices.length + ' scanned, ' + newOnes.length + ' new' + (previouslySeenCount === 0 ? ' (first scan — not reported)' : ''));
    } catch (e) {
      // Not marked done — a future invocation will retry this category.
      console.error('  Error for ' + category.id + ':', e.message);
      processedThisRun.push({ category: category.id, error: e.message });
    }
  }

  const remaining = categories.length - progress.doneKeys.length;
  let emailResult = null;

  if (remaining === 0) {
    if (!progress.completedAt) progress.completedAt = new Date().toISOString();

    if (progress.report.length > 0 && !progress.emailSent) {
      const resendKey = process.env.RESEND_API_KEY;
      const fromEmail = process.env.NEWSLETTER_FROM_EMAIL;
      const toEmail = process.env.ADMIN_ALERT_EMAIL;
      if (!resendKey || !fromEmail || !toEmail) {
        console.error('Gazette alert: found new notices but cannot email — missing RESEND_API_KEY, NEWSLETTER_FROM_EMAIL, or ADMIN_ALERT_EMAIL');
      } else {
        const totalNew = progress.report.reduce(function (sum, r) { return sum + r.newNotices.length; }, 0);
        const { html, text } = buildEmail(progress.report);
        try {
          await sendEmail(resendKey, fromEmail, toEmail, 'New gazette notices this week (' + totalNew + ')', html, text);
          emailResult = { sent: true, totalNew: totalNew };
          progress.emailSent = true;
        } catch (e) {
          console.error('Gazette alert: send failed:', e.message);
          emailResult = { sent: false, error: e.message };
          // emailSent stays false — a future invocation this week (if the
          // sweep somehow re-runs) or next Friday's fresh sweep can retry.
        }
      }
    }
    await saveProgress(PROGRESS_STORE, PROGRESS_KEY, progress);
    console.log('Alert sweep complete for week ' + runId + ': ' + progress.report.length + ' categories with new notices');
  }

  console.log('Gazette alert tick complete: ' + processedThisRun.length + ' scanned this run, ' + progress.doneKeys.length + '/' + categories.length + ' done overall');
  return {
    statusCode: 200,
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      week: runId,
      processedThisRun: processedThisRun,
      doneSoFar: progress.doneKeys.length,
      totalCategories: categories.length,
      remaining: remaining,
      weekComplete: remaining === 0,
      categoriesWithNew: progress.report.length,
      email: emailResult,
    }),
  };
};
