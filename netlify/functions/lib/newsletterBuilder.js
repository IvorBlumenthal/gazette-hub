// netlify/functions/lib/newsletterBuilder.js
// Core logic for building a monthly newsletter draft — shared between the
// scheduled function (netlify/functions/newsletter-generator.js, runs
// automatically on the 1st of each month) and the admin "Generate now"
// button (netlify/functions/newsletter-admin.js), so both go through the
// exact same code path instead of drifting apart.
//
// Design choice: this does NOT ask the AI to invent newsletter content from
// scratch. It first gathers the real notices for the past month the same
// way the rest of the site does (reusing the 1-month cache, or a fresh
// search if that's missing), and only then asks the AI to write prose
// around those real notices — so the newsletter can't describe a notice
// that doesn't actually exist.

const { loadAll } = require('./categories');
const { callAI, callAINewsletter } = require('./ai');
const { getCached, setCached } = require('./cache');
const { saveDraft } = require('./newsletters');

function monthKey(date) {
  return date.getFullYear() + '-' + String(date.getMonth() + 1).padStart(2, '0');
}

function monthTitle(date) {
  return date.toLocaleString('en-US', { month: 'long', year: 'numeric' });
}

async function fetchFreshNotices(category, apiKey) {
  const currentYear = new Date().getFullYear();
  const prompt = 'Search for South African Government Gazette notices about ' + category.label + ' published in ' + currentYear + '. '
    + 'Keywords: ' + category.keywords + '. Find notices from the last 1 month. '
    + 'Return exactly 8 notices as a JSON array starting with [ and ending with ]. '
    + 'Use web search results for real notices, supplement with your knowledge to reach 8. '
    + 'For each notice, include the real source URL you found it at if possible. '
    + 'Set category field to "' + category.id + '" for all entries.';
  return callAI(apiKey, prompt, true);
}

// Gathers real notices per active category for the past month, reusing the
// 1-month cache the main site already keeps warm (see gazette-scheduler.js)
// so this normally does no extra AI calls at all — it only falls back to a
// fresh search for a category whose cache happens to be empty.
async function gatherMonthNotices(apiKey) {
  const categories = (await loadAll()).filter(function (c) { return c.active !== false; });
  const grouped = [];

  for (const category of categories) {
    let notices = await getCached(category.id, 1);
    if (!notices || notices.length === 0) {
      try {
        notices = await fetchFreshNotices(category, apiKey);
        if (notices.length > 0) await setCached(category.id, 1, notices);
      } catch (e) {
        console.error('Newsletter: could not gather notices for ' + category.id + ':', e.message);
        notices = [];
      }
    }
    if (notices && notices.length > 0) {
      grouped.push({ categoryId: category.id, categoryLabel: category.label, notices: notices });
    }
  }

  return grouped;
}

function fallbackSynthesis(categoryLabel, count) {
  return count + ' notice' + (count === 1 ? '' : 's') + ' were published this month under ' + categoryLabel + '. See below for details.';
}

// Builds and saves the draft. Returns the draft object.
async function buildAndSaveDraft(apiKey) {
  const now = new Date();
  const grouped = await gatherMonthNotices(apiKey);

  if (grouped.length === 0) {
    const emptyDraft = {
      month: monthKey(now),
      generatedAt: now.toISOString(),
      subject: 'ArkKonsult Gazette Digest — ' + monthTitle(now),
      title: 'Gazette Digest — ' + monthTitle(now),
      intro: 'No new gazette notices were found across your tracked categories this month.',
      sections: [],
    };
    await saveDraft(emptyDraft);
    return emptyDraft;
  }

  const aiInput = grouped.map(function (g) {
    return {
      categoryId: g.categoryId,
      categoryLabel: g.categoryLabel,
      notices: g.notices.map(function (n) {
        return { title: n.title, date: n.date, gazette_no: n.gazette_no, summary: n.summary, practitioner_note: n.practitioner_note };
      }),
    };
  });
  const prompt = 'Write the ' + monthTitle(now) + ' newsletter from these real gazette notices, grouped by category:\n\n' + JSON.stringify(aiInput);

  let written;
  try {
    written = await callAINewsletter(apiKey, prompt);
  } catch (e) {
    console.error('Newsletter: AI writing failed, falling back to plain synthesis:', e.message);
    written = { subject: null, title: null, intro: null, sections: [] };
  }

  const writtenByCategory = {};
  (written.sections || []).forEach(function (s) {
    if (s && s.categoryId) writtenByCategory[s.categoryId] = s.synthesis;
  });

  const sections = grouped.map(function (g) {
    return {
      categoryId: g.categoryId,
      categoryLabel: g.categoryLabel,
      synthesis: writtenByCategory[g.categoryId] || fallbackSynthesis(g.categoryLabel, g.notices.length),
      notices: g.notices.map(function (n) {
        return { title: n.title, date: n.date, gazette_no: n.gazette_no, source_url: n.source_url };
      }),
    };
  });

  const draft = {
    month: monthKey(now),
    generatedAt: now.toISOString(),
    subject: written.subject || ('ArkKonsult Gazette Digest — ' + monthTitle(now)),
    title: written.title || ('Gazette Digest — ' + monthTitle(now)),
    intro: written.intro || ('A summary of South African Government Gazette notices published across your tracked categories in ' + monthTitle(now) + '.'),
    sections: sections,
  };

  await saveDraft(draft);
  return draft;
}

module.exports = { buildAndSaveDraft, monthKey, monthTitle };
