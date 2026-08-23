/**
 * Scraper Studio collector lifecycle.
 *
 * Most of the twelve targets are single-page apps that gate their catalogue behind a
 * delivery-location prompt, so a plain HTTP fetch returns an empty shell. Studio builds
 * an AI-generated collector that drives a real browser, and - crucially - can repair
 * itself when the site changes. Collector IDs live in data/collectors.json.
 *
 *   npm run studio:bootstrap            build collectors for every company missing one
 *   npm run studio:bootstrap -- zepto   build one
 *   npm run studio:heal -- zepto "price is null"
 */
import fs from 'node:fs';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import { DATA_DIR } from '../config.js';
import { ACTIVE_COMPANIES, getCompany } from '../companies.js';
import { studioCreate, studioHeal, studioRun } from '../brightdata.js';
import { setCollectorId, recordHeal } from '../db.js';

const REGISTRY = path.join(DATA_DIR, 'collectors.json');

export function loadCollectors() {
  try { return JSON.parse(fs.readFileSync(REGISTRY, 'utf8')); } catch { return {}; }
}

export function saveCollector(slug, record) {
  const all = loadCollectors();
  all[slug] = { ...all[slug], ...record, updatedAt: new Date().toISOString() };
  fs.writeFileSync(REGISTRY, JSON.stringify(all, null, 2));
  if (record.collectorId) setCollectorId(slug, record.collectorId);
  return all[slug];
}

export const collectorFor = slug => loadCollectors()[slug]?.collectorId ?? null;

/**
 * The description drives the AI build. It has to name every field the ranker needs and
 * tell the agent to dismiss the location interstitial, or the collector returns [].
 */
function describe(company) {
  const locationStep = company.kind === 'quick_commerce'
    ? 'The site asks for a delivery location first: dismiss or accept any location prompt, entering pincode 110001 if required, then read the search results. '
    : 'Dismiss any location, cookie or login popup before reading results. ';
  return (
    `${locationStep}For each product card in the search results extract: product_name, brand, ` +
    'price_inr as a number, mrp_inr as a number, discount_percent, rating out of 5, review_count, ' +
    'product_url as an absolute link, image_url, pack_size, in_stock boolean, ' +
    'prescription_required boolean. Return one row per product, up to 40 rows.'
  ).slice(0, 500);
}

export async function bootstrapOne(company, { force = false } = {}) {
  const existing = collectorFor(company.slug);
  if (existing && !force) {
    console.log(`- ${company.name}: already has ${existing}`);
    return { slug: company.slug, collectorId: existing, skipped: true };
  }
  const url = company.searchUrl('digital thermometer');
  console.log(`+ ${company.name}: building collector (5-10 min)...`);
  const started = Date.now();
  try {
    const result = await studioCreate(url, describe(company), `medifind-${company.slug}`);
    const collectorId = result.collector_id ?? result.collectorId;
    if (!collectorId) throw new Error(`no collector_id in response: ${JSON.stringify(result).slice(0, 200)}`);
    saveCollector(company.slug, { collectorId, name: result.name, status: result.status, viewUrl: result.view_url, seedUrl: url });
    console.log(`  ${company.name}: ${collectorId} in ${Math.round((Date.now() - started) / 1000)}s`);
    return { slug: company.slug, collectorId };
  } catch (err) {
    console.error(`  ${company.name}: FAILED - ${err.message.slice(0, 200)}`);
    saveCollector(company.slug, { error: err.message.slice(0, 300), status: 'failed' });
    return { slug: company.slug, error: err.message };
  }
}

/** Ask Studio's AI to repair a collector, then verify the repair actually returns rows. */
export async function healOne(company, reason, { verifyQuery = 'digital thermometer' } = {}) {
  const collectorId = collectorFor(company.slug);
  if (!collectorId) return { slug: company.slug, healed: false, error: 'no collector to heal' };

  const url = company.searchUrl(verifyQuery);
  const prompt = (
    `The scraper returned no usable rows. Symptom: ${reason}. ` +
    'Re-locate the product cards on the search results page and capture product_name, price_inr, ' +
    'mrp_inr, rating, review_count and an absolute product_url again. ' +
    'If a delivery-location or cookie popup blocks the results, dismiss it first (use pincode 110001).'
  ).slice(0, 1000);

  console.log(`~ ${company.name}: healing ${collectorId} (${reason.slice(0, 60)})`);
  try {
    const result = await studioHeal(collectorId, prompt, { url, autoApprove: true, autoSave: true });
    recordHeal(company.slug);
    saveCollector(company.slug, { lastHeal: new Date().toISOString(), lastHealReason: reason.slice(0, 200), healStatus: result.status });

    // A heal that reports success but still yields nothing is not a heal.
    let verified = 0;
    try {
      const rows = await studioRun(collectorId, url, { timeoutSec: 420 });
      verified = Array.isArray(rows) ? rows.length : Array.isArray(rows?.data) ? rows.data.length : 0;
    } catch { /* verification is best-effort */ }

    console.log(`  ${company.name}: heal ${result.status ?? 'done'}, verify returned ${verified} rows`);
    return { slug: company.slug, healed: true, status: result.status, verified };
  } catch (err) {
    console.error(`  ${company.name}: heal failed - ${err.message.slice(0, 200)}`);
    return { slug: company.slug, healed: false, error: err.message };
  }
}

/* ------------------------------------------------------------------- CLI */

// pathToFileURL, not string concatenation: on Windows the real value is
// file:///C:/... (three slashes) and a hand-built file://C:/... never matches.
if (process.argv[1] && pathToFileURL(process.argv[1]).href === import.meta.url) {
  const [command, ...rest] = process.argv.slice(2);
  const force = rest.includes('--force');
  const names = rest.filter(a => !a.startsWith('-'));

  if (command === 'bootstrap') {
    const list = names.length ? names.map(getCompany).filter(Boolean) : ACTIVE_COMPANIES;
    console.log(`Bootstrapping ${list.length} Scraper Studio collectors...\n`);
    // Studio caps concurrent AI-Flow jobs; two at a time keeps us under it.
    const queue = [...list];
    const workers = Array.from({ length: 2 }, async () => {
      while (queue.length) await bootstrapOne(queue.shift(), { force });
    });
    await Promise.all(workers);
    console.log('\nCollectors:', JSON.stringify(loadCollectors(), null, 2));
  } else if (command === 'heal') {
    const company = getCompany(names[0]);
    if (!company) { console.error('Unknown company:', names[0]); process.exit(1); }
    console.log(await healOne(company, names.slice(1).join(' ') || 'manual heal request'));
  } else {
    console.log('Usage: studio.js bootstrap [slug...] [--force] | studio.js heal <slug> [reason]');
  }
}
