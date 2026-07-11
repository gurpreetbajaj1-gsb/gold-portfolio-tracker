# Gold Portfolio Tracker (auto-refreshing)

A small self-hosted app that tracks your PNJ gold purchases in Vietnam and
auto-refreshes the current price, instead of you typing it in by hand.

## How it works

- **`server.js`** — an Express server that scrapes `webgia.com/gia-vang/pnj/`
  (a site that aggregates PNJ's gold price, the world spot gold price, and
  the Vietcombank USD/VND rate onto one server-rendered page) and exposes it
  as JSON at `GET /api/prices`. Results are cached for 5 minutes so the app
  doesn't hammer the source site.
- **`public/index.html`** — the same portfolio calculator you had in the
  Claude artifact, but it now calls `/api/prices` on load and on a "↻
  refresh" button, auto-filling the price fields. You can still edit any
  field by hand if you prefer.
- Purchases are saved in the browser's `localStorage` (this is a real
  hosted page, not a Claude artifact, so `localStorage` works fine here).

## Why scraping, not a clean API

There's no free official API for PNJ's specific gold price. Global spot
gold and USD/VND both have plenty of free API options, but the Vietnamese
domestic dealer price has to come from somewhere that publishes it, and
`webgia.com` was the most scrape-friendly source I found (server-rendered
HTML table, not JS-only like PNJ's own site). This is also the most fragile
part of the whole thing — if they change their page layout, the scraper
selectors in `scrapePrices()` in `server.js` will need updating. If it
breaks, the app falls back to serving the last known price with a clear
"stale" warning rather than failing silently.

## Run it locally

```bash
npm install
npm start
```

Then open `http://localhost:3000`.

## Deploy it (so you can open it from anywhere)

Any Node-friendly host works. Two easy free-tier options:

### Option A: Render
1. Push this folder to a GitHub repo.
2. On [render.com](https://render.com), create a new **Web Service**, point
   it at your repo.
3. Build command: `npm install`. Start command: `npm start`.
4. Deploy — Render gives you a public URL.

### Option B: Railway
1. Push to GitHub.
2. On [railway.app](https://railway.app), "New Project" → "Deploy from
   GitHub repo".
3. It auto-detects Node and runs `npm start`. Done.

Both have generous free tiers for a low-traffic personal tool like this.

## If you want to hand this to Claude Code

This project is intentionally small and self-contained so Claude Code (or
any coding agent) can pick it up and:
- fix the scraper if `webgia.com`'s markup changes
- add a scheduled job (e.g. `node-cron`) to pre-fetch prices every N minutes
  instead of fetching on-request
- swap in a second/third source for redundancy (e.g. fall back to a
  different gold-price site if the primary scrape fails)
- deploy it for you if you give it hosting credentials

Just point it at this folder and describe what you want changed.

## Known limitations

- Scraping any site is inherently fragile — treat this as a working
  starting point, not a permanent solution.
- Please keep the 5-minute cache (or increase it) rather than fetching on
  every page load — `webgia.com` is a free public site and hammering it is
  a good way to get blocked.
- No authentication — anyone with the URL can view/edit the portfolio
  stored in their own browser's local storage (data isn't shared between
  devices/browsers).
