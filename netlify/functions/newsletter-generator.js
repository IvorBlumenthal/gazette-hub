// netlify/functions/newsletter-generator.js
// Runs on the 1st of every month via netlify.toml cron. Builds a fresh
// newsletter draft from the past month's real gazette notices and saves it
// — it does NOT publish or email anything by itself. Someone has to open
// the admin page, review the draft, and click "Publish" for it to actually
// go out. See netlify/functions/lib/newsletterBuilder.js for the shared
// logic (also used by the admin "Generate now" button).
//
// Required environment variable:
//   ANTHROPIC_API_KEY - same key gazette.js and gazette-scheduler.js use

const { buildAndSaveDraft } = require('./lib/newsletterBuilder');

exports.handler = async (event) => {
  const apiKey = process.env.ANTHROPIC_API_KEY;
  if (!apiKey) {
    console.error('Newsletter generator cannot run — missing ANTHROPIC_API_KEY');
    return { statusCode: 500, body: JSON.stringify({ error: 'Missing environment variable: ANTHROPIC_API_KEY' }) };
  }

  console.log('Newsletter generator started:', new Date().toISOString());
  try {
    const draft = await buildAndSaveDraft(apiKey);
    console.log('Newsletter draft saved for', draft.month, '—', draft.sections.length, 'categories with notices');
    return { statusCode: 200, body: JSON.stringify({ month: draft.month, sections: draft.sections.length }) };
  } catch (e) {
    console.error('Newsletter generator failed:', e.message);
    return { statusCode: 500, body: JSON.stringify({ error: e.message }) };
  }
};
