// netlify/functions/lib/sweepProgress.js
//
// Shared helper for a resumable "sweep" — a job that has to work through a
// list of items (category/period combinations, or just categories) but
// cannot reliably finish inside a single function invocation.
//
// Why this exists: Netlify kills a function Netlify's own scheduled cron
// invokes at a fixed, non-configurable 30 seconds; a manually-POSTed
// invocation (the admin panel's "Refresh all categories now" button, or a
// ?secret=... test run) gets 60 seconds — both confirmed via Netlify's docs
// and empirically (see netlify.toml / lib/ai.js for the history). A single
// AI search call can itself take the low tens of seconds. gazette-scheduler
// and gazette-alert used to loop over up to 24 combinations in one
// invocation, assuming a 900-second background-function budget that turned
// out to be dead configuration — in reality they were being killed after
// completing only 0-1 combinations, silently, for a long time.
//
// The fix isn't a bigger timeout (there isn't a bigger real one to ask for
// without a paid Background Functions upgrade, and even that only reaches
// 15 minutes, which the worst case here can still exceed). Instead, each
// invocation works through as many items as fit in its own safe time
// budget, saves progress to Blobs after every single item that succeeds,
// and picks up exactly where it left off next time — whether "next time" is
// the next cron tick a few minutes later or a second click of the admin
// button. See netlify.toml for the cron windows this relies on.

const {
