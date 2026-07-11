// Gold Portfolio Tracker — backend
//
// Scrapes PNJ gold price (per chỉ), world spot gold price (XAU/USD), and the
// Vietcombank USD/VND rate from a single public page, caches the result for
// a few minutes, and serves it as JSON to the frontend.
//
// Why scraping instead of a clean API: there is no official free API for
// PNJ's specific gold price. webgia.com aggregates it into one server-
// rendered page, which is far more reliable to parse than PNJ's own
// JS-rendered site. If webgia.com changes its markup, only the selectors in
// scrapePrices() below need updating — everything else stays the same.

const express = require('express');
const cors = require('cors');
const cheerio = require('cheerio');
const fetch = require('node-fetch');

const app = express();
const PORT = process.env.PORT || 3000;

const SOURCE_URL = 'https://webgia.com/gia-vang/pnj/';
const FALLBACK_URL = 'https://giavang.org/';
const CACHE_TTL_MS = 5 * 60 * 1000; // 5 minutes — be a polite scraper
const REQUEST_HEADERS = {
  // A normal browser UA is polite and avoids naive bot-blocking.
  'User-Agent':
    'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0 Safari/537.36'
};

let cache = {
  data: null,
  fetchedAt: 0
};

function parseVndNumber(text) {
  // Vietnamese formatting: "." is a thousands separator, "," is decimal.
  // "14.400.000" -> 14400000
  // "26.131,00" -> 26131
  if (!text) return null;
  const cleaned = text.replace(/[^\d.,]/g, '');
  if (!cleaned) return null;
  if (cleaned.includes(',')) {
    return parseFloat(cleaned.replace(/\./g, '').replace(',', '.'));
  }
  return parseInt(cleaned.replace(/\./g, ''), 10);
}

function parseUsdNumber(text) {
  // "$4,025.36" -> 4025.36
  if (!text) return null;
  const cleaned = text.replace(/[^\d.]/g, '');
  return cleaned ? parseFloat(cleaned) : null;
}

async function scrapePrimary() {
  const res = await fetch(SOURCE_URL, {
    headers: REQUEST_HEADERS,
    timeout: 15000
  });

  if (!res.ok) {
    throw new Error(`Source site responded with ${res.status}`);
  }

  const html = await res.text();
  const $ = cheerio.load(html);

  // --- PNJ gold price (TPHCM row, "PNJ" type, per chỉ) ---
  // The price table has rows like:
  // TPHCM | PNJ | 14.400.000 | 14.700.000
  let pnjBuy = null;
  let pnjSell = null;

  $('table tr').each((_, row) => {
    const cells = $(row).find('td, th').map((__, td) => $(td).text().trim()).get();
    // Look for a row that mentions PNJ and has two VND-looking numbers
    const rowText = cells.join(' | ');
    if (/PNJ/i.test(rowText) && !pnjBuy) {
      const numeric = cells.filter((c) => /\d\.\d{3}\.\d{3}/.test(c));
      if (numeric.length >= 2) {
        pnjBuy = parseVndNumber(numeric[0]);
        pnjSell = parseVndNumber(numeric[1]);
      }
    }
  });

  // --- World spot gold price (XAU/USD) ---
  // The link to "gia-vang/the-gioi" lives in the table's header row, not the
  // data row, so we search the whole table body rather than closest('tr').
  let spotUsd = null;
  $('a[href*="gia-vang/the-gioi"]').each((_, el) => {
    if (spotUsd) return;
    const text = $(el).closest('table').find('tbody').text();
    const match = text.match(/\$[\d,]+\.\d+/);
    if (match) {
      spotUsd = parseUsdNumber(match[0]);
    }
  });

  // --- USD/VND (Vietcombank) ---
  let usdVndBuy = null;
  let usdVndSell = null;
  $('a[href*="/ngoai-te/usd/"]').each((_, el) => {
    const row = $(el).closest('tr');
    if (row.length && !usdVndBuy) {
      const cells = row.find('td').map((__, td) => $(td).text().trim()).get();
      const numeric = cells.filter((c) => /\d{2}[.,]\d{3}/.test(c));
      if (numeric.length >= 2) {
        usdVndBuy = parseVndNumber(numeric[0]);
        usdVndSell = parseVndNumber(numeric[1]);
      }
    }
  });

  if (!pnjBuy || !pnjSell) {
    throw new Error('Could not parse PNJ price from source page — markup may have changed, or the source has no live data right now.');
  }

  return {
    pnj: { buy: pnjBuy, sell: pnjSell, unit: 'VND per chỉ' },
    globalSpot: spotUsd ? { usdPerOz: spotUsd } : null,
    usdVnd: usdVndSell ? { buy: usdVndBuy, sell: usdVndSell } : null,
    source: SOURCE_URL,
    fetchedAt: new Date().toISOString()
  };
}

