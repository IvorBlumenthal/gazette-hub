// netlify/functions/lib/site.js
// Single place to change the site's public URL if the domain ever changes
// (e.g. moving off the default gazette-hub.netlify.app subdomain onto a
// custom domain like gazettes.arkkonsult.co.za). Used for building links in
// confirmation/unsubscribe emails and redirects.

const SITE_URL = 'https://gazette-hub.netlify.app';

module.exports = { SITE_URL };
