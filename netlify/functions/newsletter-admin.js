// netlify/functions/newsletter-admin.js
// Admin-only endpoint (same x-admin-password pattern as categories.js) for
// reviewing, regenerating, and publishing the monthly newsletter.
//
//   GET                    -> { draft, archive }
//   POST { action:"generate" } -> builds (or rebuilds) the draft now, returns it
//   POST { action:"publish" }  -> publishes the current draft and emails every
//                                 confirmed subscriber
//
// Required environment variables (on top of ADMIN_PASSWORD and
// ANTHROPIC_API_KEY, which the rest of the site already needs):
//   RESEND_API_KEY        - from the user's Resend account
//   NEWSLETTER_FROM_EMAIL - verified sending address, e.g. ivorb@arkkonsult.com

const { getDraft, getIndex, publish } = require('./lib/newsletters');
const { buildAndSaveDraft } = require('./lib/newsletterBuilder');
const { confirmedList } = require('./lib/subscribers');
const { sendBatch } = require('./lib/resend');
const { renderEmailHtml, pickSectionsForSubscriber } = require('./lib/newsletterEmail');
const { SITE_URL } = require('./lib/site');

function checkAuth(event) {
  const adminPassword = process.env.ADMIN_PASSWORD;
  if (!adminPassword) return 'ADMIN_PASSWORD is not configured on the server.';
  const supplied = event.headers['x-admin-password'] || event.headers['X-Admin-Password'];
  if (supplied !== adminPassword) return 'Invalid admin password';
  return null;
}

exports.handler = async (event) => {
  const headers = { 'Content-Type': 'application/json' };
  if (event.httpMethod === 'OPTIONS') return { statusCode: 200, headers, body: '' };

  const authErr = checkAuth(event);
  if (authErr) return { statusCode: authErr.indexOf('configured') !== -1 ? 500 : 401, headers, body: JSON.stringify({ error: authErr }) };

  if (event.httpMethod === 'GET') {
    const draft = await getDraft();
    const archive = await getIndex();
    return { statusCode: 200, headers, body: JSON.stringify({ draft: draft || null, archive: archive }) };
  }

  if (event.httpMethod !== 'POST') {
    return { statusCode: 405, headers, body: JSON.stringify({ error: 'Method not allowed' }) };
  }

  let body;
  try { body = JSON.parse(event.body || '{}'); }
  catch (e) { return { statusCode: 400, headers, body: JSON.stringify({ error: 'Invalid JSON' }) }; }

  if (body.action === 'generate') {
    const apiKey = process.env.ANTHROPIC_API_KEY;
    if (!apiKey) return { statusCode: 500, headers, body: JSON.stringify({ error: 'ANTHROPIC_API_KEY not set' }) };
    try {
      const draft = await buildAndSaveDraft(apiKey);
      return { statusCode: 200, headers, body: JSON.stringify({ draft: draft }) };
    } catch (e) {
      console.error('Newsletter generate failed:', e.message);
      return { statusCode: 502, headers, body: JSON.stringify({ error: e.message }) };
    }
  }

  if (body.action === 'publish') {
    const draft = await getDraft();
    if (!draft) return { statusCode: 400, headers, body: JSON.stringify({ error: 'There is no draft to publish. Generate one first.' }) };
    if (!draft.sections || draft.sections.length === 0) {
      return { statusCode: 400, headers, body: JSON.stringify({ error: 'This draft has no notices in it — nothing to publish.' }) };
    }

    const resendKey = process.env.RESEND_API_KEY;
    const fromEmail = process.env.NEWSLETTER_FROM_EMAIL;
    if (!resendKey || !fromEmail) {
      return { statusCode: 500, headers, body: JSON.stringify({ error: 'RESEND_API_KEY / NEWSLETTER_FROM_EMAIL are not configured on the server yet.' }) };
    }

    const published = await publish(draft);

    let subscribers = [];
    try {
      subscribers = await confirmedList();
    } catch (e) {
      console.error('Newsletter publish: could not load subscribers:', e.message);
    }

    // Each subscriber only gets the sections matching their own category
    // preferences (see lib/newsletterEmail.js's pickSectionsForSubscriber) —
    // an empty/missing preference list means "everything", so long-time
    // subscribers who never set a preference keep getting the full digest
    // exactly as before. A subscriber whose chosen topics had nothing new
    // this month is skipped entirely rather than sent an empty email.
    let skippedNoMatch = 0;
    let emailResult = { sent: 0, failed: 0, errors: [] };
    if (subscribers.length > 0) {
      const emails = subscribers.map(function (sub) {
        const sections = pickSectionsForSubscriber(published, sub.categories);
        if (sections.length === 0) { skippedNoMatch += 1; return null; }
        const personalised = Object.assign({}, published, { sections: sections });
        const unsubscribeUrl = SITE_URL + '/.netlify/functions/unsubscribe?token=' + encodeURIComponent(sub.token);
        const manageUrl = SITE_URL + '/newsletter.html?manage=' + encodeURIComponent(sub.token);
        return {
          from: fromEmail,
          to: [sub.email],
          subject: published.subject,
          html: renderEmailHtml(personalised, unsubscribeUrl, manageUrl),
        };
      }).filter(Boolean);
      if (emails.length > 0) emailResult = await sendBatch(resendKey, emails);
    }

    return {
      statusCode: 200,
      headers,
      body: JSON.stringify({
        published: true,
        month: published.month,
        subscriberCount: subscribers.length,
        emailsSent: emailResult.sent,
        emailsFailed: emailResult.failed,
        emailErrors: emailResult.errors,
        skippedNoMatchingTopics: skippedNoMatch,
      }),
    };
  }

  return { statusCode: 400, headers, body: JSON.stringify({ error: 'Unknown action' }) };
};
