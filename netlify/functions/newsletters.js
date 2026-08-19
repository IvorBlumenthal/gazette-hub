// netlify/functions/newsletters.js
// Public, no-password endpoint behind newsletter.html.
//   GET                  -> { latest: <most recent published issue or null>, archive: [...] }
//   GET ?month=YYYY-MM   -> { issue: <that issue> } (404 if not found)

const { getIndex, getIssue } = require('./lib/newsletters');

exports.handler = async (event) => {
  const headers = {
    'Access-Control-Allow-Origin': '*',
    'Access-Control-Allow-Headers': 'Content-Type',
    'Content-Type': 'application/json',
  };
  if (event.httpMethod === 'OPTIONS') return { statusCode: 200, headers, body: '' };

  const month = event.queryStringParameters && event.queryStringParameters.month;
  if (month) {
    const issue = await getIssue(month);
    if (!issue) return { statusCode: 404, headers, body: JSON.stringify({ error: 'No newsletter found for ' + month }) };
    return { statusCode: 200, headers, body: JSON.stringify({ issue: issue }) };
  }

  const archive = await getIndex();
  const latest = archive.length > 0 ? await getIssue(archive[0].month) : null;
  return { statusCode: 200, headers, body: JSON.stringify({ latest: latest, archive: archive }) };
};
