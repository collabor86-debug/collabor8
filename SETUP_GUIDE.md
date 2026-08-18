# COLLABOR8 — Netlify + Google Sheets Setup

## What changed in your app
- `index.html` now syncs 6 of your data tables to Google Sheets on every save: **cabins, occupants, payments, invoices, leads, quotations**.
- On page load, it pulls the latest data from Sheets and re-renders.
- `documents` (uploaded KYC files as base64) stays in the browser's local storage only — Google Sheets cells cap at 50,000 characters, so real PDFs/images won't reliably fit. Ask if you want this backed by Google Drive later.
- A new Netlify Function (`netlify/functions/sheet-store.js`) does the actual talking to Google's API. Your credentials live only on Netlify's servers, never in the browser.

---

## Step 1 — Create the Google Sheet
1. Go to [sheets.google.com](https://sheets.google.com) and create a new blank spreadsheet. Name it whatever you like (e.g. "COLLABOR8 Data").
2. Copy its **Sheet ID** from the URL:
   `https://docs.google.com/spreadsheets/d/`**`THIS_LONG_ID`**`/edit`
3. You don't need to create tabs yourself — the app creates `cabins`, `occupants`, `payments`, `invoices`, `leads`, `quotations` tabs automatically the first time it syncs.

## Step 2 — Create a Google Cloud service account
1. Go to [console.cloud.google.com](https://console.cloud.google.com) and create a new project (or use an existing one).
2. In the search bar, go to **APIs & Services → Library**, search "Google Sheets API", and click **Enable**.
3. Go to **APIs & Services → Credentials → Create Credentials → Service Account**. Give it any name (e.g. `collabor8-sheets`) and click through to finish.
4. Open the service account you just created → **Keys** tab → **Add Key → Create new key → JSON**. This downloads a `.json` file — keep it safe, don't commit it anywhere.
5. Open that JSON file. You need two values from it:
   - `client_email` (looks like `collabor8-sheets@your-project.iam.gserviceaccount.com`)
   - `private_key` (a long string starting with `-----BEGIN PRIVATE KEY-----`)

## Step 3 — Share the Sheet with the service account
1. Open your Google Sheet → **Share**.
2. Paste the service account's `client_email` and give it **Editor** access.
3. Uncheck "Notify people" and click Share.

## Step 4 — Push this project to GitHub
```bash
cd collabor8
git init
git add .
git commit -m "Initial commit"
git branch -M main
git remote add origin https://github.com/YOUR_USERNAME/collabor8.git
git push -u origin main
```

## Step 5 — Connect to Netlify
1. Go to [app.netlify.com](https://app.netlify.com) → **Add new site → Import an existing project** → connect GitHub → pick your repo.
2. Build settings: leave **Build command** blank, **Publish directory** as `.` (the defaults from `netlify.toml` should be picked up automatically).
3. Before deploying, go to **Site settings → Environment variables** and add:
   | Key | Value |
   |---|---|
   | `GOOGLE_SERVICE_ACCOUNT_EMAIL` | the `client_email` from your JSON key |
   | `GOOGLE_PRIVATE_KEY` | the `private_key` from your JSON key, **including** the `-----BEGIN PRIVATE KEY-----` / `-----END PRIVATE KEY-----` lines |
   | `GOOGLE_SHEET_ID` | the Sheet ID from Step 1 |
4. Deploy the site.

## Step 6 — Test it
1. Open your live Netlify URL and log in.
2. Add or edit an occupant, payment, invoice, lead, or quotation.
3. Open your Google Sheet — a matching tab should appear (or update) with a row per record within a couple of seconds.
4. Open the site in a different browser/incognito window and confirm the same data shows up — that confirms Sheets is now the shared source of truth, not just your browser's local storage.

---

## Local testing before you deploy (optional but recommended)
```bash
npm install -g netlify-cli
cd collabor8
npm install
netlify link            # or: netlify init, if you haven't connected the site yet
netlify dev
```
This runs the Netlify Functions locally (pulling env vars from your linked site or a local `.env` file) so you can catch issues before pushing live.

## Troubleshooting
- **Nothing syncs / console shows "sync failed"**: double-check the three environment variables are set exactly, and that the Sheet is shared with the service account email as Editor.
- **`GOOGLE_PRIVATE_KEY` errors**: make sure you pasted the full key including header/footer lines. Netlify's environment variable field handles the newlines fine as long as you paste the whole block.
- **A tab has a header row but no data**: that's expected the first time — headers (`id`, `json`) are added automatically when a tab is created; rows appear after your first save.