// webgia.com occasionally has an empty gold-price feed (seen in testing —
// their own site shows blank tables, not a scraping issue). giavang.org
// carries the same PNJ price as a nationwide comparison table, so we fall
// back to it for the PNJ price alone; it has no spot/forex tables of its own.
async function scrapeFallback() {
  const res = await fetch(FALLBACK_URL, {
    headers: REQUEST_HEADERS,
    timeout: 15000
  });

  if (!res.ok) {
    throw new Error(`Fallback source responded with ${res.status}`);
  }

  const html = await res.text();
  const $ = cheerio.load(html);

  // "Bảng so sánh giá Vàng Nhẫn 1 Chỉ" (#gia_vang_nhan) lists prices in
  // x1000đ/lượng even though it's a per-chỉ product; convert lượng -> chỉ (÷10).
  let pnjBuy = null;
  let pnjSell = null;

  $('#gia_vang_nhan').closest('section').find('table tr').each((_, row) => {
    if (pnjBuy) return;
    const cells = $(row).find('td, th').map((__, td) => $(td).text().trim()).get();
    if (/PNJ/i.test(cells.join(' | '))) {
      const numeric = cells.filter((c) => /^\d[\d.]*$/.test(c));
      if (numeric.length >= 2) {
        pnjBuy = Math.round((parseVndNumber(numeric[0]) * 1000) / 10);
        pnjSell = Math.round((parseVndNumber(numeric[1]) * 1000) / 10);
      }
    }
  });

  if (!pnjBuy || !pnjSell) {
    throw new Error('Could not parse PNJ price from fallback source either.');
  }

  return {
    pnj: { buy: pnjBuy, sell: pnjSell, unit: 'VND per chỉ' },
    globalSpot: null,
    usdVnd: null,
    source: FALLBACK_URL,
    fetchedAt: new Date().toISOString()
  };
}

async function scrapePrices() {
  try {
    return await scrapePrimary();
  } catch (primaryErr) {
    try {
      const fallback = await scrapeFallback();
      console.warn(`Primary source failed (${primaryErr.message}); used fallback ${FALLBACK_URL}`);
      return fallback;
    } catch (fallbackErr) {
      throw new Error(`Primary source failed: ${primaryErr.message} | Fallback also failed: ${fallbackErr.message}`);
    }
  }
}

app.use(cors());
app.use(express.static('public'));

app.get('/api/prices', async (req, res) => {
  const now = Date.now();
  const force = req.query.force === '1';

  if (!force && cache.data && now - cache.fetchedAt < CACHE_TTL_MS) {
    return res.json({ ...cache.data, cached: true });
  }

  try {
    const data = await scrapePrices();
    cache = { data, fetchedAt: now };
    res.json({ ...data, cached: false });
  } catch (err) {
    console.error('Scrape failed:', err.message);
    if (cache.data) {
      // Serve stale data rather than nothing, but flag it clearly.
      return res.status(200).json({ ...cache.data, cached: true, stale: true, error: err.message });
    }
    res.status(502).json({ error: 'Failed to fetch gold prices', details: err.message });
  }
});

app.listen(PORT, () => {
  console.log(`Gold portfolio tracker running on http://localhost:${PORT}`);
});
