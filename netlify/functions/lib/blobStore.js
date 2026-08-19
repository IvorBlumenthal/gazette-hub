// netlify/functions/lib/blobStore.js
// Shared helper for getting a configured Netlify Blobs store.
//
// Netlify's automatic Blobs configuration doesn't land for this site's
// functions (they throw MissingBlobsEnvironmentError if called with no
// arguments), so this falls back to explicit configuration using the site
// ID Netlify always injects as process.env.SITE_ID, plus a personal access
// token supplied via the BLOBS_TOKEN environment variable. Every store used
// by this app (categories, cache) should go through this helper so they
// all pick up the same fallback.

const { getStore } = require('@netlify/blobs');

function getBlobStore(name) {
  const siteID = process.env.SITE_ID;
  const token = process.env.BLOBS_TOKEN;
  if (siteID && token) {
    return getStore({ name: name, siteID: siteID, token: token });
  }
  return getStore(name);
}

module.exports = { getBlobStore };
