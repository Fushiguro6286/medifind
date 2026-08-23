/**
 * Connectivity probe. Hits every company's search page through the Web Unlocker and
 * reports which extraction tier produced rows. Run it after adding a company or when
 * a refresh starts failing, to see whether the problem is the fetch or the parse.
 *
 *   npm run doctor              probe every company
 *   npm run doctor -- amazon    probe one
 */
import { COMPANIES } from './companies.js';
import { unlock } from './brightdata.js';
import { extractProducts } from './scrape/extract.js';

const PROBE_QUERY = process.env.PROBE_QUERY || 'digital thermometer';

async function probe(company) {
  const url = company.searchUrl(PROBE_QUERY);
  const started = Date.now();
  const result = { slug: company.slug, name: company.name, url };
  try {
    const html = await unlock(url, { format: 'html' });
    result.bytes = html.length;
    const { rows, tiers } = extractProducts({ body: html, format: 'html', baseUrl: url });
    result.rows = rows.length;
    result.tiers = tiers;
    result.sample = rows.slice(0, 2).map(r => `${r.name.slice(0, 50)} @ ${r.price}`);
    result.status = rows.length ? 'ok' : 'empty';
  } catch (err) {
    result.status = 'error';
    result.error = err.message;
  }
  result.ms = Date.now() - started;
  return result;
}

const targets = process.argv.slice(2).filter(a => !a.startsWith('-'));
const list = targets.length ? COMPANIES.filter(c => targets.includes(c.slug)) : COMPANIES;

console.log(`Probing ${list.length} companies for "${PROBE_QUERY}"\n`);

const results = [];
const queue = [...list];
const workers = Array.from({ length: 4 }, async () => {
  while (queue.length) {
    const company = queue.shift();
    const r = await probe(company);
    results.push(r);
    const badge = r.status === 'ok' ? 'OK   ' : r.status === 'empty' ? 'EMPTY' : 'FAIL ';
    console.log(
      `${badge} ${r.name.padEnd(20)} ${String(r.rows ?? 0).padStart(3)} rows  ${String(r.ms).padStart(6)}ms` +
      `  ${r.tiers?.join(',') || r.error?.slice(0, 70) || ''}`
    );
    if (r.sample?.length) for (const s of r.sample) console.log(`        - ${s}`);
  }
});
await Promise.all(workers);

const ok = results.filter(r => r.status === 'ok').length;
console.log(`\n${ok}/${results.length} companies returned rows via the Web Unlocker path.`);
console.log('Companies reporting EMPTY need a Scraper Studio collector: npm run studio:bootstrap');
