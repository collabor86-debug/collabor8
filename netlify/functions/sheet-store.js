// netlify/functions/sheet-store.js
//
// A generic read/replace API backed by a Google Sheet.
// Each "table" (cabins, occupants, payments, invoices, leads, quotations)
// is stored as one tab in the spreadsheet, one JSON-encoded record per row:
//   Column A = record id      Column B = full record JSON
//
// GET  /.netlify/functions/sheet-store?sheet=occupants        -> { data: [...] }
// POST /.netlify/functions/sheet-store  { sheet, data: [...] } -> full replace of that tab
//
// Required environment variables (set in Netlify site settings, never in the repo):
//   GOOGLE_SERVICE_ACCOUNT_EMAIL
//   GOOGLE_PRIVATE_KEY        (paste the key; this function converts literal \n back to newlines)
//   GOOGLE_SHEET_ID           (the long id in your sheet's URL)

const { google } = require('googleapis');
const { verifySession } = require('./auth-check');

const ALLOWED_TABS = ['cabins', 'occupants', 'payments', 'invoices', 'leads', 'quotations', 'virtual_office', 'documents', 'settings'];
const SHEET_ID = process.env.GOOGLE_SHEET_ID;

function getAuth() {
  const email = process.env.GOOGLE_SERVICE_ACCOUNT_EMAIL;
  const key = (process.env.GOOGLE_PRIVATE_KEY || '').replace(/\\n/g, '\n');
  if (!email || !key || !SHEET_ID) {
    throw new Error('Missing GOOGLE_SERVICE_ACCOUNT_EMAIL, GOOGLE_PRIVATE_KEY, or GOOGLE_SHEET_ID env vars');
  }
  return new google.auth.JWT(email, null, key, ['https://www.googleapis.com/auth/spreadsheets']);
}

async function ensureTab(sheets, tab) {
  const meta = await sheets.spreadsheets.get({ spreadsheetId: SHEET_ID });
  const exists = meta.data.sheets.some((s) => s.properties.title === tab);
  if (!exists) {
    await sheets.spreadsheets.batchUpdate({
      spreadsheetId: SHEET_ID,
      requestBody: { requests: [{ addSheet: { properties: { title: tab } } }] },
    });
    await sheets.spreadsheets.values.update({
      spreadsheetId: SHEET_ID,
      range: `${tab}!A1:B1`,
      valueInputOption: 'RAW',
      requestBody: { values: [['id', 'json']] },
    });
  }
}

exports.handler = async (event) => {
  const headers = {
    'Content-Type': 'application/json',
    'Access-Control-Allow-Origin':
      process.env.SITE_URL || 'https://colabor8.netlify.app',
    'Access-Control-Allow-Headers': 'Content-Type',
    'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
  };

  if (event.httpMethod === 'OPTIONS') {
    return {
      statusCode: 204,
      headers,
      body: ''
    };
  }

  // 🔐 Check whether the user is logged in
  const session = verifySession(event);

  if (!session) {
    return {
      statusCode: 401,
      headers,
      body: JSON.stringify({
        error: 'Unauthorized'
      })
    };
  }

  try {
    const auth = getAuth();
    const sheets = google.sheets({ version: 'v4', auth });

    if (event.httpMethod === 'GET') {
      const tab = event.queryStringParameters && event.queryStringParameters.sheet;
      if (!ALLOWED_TABS.includes(tab)) {
        return { statusCode: 400, headers, body: JSON.stringify({ error: 'Unknown sheet: ' + tab }) };
      }
      await ensureTab(sheets, tab);
      const res = await sheets.spreadsheets.values.get({ spreadsheetId: SHEET_ID, range: `${tab}!A2:B` });
      const rows = res.data.values || [];
      const data = rows
        .map((r) => {
          try { return JSON.parse(r[1]); } catch (e) { return null; }
        })
        .filter(Boolean);
      return { statusCode: 200, headers, body: JSON.stringify({ data }) };
    }

    if (event.httpMethod === 'POST') {
      const body = JSON.parse(event.body || '{}');
      const tab = body.sheet;
      const data = Array.isArray(body.data) ? body.data : [];
      if (!ALLOWED_TABS.includes(tab)) {
        return { statusCode: 400, headers, body: JSON.stringify({ error: 'Unknown sheet: ' + tab }) };
      }
      await ensureTab(sheets, tab);

      // Full replace: clear existing rows below the header, then write the current array.
      await sheets.spreadsheets.values.clear({ spreadsheetId: SHEET_ID, range: `${tab}!A2:B` });

      if (data.length) {
        const values = data.map((item) => [String(item.id || ''), JSON.stringify(item)]);
        await sheets.spreadsheets.values.update({
          spreadsheetId: SHEET_ID,
          range: `${tab}!A2`,
          valueInputOption: 'RAW',
          requestBody: { values },
        });
      }
      return { statusCode: 200, headers, body: JSON.stringify({ ok: true, count: data.length }) };
    }

    return { statusCode: 405, headers, body: JSON.stringify({ error: 'Method not allowed' }) };
  } catch (err) {
    return { statusCode: 500, headers, body: JSON.stringify({ error: err.message }) };
  }
};
