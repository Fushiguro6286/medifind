/**
 * Refresh orchestrator.
 *
 * For each company it tries the cheapest strategy that can work, validates the result,
 * and - when a company comes back empty - hands the failure to Scraper Studio's AI
 * healer before retrying. Every successful refresh writes a per-company JSON snapshot
 * to data/companies/<slug>.json and replaces that company's rows in SQLite.
 *
 *   npm run refresh                  refresh every company across the tracked catalogue
 *   npm run refresh:one -- amazon    refresh one company
 */
import fs from 'node:fs';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import { COMPANY_DIR, config } from '../config.js';
import { ACTIVE_COMPANIES, getCompany } from '../companies.js';
import { unlock } from '../brightdata.js';
import { studioRun } from '../brightdata.js';
import { extractProducts } from './extract.js';
import { renderSearchPage } from './browser.js';
import { collectorFor, healOne } from './studio.js';
import { replaceProducts, setCompanyStatus, startRun, finishRun, ensureFts } from '../db.js';
import { TRACKED_QUERIES } from '../catalog.js';

/** Map a Studio collector row (snake_case, AI-named) onto our internal shape. */
function normaliseStudioRow(row) {
  const num = v => {
    const n = typeof v === 'number' ? v : parseFloat(String(v ?? '').replace(/[^\d.]/g, ''));
    return Number.isFinite(n) ? n : null;
  };
  const name = row.product_name ?? row.name ?? row.title;
  if (!name) return null;
  const price = num(row.price_inr ?? row.price ?? row.selling_price);
  if (price == null) return null;
  return {
    name: String(name).trim(),
    brand: row.brand ?? null,
    price,
    mrp: num(row.mrp_inr ?? row.mrp),
    discount: num(row.discount_percent),
    rating: num(row.rating),
    reviews: num(row.review_count ?? row.reviews),
    url: row.product_url ?? row.url ?? null,
    image: row.image_url ?? row.image ?? null,
    pack: row.pack_size ?? null,
    inStock: row.in_stock !== false,
    rxRequired: Boolean(row.prescription_required),
  };
}

const asArray = result =>
  Array.isArray(result) ? result
    : Array.isArray(result?.data) ? result.data
      : Array.isArray(result?.rows) ? result.rows : [];

/* --------------------------------------------------------------- strategies */

async function viaStudio(company, query) {
  const collectorId = collectorFor(company.slug);
  if (!collectorId) return null;
  const raw = await studioRun(collectorId, company.searchUrl(query), { timeoutSec: 420 });
  const rows = asArray(raw).map(normaliseStudioRow).filter(Boolean);
  return { rows, strategy: 'studio', detail: collectorId };
}

async function viaUnlocker(company, query) {
  const url = company.searchUrl(query);
  const html = await unlock(url, { format: 'html' });
  const { rows, tiers } = extractProducts({ body: html, format: 'html', baseUrl: url });
  return { rows, strategy: 'unlocker', detail: tiers.join(',') };
}

async function viaBrowser(company, query, pincode) {
  const { html, url, priceHits, locationSet } = await renderSearchPage(company, query, { pincode });
  const { rows, tiers } = extractProducts({ body: html, format: 'html', baseUrl: url });
  return { rows, strategy: 'browser', detail: `prices=${priceHits} location=${locationSet} ${tiers.join(',')}` };
}

/**
 * Strategy order, cheapest-that-works first.
 *
 * Marketplaces are server-rendered, so one Unlocker call is enough. Everything else is an
 * SPA behind a location gate and needs a real browser; the Browser API answers in ~25s
 * against a Studio collector's several minutes, so it leads and the collector backs it up.
 *
 * `browserRestricted` companies are the ones Bright Data blocks on the browser zone per
 * the site's own robots.txt. Trying them anyway costs ~90s of timeout per query and can
 * never succeed, so the browser rung is dropped rather than retried into a self-heal.
 */
function strategiesFor(company) {
  const studio = collectorFor(company.slug) ? [viaStudio] : [];
  const browser = company.browserRestricted ? [] : [viaBrowser];
  return company.kind === 'marketplace'
    ? [viaUnlocker, ...browser, ...studio]
    : [...browser, ...studio, viaUnlocker];
}

/** A refresh is healthy only if it produced rows that actually carry prices. */
function assess(rows) {
  const priced = rows.filter(r => r.price != null && r.price > 0);
  return {
    ok: priced.length >= config.refresh.healthyRowThreshold,
    priced: priced.length,
    total: rows.length,
    withUrl: priced.filter(r => r.url).length,
  };
}

/* ------------------------------------------------------------------ refresh */

