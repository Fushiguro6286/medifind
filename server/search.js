/**
 * Search service.
 *
 * Reads the cache first. The 12-hourly refresh keeps TRACKED_QUERIES warm, so those
 * searches answer instantly from SQLite. Anything else falls through to a live scrape,
 * which is then cached like any other result.
 */
import { db, ensureFts, logSearch, normalise } from './db.js';
import { config } from './config.js';
import { ACTIVE_COMPANIES, COMPANIES, getCompany } from './companies.js';
import { buildOffers, summarise, explain } from './llm/rank.js';
import { isValidPincode, resolvePincode } from './pincode.js';
import { TRACKED_QUERIES } from './catalog.js';
import { refreshCompany } from './scrape/runner.js';

const CACHE_TTL_MS = config.cacheTtlMinutes * 60_000;

const ftsSafe = q => q.replace(/["*(){}\[\]:^~-]/g, ' ').split(/\s+/).filter(Boolean);

/** Words that carry no product identity, so they must not qualify a row as relevant. */
const STOPWORDS = new Set([
  'for', 'and', 'the', 'with', 'best', 'buy', 'online', 'price', 'pack', 'set', 'kit',
  'home', 'use', 'new', 'top', 'all', 'mg', 'ml', 'gm',
]);

const contentTokens = query => [...new Set(
  String(query).toLowerCase().split(/[^a-z0-9]+/).filter(t => t.length >= 3 && !STOPWORDS.has(t))
)];

/**
 * Drop rows the search page padded in around the actual match.
 *
 * A retailer's results page is not a filtered list: searching "pulse oximeter" on a
 * quick-commerce app also returns lancets, thermometers and whatever else it wants to
 * upsell. Storing all of it is right - it is what the page showed - but answering with it
 * is not. A row is relevant only if it carries at least one distinctive query token.
 */
function filterRelevant(rows, query) {
  const tokens = contentTokens(query);
  if (!tokens.length) return rows;

  const scored = rows.map(row => {
    const name = String(row.name ?? '').toLowerCase();
    const hits = tokens.filter(t => name.includes(t)).length;
    return { row, hits };
  });

  // Prefer rows matching every token; fall back to any match before giving up.
  const full = scored.filter(s => s.hits === tokens.length);
  if (full.length) return full.map(s => s.row);
  const partial = scored.filter(s => s.hits > 0);
  if (partial.length) return partial.map(s => s.row);
  return [];
}

/** Rows for a query, matched exactly first, then by full-text relevance. */
export function findRows(query, { limit = 200, maxAgeMs = CACHE_TTL_MS } = {}) {
  const norm = normalise(query);
  const floor = Date.now() - maxAgeMs;

  const exact = db.prepare(
    'SELECT * FROM products WHERE query = ? AND scraped_at >= ? ORDER BY price ASC LIMIT ?'
  ).all(query, floor, limit);
  // Rows stored under this query still include whatever the retailer padded its results
  // page with, so the relevance filter applies here too.
  const relevant = filterRelevant(exact, query);
  if (relevant.length) return { rows: relevant, matchedBy: 'query' };

  const byName = db.prepare(
    'SELECT * FROM products WHERE norm_name LIKE ? AND scraped_at >= ? ORDER BY price ASC LIMIT ?'
  ).all(`%${norm}%`, floor, limit);
  if (byName.length) return { rows: byName, matchedBy: 'name' };

  const tokens = ftsSafe(query);
  if (tokens.length) {
    ensureFts();
    try {
      const rows = db.prepare(
        `SELECT p.* FROM product_fts f JOIN products p ON p.id = f.rowid
         WHERE product_fts MATCH ? AND p.scraped_at >= ?
         ORDER BY p.price ASC LIMIT ?`
      ).all(tokens.join(' OR '), floor, limit);
      if (rows.length) return { rows, matchedBy: 'fulltext' };
    } catch { /* malformed match expression */ }
  }
  return { rows: [], matchedBy: 'none' };
}

const freshness = rows => {
  if (!rows.length) return null;
  const newest = Math.max(...rows.map(r => r.scraped_at ?? 0));
  return { scrapedAt: newest, ageMinutes: Math.round((Date.now() - newest) / 60_000) };
};

/**
 * Scrape a query live, across every company, when the cache cannot answer it.
 * Bounded concurrency keeps a cold search from opening twelve browsers at once.
 */
export async function scrapeLive(query, { pincode, companies = ACTIVE_COMPANIES, onProgress } = {}) {
  const queue = [...companies];
  const done = [];
  const workers = Array.from({ length: Math.min(config.brightData.maxConcurrent, queue.length) }, async () => {
    while (queue.length) {
      const company = queue.shift();
      try {
        const result = await refreshCompany(company, { queries: [query], pincode, allowHeal: false });
        done.push(result);
        onProgress?.(result);
      } catch (err) {
        done.push({ slug: company.slug, status: 'error', error: err.message });
      }
    }
  });
  await Promise.all(workers);
  return done;
}

/**
 * Full search: cache lookup, optional live scrape, ranking, and an LLM explanation.
 *
 * @param {object} opts
 * @param {'price'|'speed'|'balanced'} opts.intent
 * @param {boolean} opts.allowLive  scrape when the cache misses
 */
export async function search({ query, pincode, intent = 'balanced', allowLive = true, limit = 60 }) {
  const q = String(query ?? '').trim();
  if (!q) return { error: 'Enter a product name.' };
  if (!isValidPincode(pincode)) return { error: 'Enter a valid 6-digit Indian pincode.' };

  logSearch(q, pincode, intent);
  const place = resolvePincode(pincode);

  let { rows, matchedBy } = findRows(q, { limit: limit * 4 });
  let liveScrape = null;

  if (!rows.length && allowLive) {
    liveScrape = await scrapeLive(q, { pincode });
    ({ rows, matchedBy } = findRows(q, { limit: limit * 4 }));
  }

  if (!rows.length) {
    return {
      query: q, place, intent, offers: [], unavailable: [], summary: null,
      analysis: {
        verdict: `Nothing found for "${q}".`,
        why: liveScrape
          ? 'A live scrape across all twelve platforms returned no matching product. The name may be misspelled, or the item may not be sold online in India.'
          : 'No cached results. Try one of the suggested product names.',
        watchOuts: [], savingsNote: '', source: 'rules',
      },
      meta: { matchedBy, cached: false, liveScrape: liveScrape?.length ?? 0 },
    };
  }

  const built = buildOffers(rows, { pincode, intent });
  const trimmed = { ...built, offers: built.offers.slice(0, limit) };
  const summary = summarise(trimmed);
  const analysis = await explain({ query: q, summary, offers: trimmed.offers, intent, place });

  return {
    query: q,
    place,
    intent,
    offers: trimmed.offers,
    unavailable: built.unavailable.slice(0, 20),
    summary,
    analysis,
    meta: {
      matchedBy,
      cached: !liveScrape,
      liveScrape: liveScrape?.length ?? 0,
      freshness: freshness(rows),
      tracked: TRACKED_QUERIES.includes(q.toLowerCase()),
      companiesWithData: new Set(rows.map(r => r.company_slug)).size,
    },
  };
}

/** Per-company coverage for one query - drives the "who has it" strip in the UI. */
export function coverage(query) {
  const { rows } = findRows(query, { limit: 500 });
  const byCompany = new Map();
  for (const row of rows) {
    const entry = byCompany.get(row.company_slug) ?? { count: 0, minPrice: Infinity };
    entry.count++;
    if (row.price != null) entry.minPrice = Math.min(entry.minPrice, row.price);
    byCompany.set(row.company_slug, entry);
  }
  return COMPANIES.map(c => {
    const entry = byCompany.get(c.slug);
    return {
      slug: c.slug,
      name: c.name,
      accent: c.accent,
      hasData: Boolean(entry),
      count: entry?.count ?? 0,
      minPrice: entry && entry.minPrice !== Infinity ? entry.minPrice : null,
    };
  });
}

export { getCompany };
