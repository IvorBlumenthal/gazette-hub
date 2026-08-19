// netlify/functions/lib/categories.js
// Shared helper for reading/writing the gazette category list.
// Categories are stored in a Netlify Blobs store so they can be managed
// at runtime from the admin panel, with no database or redeploy needed.

const { getStore } = require('@netlify/blobs');

const STORE_NAME = 'gazette-categories';
const KEY = 'categories';

// Seed data — matches the categories the app originally shipped with, plus
// "Bargaining Councils & Agreements" added on 2026-08-19. Only used to
// initialise the store the first time it's read; after that, the blob
// store is the source of truth and this constant is not consulted again.
const DEFAULT_CATEGORIES = [
  { id: 'labour', icon: '⚖️', label: 'Labour & Employment', keywords: 'Labour Employment wage determinations CCMA employment equity sectoral UIF 2025 2026', sortOrder: 10, active: true },
  { id: 'tax', icon: '🏛️', label: 'Tax & Revenue', keywords: 'SARS tax National Treasury VAT customs income tax amendments 2025 2026', sortOrder: 20, active: true },
  { id: 'bbbee', icon: '🤝', label: 'B-BBEE & Transformation', keywords: 'B-BBEE transformation codes charters verification DTI empowerment 2025 2026', sortOrder: 30, active: true },
  { id: 'regs', icon: '📋', label: 'Company Regulations', keywords: 'Companies Act CIPC business regulations licensing consumer protection 2025 2026', sortOrder: 40, active: true },
  { id: 'procurement', icon: '🏗️', label: 'Government Procurement', keywords: 'government procurement PFMA supply chain preferential Treasury 2025 2026', sortOrder: 50, active: true },
  { id: 'environment', icon: '🌿', label: 'Environment & Sustainability', keywords: 'NEMA environmental impact waste management carbon tax 2025 2026', sortOrder: 60, active: true },
  { id: 'health', icon: '🏥', label: 'Health & OHS', keywords: 'OHS occupational health NHI pharmaceutical workplace safety 2025 2026', sortOrder: 70, active: true },
  { id: 'bargaining', icon: '📑', label: 'Bargaining Councils & Agreements', keywords: 'bargaining council collective agreements main agreement extension sectoral determination gazetted 2025 2026', sortOrder: 80, active: true },
];

function store() {
  return getStore(STORE_NAME);
}

async function loadAll() {
  const data = await store().get(KEY, { type: 'json' });
  if (data && Array.isArray(data) && data.length > 0) return data;
  await store().setJSON(KEY, DEFAULT_CATEGORIES);
  return DEFAULT_CATEGORIES.slice();
}

async function saveAll(list) {
  await store().setJSON(KEY, list);
}

async function findById(id) {
  const all = await loadAll();
  return all.find(function (c) { return c.id === id; }) || null;
}

function slugify(s) {
  return String(s || '')
    .toLowerCase()
    .trim()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/(^-+|-+$)/g, '')
    .slice(0, 40);
}

module.exports = { loadAll, saveAll, findById, slugify, DEFAULT_CATEGORIES };