export async function refreshCompany(company, {
  queries = TRACKED_QUERIES,
  pincode = '110001',
  allowHeal = config.refresh.autoHeal,
} = {}) {
  // A retired target has no working storefront to scrape. Record the reason once and
  // return - it must not consume a run row, a Bright Data call, or a heal.
  if (company.retired) {
    setCompanyStatus(company.slug, 'retired', 0, company.retired);
    return { slug: company.slug, name: company.name, status: 'retired', rows: 0, healed: false, strategy: null, ms: 0 };
  }

  const runId = startRun(company.slug);
  const started = Date.now();
  const snapshot = { company: company.slug, name: company.name, refreshedAt: null, queries: {} };
  let totalRows = 0;
  let healed = false;
  let lastStrategy = null;
  const failures = [];

  for (const query of queries) {
    let captured = null;
    for (const strategy of strategiesFor(company)) {
      try {
        const attempt = await strategy(company, query, pincode);
        if (!attempt) continue;
        const health = assess(attempt.rows);
        lastStrategy = attempt.strategy;
        if (health.ok) { captured = { ...attempt, health }; break; }
        failures.push(`${query}/${attempt.strategy}: 0 priced rows (${attempt.detail ?? ''})`);
      } catch (err) {
        failures.push(`${query}/${strategy.name}: ${err.message.slice(0, 120)}`);
      }
    }

    // Nothing worked. Let Studio's AI repair the collector, then try it once more.
    if (!captured && allowHeal && !company.browserRestricted && collectorFor(company.slug)) {
      const reason = failures.slice(-2).join(' | ') || 'all strategies returned zero rows';
      const heal = await healOne(company, reason, { verifyQuery: query }).catch(() => null);
      if (heal?.healed) {
        healed = true;
        try {
          const retry = await viaStudio(company, query);
          if (retry && assess(retry.rows).ok) captured = { ...retry, health: assess(retry.rows) };
        } catch (err) { failures.push(`retry-after-heal: ${err.message.slice(0, 120)}`); }
      }
    }

    if (captured) {
      replaceProducts(company.slug, query, captured.rows, captured.strategy);
      snapshot.queries[query] = {
        strategy: captured.strategy,
        detail: captured.detail,
        rowCount: captured.rows.length,
        products: captured.rows,
      };
      totalRows += captured.rows.length;
    } else {
      snapshot.queries[query] = { strategy: lastStrategy, rowCount: 0, products: [], error: failures.at(-1) ?? 'no rows' };
    }
  }

  snapshot.refreshedAt = new Date().toISOString();
  snapshot.totalRows = totalRows;
  snapshot.healed = healed;
  snapshot.strategy = lastStrategy;
  if (failures.length) snapshot.failures = failures.slice(0, 12);

  // The JSON snapshot is the cache the UI and the LLM read; it is rewritten
  // only after a refresh (including any self-heal) has finished.
  fs.writeFileSync(path.join(COMPANY_DIR, `${company.slug}.json`), JSON.stringify(snapshot, null, 2));

  const status = totalRows > 0 ? (healed ? 'healed' : 'ok') : 'failed';
  setCompanyStatus(company.slug, status, totalRows, failures.slice(0, 3).join(' | ') || null);
  finishRun(runId, {
    status, rowCount: totalRows, healed, strategy: lastStrategy,
    error: failures.slice(0, 3).join(' | ') || null,
  });

  return { slug: company.slug, name: company.name, status, rows: totalRows, healed, strategy: lastStrategy, ms: Date.now() - started };
}

export async function refreshAll({ queries = TRACKED_QUERIES, pincode = '110001', only = null } = {}) {
  const list = only?.length ? only.map(getCompany).filter(Boolean) : ACTIVE_COMPANIES;
  const started = Date.now();
  console.log(`Refreshing ${list.length} companies x ${queries.length} queries...\n`);

  const results = [];
  const queue = [...list];
  const workers = Array.from({ length: config.brightData.maxConcurrent }, async () => {
    while (queue.length) {
      const company = queue.shift();
      try {
        const r = await refreshCompany(company, { queries, pincode });
        results.push(r);
        console.log(`${r.status.toUpperCase().padEnd(7)} ${r.name.padEnd(20)} ${String(r.rows).padStart(4)} rows via ${r.strategy ?? '-'}${r.healed ? ' (healed)' : ''} ${Math.round(r.ms / 1000)}s`);
      } catch (err) {
        results.push({ slug: company.slug, status: 'error', error: err.message });
        console.error(`ERROR   ${company.name}: ${err.message.slice(0, 140)}`);
      }
    }
  });
  await Promise.all(workers);

  ensureFts();
  const ok = results.filter(r => r.status === 'ok' || r.status === 'healed').length;
  const summary = {
    finishedAt: new Date().toISOString(),
    durationMs: Date.now() - started,
    companies: results.length,
    healthy: ok,
    healed: results.filter(r => r.healed).length,
    totalRows: results.reduce((sum, r) => sum + (r.rows ?? 0), 0),
    results,
  };
  fs.writeFileSync(path.join(COMPANY_DIR, '_summary.json'), JSON.stringify(summary, null, 2));
  console.log(`\n${ok}/${results.length} healthy, ${summary.totalRows} rows, ${Math.round(summary.durationMs / 1000)}s`);
  return summary;
}

/* ---------------------------------------------------------------------- CLI */

if (process.argv[1] && pathToFileURL(process.argv[1]).href === import.meta.url) {
  // Walk the argv rather than filtering it: a flag's value is a positional-looking token
  // and must not be mistaken for a company slug (`--query "digital thermometer"`).
  const args = process.argv.slice(2);
  const only = [];
  let queries = TRACKED_QUERIES;

  for (let i = 0; i < args.length; i++) {
    const arg = args[i];
    if (arg === '--query') { queries = [args[++i]].filter(Boolean); continue; }
    if (arg === '--company') continue;               // slugs follow as positionals
    if (arg === '--all') continue;
    if (arg.startsWith('-')) continue;
    only.push(arg);
  }

  await refreshAll({ only: only.length ? only : null, queries });
  process.exit(0);
}
