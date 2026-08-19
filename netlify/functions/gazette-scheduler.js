<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="UTF-8">
<meta name="viewport" content="width=device-width, initial-scale=1.0">
<title>SA Gazette Hub — ArkKonsult</title>
<style>
*,*::before,*::after{box-sizing:border-box;margin:0;padding:0;}
:root{
  --navy:#1A2E3B;--navy-mid:#2C4A5C;--navy-light:#3D6275;
  --gold:#C9922A;--gold-light:#F5E8CE;
  --cream:#FAF8F3;--sand:#EDE8DF;
  --text:#2C2C2C;--text-mid:#5A5A5A;--text-soft:#8A8A8A;
  --green:#2E7D52;--green-light:#E8F5ED;
  --red:#C0392B;--red-light:#FDECEA;
  --border:#DDD8CF;
  --radius:10px;--radius-lg:16px;
}
body{font-family:'Segoe UI',system-ui,sans-serif;background:var(--cream);color:var(--text);min-height:100vh;}
a{color:inherit;text-decoration:none;}
header{background:var(--navy);color:#fff;padding:0 32px;}
.hdr-inner{max-width:1100px;margin:0 auto;display:flex;align-items:center;justify-content:space-between;height:64px;}
.hdr-brand{font-size:1.1rem;font-weight:700;letter-spacing:.5px;}
.hdr-brand span{color:var(--gold);}
.hdr-sub{font-size:.78rem;color:#aaa;margin-top:2px;}
.hdr-badge{background:var(--gold);color:var(--navy);font-size:.7rem;font-weight:700;padding:3px 10px;border-radius:20px;letter-spacing:.5px;}
.period-bar{background:var(--navy-mid);padding:10px 32px;}
.period-inner{max-width:1100px;margin:0 auto;display:flex;align-items:center;gap:8px;}
.period-label{font-size:.78rem;color:#ccc;margin-right:4px;}
.pbtn{background:transparent;border:1px solid rgba(255,255,255,.25);color:#ddd;font-size:.78rem;padding:5px 14px;border-radius:20px;cursor:pointer;transition:all .2s;}
.pbtn:hover{border-color:var(--gold);color:var(--gold);}
.pbtn.active{background:var(--gold);border-color:var(--gold);color:var(--navy);font-weight:700;}
.search-bar{background:#fff;border-bottom:1px solid var(--border);padding:14px 32px;}
.search-inner{max-width:1100px;margin:0 auto;display:flex;gap:10px;}
#srch-input{flex:1;border:1px solid var(--border);border-radius:var(--radius);padding:10px 14px;font-size:.9rem;outline:none;transition:border-color .2s;}
#srch-input:focus{border-color:var(--gold);}
#srch-btn{background:var(--navy);color:#fff;border:none;border-radius:var(--radius);padding:10px 22px;font-size:.88rem;font-weight:600;cursor:pointer;white-space:nowrap;}
#srch-btn:hover{background:var(--navy-mid);}
.main{max-width:1100px;margin:0 auto;padding:28px 32px;}
#search-results-section{margin-bottom:24px;display:none;}
.sr-heading{font-size:1rem;font-weight:700;margin-bottom:14px;color:var(--navy);}
.cat-grid{display:grid;grid-template-columns:1fr 1fr;gap:20px;}
@media(max-width:720px){.cat-grid{grid-template-columns:1fr;}}
.cat-card{background:#fff;border:1px solid var(--border);border-radius:var(--radius-lg);overflow:hidden;}
.cat-header{display:flex;align-items:center;justify-content:space-between;padding:14px 18px;cursor:pointer;background:var(--navy);color:#fff;user-select:none;}
.cat-header:hover{background:var(--navy-mid);}
.cat-title{font-size:.95rem;font-weight:700;display:flex;align-items:center;gap:8px;}
.cat-icon{font-size:1rem;}
.cat-toggle{font-size:.85rem;opacity:.7;transition:transform .2s;}
.cat-toggle.open{transform:rotate(180deg);}
.cat-body{padding:16px;min-height:60px;display:none;}
.cat-body.open{display:block;}
.cat-load-btn{display:block;width:100%;background:var(--gold-light);border:1px solid var(--gold);color:var(--navy);border-radius:var(--radius);padding:12px;font-size:.88rem;font-weight:600;cursor:pointer;text-align:center;}
.cat-load-btn:hover{background:var(--gold);color:#fff;}
.notice-card{border:1px solid var(--border);border-radius:var(--radius);padding:14px 16px;margin-bottom:12px;background:#fff;transition:box-shadow .2s;}
.notice-card:hover{box-shadow:0 2px 12px rgba(0,0,0,.08);}
.notice-card:last-child{margin-bottom:0;}
.notice-title{font-size:.9rem;font-weight:700;color:var(--navy);margin-bottom:6px;line-height:1.35;}
.notice-meta{font-size:.75rem;color:var(--text-soft);margin-bottom:8px;display:flex;gap:12px;flex-wrap:wrap;}
.notice-meta .gaz-no{color:var(--gold);font-weight:600;}
.notice-summary{font-size:.83rem;color:var(--text-mid);line-height:1.6;margin-bottom:8px;}
.notice-note{font-size:.78rem;background:var(--green-light);color:var(--green);border-left:3px solid var(--green);padding:6px 10px;border-radius:0 var(--radius) var(--radius) 0;}
.notice-link{display:inline-block;font-size:.78rem;font-weight:600;color:var(--navy-light);margin-top:8px;}
.notice-link:hover{text-decoration:underline;color:var(--gold);}
.spinner{text-align:center;padding:28px;color:var(--text-soft);font-size:.88rem;}
.spin{display:inline-block;width:20px;height:20px;border:2px solid var(--border);border-top-color:var(--gold);border-radius:50%;animation:spin .7s linear infinite;vertical-align:middle;margin-right:8px;}
@keyframes spin{to{transform:rotate(360deg)}}
.err-msg{background:var(--red-light);color:var(--red);border-radius:var(--radius);padding:12px 16px;font-size:.85rem;}
.empty-msg{color:var(--text-soft);font-size:.85rem;padding:12px 0;text-align:center;}
.cache-badge{display:inline-block;background:var(--green-light);color:var(--green);font-size:.7rem;font-weight:700;padding:2px 8px;border-radius:20px;margin-left:8px;vertical-align:middle;}
footer{background:var(--navy);color:#aaa;text-align:center;padding:20px 32px;font-size:.78rem;margin-top:40px;}
footer a{color:var(--gold);}
</style>
</head>
<body>
<header>
  <div class="hdr-inner">
    <div>
      <div class="hdr-brand"><span>SA</span> Gazette Hub</div>
      <div class="hdr-sub">South African Government Gazette Intelligence · ArkKonsult</div>
    </div>
    <div class="hdr-badge">EMPLOYER-SIDE ADVISORY</div>
  </div>
</header>
<div class="period-bar">
  <div class="period-inner">
    <span class="period-label">Period:</span>
    <button class="pbtn" data-months="1" onclick="setPeriod(this)">1 month</button>
    <button class="pbtn active" data-months="3" onclick="setPeriod(this)">3 months</button>
    <button class="pbtn" data-months="6" onclick="setPeriod(this)">6 months</button>
  </div>
</div>
<div class="search-bar">
  <div class="search-inner">
    <input id="srch-input" type="text" placeholder="Search gazette notices — e.g. minimum wage, employment equity, B-BBEE codes…" />
    <button id="srch-btn" onclick="runSearch()">Search</button>
  </div>
</div>
<div class="main">
  <div id="search-results-section">
    <div class="sr-heading" id="sr-heading">Search results</div>
    <div id="search-results-body"></div>
  </div>
  <div class="cat-grid" id="cat-grid"></div>
</div>
<footer>
  <a href="https://arkkonsult.co.za" target="_blank">arkkonsult.co.za</a> &nbsp;|&nbsp;
  ivorb@arkkonsult.com &nbsp;|&nbsp; +27 82 880 5316 &nbsp;|&nbsp;
  &copy; 2025 ArkKonsult PTY Limited. All rights reserved. &nbsp;|&nbsp;
  <a href="/admin.html">Manage categories</a>
</footer>
<script>
let CATEGORIES = [];
const PERIOD_LABELS = { 1:'last month', 3:'last 3 months', 6:'last 6 months' };
let currentPeriod = 3;
const catState = {};
async function fetchCategories() {
  try {
    const res = await fetch('/.netlify/functions/categories');
    if (!res.ok) throw new Error('HTTP ' + res.status);
    const data = await res.json();
    return Array.isArray(data.categories) ? data.categories : [];
  } catch (err) {
    console.error('Failed to load categories:', err);
    return [];
  }
}
function buildCategories() {
  const grid = document.getElementById('cat-grid');
  grid.innerHTML = '';
  if (CATEGORIES.length === 0) {
    grid.innerHTML = '<div class="err-msg">Could not load categories. <button class="cat-load-btn" style="margin-top:10px" onclick="location.reload()">&#8634; Try again</button></div>';
    return;
  }
  CATEGORIES.forEach(cat => {
    catState[cat.id] = 'idle';
    const card = document.createElement('div');
    card.className = 'cat-card';
    card.innerHTML = `
      <div class="cat-header" onclick="toggleCat('${cat.id}')">
        <div class="cat-title"><span class="cat-icon">${cat.icon}</span>${cat.label}</div>
        <span class="cat-toggle" id="toggle-${cat.id}">▼</span>
      </div>
      <div class="cat-body" id="body-${cat.id}" data-cat-id="${cat.id}">
        <button class="cat-load-btn" onclick="loadCategory('${cat.id}')">&#8595; Load ${PERIOD_LABELS[currentPeriod]} notices</button>
      </div>`;
    grid.appendChild(card);
  });
}
function toggleCat(id) {
  const body = document.getElementById('body-'+id);
  const toggle = document.getElementById('toggle-'+id);
  const isOpen = body.classList.contains('open');
  body.classList.toggle('open', !isOpen);
  toggle.classList.toggle('open', !isOpen);
  if (!isOpen && catState[id] === 'idle') loadCategory(id);
}
function setPeriod(btn) {
  document.querySelectorAll('.pbtn').forEach(b => b.classList.remove('active'));
  btn.classList.add('active');
  currentPeriod = parseInt(btn.dataset.months);
  CATEGORIES.forEach(cat => {
    catState[cat.id] = 'idle';
    const body = document.getElementById('body-'+cat.id);
    body.innerHTML = `<button class="cat-load-btn" onclick="loadCategory('${cat.id}')">&#8595; Load ${PERIOD_LABELS[currentPeriod]} notices</button>`;
    if (body.classList.contains('open')) loadCategory(cat.id);
  });
}
async function loadCategory(id) {
  if (catState[id] === 'loading' || catState[id] === 'loaded') return;
  catState[id] = 'loading';
  const body = document.getElementById('body-'+id);
  const toggle = document.getElementById('toggle-'+id);
  body.classList.add('open');
  toggle.classList.add('open');
  body.innerHTML = spinner('Loading gazette notices…');
  const result = await apiFetch({ category: id, months: currentPeriod });
  if (!result) {
    catState[id] = 'idle';
    body.innerHTML = `<div class="err-msg">Could not load notices. <button class="cat-load-btn" style="margin-top:10px" onclick="retryLoad('${id}')">&#8634; Try again</button></div>`;
    return;
  }
  catState[id] = 'loaded';
  const cached = result.cached ? '<span class="cache-badge">cached</span>' : '';
  body.innerHTML = `<div style="margin-bottom:10px;font-size:.78rem;color:var(--text-soft)">${result.notices.length} notices · ${PERIOD_LABELS[currentPeriod]} ${cached}</div>` + renderNotices(result.notices);
}
function retryLoad(id) { catState[id] = 'idle'; loadCategory(id); }
async function runSearch() {
  const q = document.getElementById('srch-input').value.trim();
  if (!q) return;
  const section = document.getElementById('search-results-section');
  const body = document.getElementById('search-results-body');
  const heading = document.getElementById('sr-heading');
  section.style.display = 'block';
  heading.textContent = `Searching for "${q}"…`;
  body.innerHTML = spinner('Searching gazette notices…');
  const result = await apiFetch({ search: q, months: currentPeriod });
  if (!result) { body.innerHTML = '<div class="err-msg">Search failed. Please try again.</div>'; heading.textContent = 'Search failed'; return; }
  heading.textContent = `${result.notices.length} result${result.notices.length !== 1 ? 's' : ''} for "${q}"`;
  body.innerHTML = result.notices.length > 0 ? renderNotices(result.notices) : '<div class="empty-msg">No notices found. Try different keywords.</div>';
}
async function apiFetch(payload) {
  try {
    const res = await fetch('/.netlify/functions/gazette', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(payload) });
    if (!res.ok) throw new Error('HTTP ' + res.status);
    return await res.json();
  } catch (err) { console.error('API error:', err); return null; }
}
function renderNotices(notices) {
  if (!notices || notices.length === 0) return '<div class="empty-msg">No notices for this period.</div>';
  return notices.map(n => `
    <div class="notice-card">
      <div class="notice-title">${escHtml(n.title || 'Untitled notice')}</div>
      <div class="notice-meta"><span class="gaz-no">${escHtml(n.gazette_no || '')}</span><span>${escHtml(n.date || '')}</span></div>
      <div class="notice-summary">${escHtml(n.summary || '')}</div>
      ${n.practitioner_note ? `<div class="notice-note">📌 ${escHtml(n.practitioner_note)}</div>` : ''}
      ${n.source_url ? `<a class="notice-link" href="${escHtml(n.source_url)}" target="_blank" rel="noopener">View full notice ↗</a>` : ''}
    </div>`).join('');
}
function spinner(msg) { return `<div class="spinner"><span class="spin"></span>${msg}</div>`; }
function escHtml(s) { return String(s).replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;'); }
window.addEventListener('DOMContentLoaded', async () => {
  CATEGORIES = await fetchCategories();
  buildCategories();
  document.getElementById('srch-input').addEventListener('keydown', e => { if (e.key === 'Enter') runSearch(); });
  // Auto-load the first two categories so the page isn't empty on arrival.
  CATEGORIES.slice(0, 2).forEach((cat, i) => setTimeout(() => loadCategory(cat.id), 300 + i * 300));
});
</script>
</body>
</html>
