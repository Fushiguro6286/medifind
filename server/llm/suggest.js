/**
 * Type-ahead, Google-style: suggestions from the first keystroke.
 *
 * Three sources merged and ranked:
 *   1. the curated catalogue (available before any scrape has run),
 *   2. real scraped product titles via FTS5 prefix match,
 *   3. what other people actually searched for.
 *
 * This is called on every keystroke, so it is pure SQLite and in-memory work - no model
 * call on the hot path. The LLM only gets involved for the "did you mean" repair below,
 * which the client requests separately once typing pauses.
 */
import { db, ensureFts, normalise } from '../db.js';
import { SEED_TERMS, CATEGORIES } from '../catalog.js';
import { chatJson, isAvailable } from './ollama.js';

/** FTS5 chokes on user punctuation; keep only what the tokeniser understands. */
const ftsSafe = q => q.replace(/["*(){}\[\]:^~-]/g, ' ').split(/\s+/).filter(Boolean);

function seedMatches(query, limit) {
  const q = query.toLowerCase().trim();
  const scored = [];
  for (const term of SEED_TERMS) {
    let score = 0;
    if (term.norm.startsWith(q)) score = 100 - term.norm.length * 0.1;          // prefix on the whole name
    else if (term.tokens.some(t => t.startsWith(q))) score = 80 - term.norm.length * 0.1; // prefix on a word
    else if (term.norm.includes(q)) score = 55;                                  // substring anywhere
    if (score > 0) scored.push({ ...term, score });
  }
  return scored
    .sort((a, b) => b.score - a.score)
    .slice(0, limit)
    .map(t => ({
      display: t.display,
      query: t.q,
      category: t.category,
      categoryLabel: CATEGORIES[t.category] ?? null,
      source: 'catalog',
    }));
}

function scrapedMatches(query, limit) {
  const tokens = ftsSafe(query);
  if (!tokens.length) return [];
  ensureFts();
  // Prefix-match the last token, require the earlier ones - mirrors how search boxes behave.
  const expression = tokens.map((t, i) => (i === tokens.length - 1 ? `${t}*` : t)).join(' AND ');
  let rows = [];
  try {
    rows = db.prepare(
      `SELECT p.name, p.category, MIN(p.price) AS min_price, COUNT(DISTINCT p.company_slug) AS companies
       FROM product_fts f JOIN products p ON p.id = f.rowid
       WHERE product_fts MATCH ?
       GROUP BY LOWER(p.name)
       ORDER BY companies DESC, min_price ASC
       LIMIT ?`
    ).all(expression, limit);
  } catch {
    return [];
  }
  return rows.map(r => ({
    display: r.name,
    query: r.name,
    category: r.category ?? null,
    categoryLabel: CATEGORIES[r.category] ?? null,
    minPrice: r.min_price ?? null,
    companies: r.companies ?? 0,
    source: 'scraped',
  }));
}

function popularMatches(query, limit) {
  const rows = db.prepare(
    `SELECT query, COUNT(*) AS hits FROM search_log
     WHERE query LIKE ? GROUP BY LOWER(query) ORDER BY hits DESC LIMIT ?`
  ).all(`${query}%`, limit);
  return rows.map(r => ({ display: r.query, query: r.query, source: 'popular', hits: r.hits }));
}

export function suggest(query, { limit = 10 } = {}) {
  const q = String(query ?? '').trim();
  if (q.length < 1) {
    // Empty box: show what the refresh actually has data for.
    return seedMatches('', 0).length ? [] : SEED_TERMS.slice(0, limit).map(t => ({
      display: t.display, query: t.q, category: t.category,
      categoryLabel: CATEGORIES[t.category] ?? null, source: 'catalog',
    }));
  }

  const pool = [
    ...seedMatches(q, limit),
    ...scrapedMatches(q, limit),
    ...popularMatches(q, 3),
  ];

  /**
   * Rank the merged pool rather than concatenating the sources. A scraped title is a real
   * buyable product, but "Digital Thermometer" must still beat "BPL Medical Technologies
   * Accudigit DT04 Digital Thermometer With Quick Measurement of..." for the query "dig".
   * Prefix position and brevity decide that; source only breaks ties.
   */
  const needle = q.toLowerCase();
  const score = item => {
    const display = item.display.toLowerCase();
    const at = display.indexOf(needle);
    let value = 0;
    if (display.startsWith(needle)) value += 60;
    else if (new RegExp(`\\b${needle.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}`).test(display)) value += 40;
    else if (at !== -1) value += 18;
    value -= Math.min(24, display.length / 6);          // long titles read as noise
    if (item.source === 'scraped') value += 8;          // real, in-stock listings
    if (item.source === 'popular') value += 4;
    if (item.companies > 1) value += Math.min(6, item.companies);
    return value;
  };

  const seen = new Set();
  const merged = [];
  for (const item of pool.sort((a, b) => score(b) - score(a))) {
    const key = normalise(item.display);
    if (!key || seen.has(key)) continue;
    seen.add(key);
    merged.push(item);
  }
  return merged.slice(0, limit);
}

/**
 * Spelling repair for medicine names, which are easy to mistype ("paracetmol").
 * Only consulted when the prefix search found nothing, and only if Ollama is up.
 */
export async function repair(query) {
  const q = String(query ?? '').trim();
  if (q.length < 4 || !(await isAvailable())) return null;

  const result = await chatJson([
    {
      role: 'system',
      content:
        'You correct misspelled Indian healthcare product searches (medicines, home medical ' +
        'devices, healthcare supplies). Reply as JSON {"corrected": string|null, "confident": boolean}. ' +
        'Set corrected to null if the input is already correct or you cannot tell.',
    },
    { role: 'user', content: q },
  ], { temperature: 0.1, timeoutMs: 8000 });

  const corrected = result?.corrected ? String(result.corrected).trim() : null;
  if (!corrected || normalise(corrected) === normalise(q)) return null;
  return { corrected, confident: Boolean(result.confident) };
}
