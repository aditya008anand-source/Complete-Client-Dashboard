# Patient Care Dashboard

Client-facing live dashboard fetching data from 3 Google Sheets.

## Deploy to Vercel (3 steps)

### Option A — via GitHub (recommended)
1. Create a new GitHub repository
2. Upload `index.html` to the root of the repo
3. Go to [vercel.com/new](https://vercel.com/new) → import your GitHub repo → click **Deploy**
   (No build settings needed — Vercel auto-detects static HTML)

### Option B — direct upload to Vercel
1. Go to [vercel.com/new](https://vercel.com/new)
2. Drag-and-drop the folder containing `index.html`
3. Click **Deploy**

Live URL is ready in ~30 seconds.

## How it works

- Opens → fetches live CSV data from 3 Google Sheets → renders all modules
- Click **Refresh** (top right) to re-fetch without reloading the page
- All 5 filters (Date, Drug, State, Doctor, QR Type) update every module instantly

## Data sources

The dashboard pulls from these published Google Sheets CSVs (already embedded in `index.html`):

| Module | Source |
|---|---|
| Patient Distribution | GID 1310523268 |
| Welcome Kit / Logistics | GID 1879543153 |
| Expert Consultation | GID 419247046 |
| App Engagement | GID 975503331 (future-ready) |

**Important:** All sheets must remain "Published to web" in Google Sheets for the dashboard to fetch live data.

## Updating the data

Just update your Google Sheets — the dashboard picks up changes on next page load / refresh.

## Updating the code

Edit `index.html` directly. Key sections inside the `<script>` block:
- `SHEETS = {...}` — change sheet URLs here
- `STATE_CANON = {...}` — add state spelling variants
- `LOG_BUCKETS = {...}` — adjust logistics status bucketing
- `CITY_TO_STATE = {...}` — add new cities for Logistics state filter
