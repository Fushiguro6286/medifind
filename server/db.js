import { DatabaseSync } from 'node:sqlite';
import path from 'node:path';
import { DATA_DIR } from './config.js';
import { COMPANIES } from './companies.js';

export const db = new DatabaseSync(path.join(DATA_DIR, 'medifind.db'));

db.exec('PRAGMA journal_mode = WAL');
db.exec('PRAGMA synchronous = NORMAL');

db.exec(`
CREATE TABLE IF NOT EXISTS companies (
  slug           TEXT PRIMARY KEY,
  name           TEXT NOT NULL,
  kind           TEXT NOT NULL,
  collector_id   TEXT,
  last_refresh   INTEGER,
  last_status    TEXT DEFAULT 'pending',
  last_row_count INTEGER DEFAULT 0,
  heal_count     INTEGER DEFAULT 0,
  last_heal_at   INTEGER,
  last_error     TEXT
);

CREATE TABLE IF NOT EXISTS products (
  id            INTEGER PRIMARY KEY AUTOINCREMENT,
  company_slug  TEXT NOT NULL REFERENCES companies(slug),
  query         TEXT NOT NULL,
  name          TEXT NOT NULL,
  norm_name     TEXT NOT NULL,
  brand         TEXT,
  price         REAL,
  mrp           REAL,
  discount      REAL,
  rating        REAL,
  reviews       INTEGER,
  url           TEXT,
  image         TEXT,
  pack          TEXT,
  in_stock      INTEGER DEFAULT 1,
  rx_required   INTEGER DEFAULT 0,
  category      TEXT,
  source        TEXT,
  scraped_at    INTEGER NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_products_query   ON products(query);
CREATE INDEX IF NOT EXISTS idx_products_company ON products(company_slug);
CREATE INDEX IF NOT EXISTS idx_products_norm    ON products(norm_name);
CREATE INDEX IF NOT EXISTS idx_products_price   ON products(price);

-- External-content FTS5: the index mirrors the products table instead of storing its
-- own copy, so it can be rebuilt with one command. A contentless table (content='')
-- cannot be DELETEd from, which is what a rebuild needs.
CREATE VIRTUAL TABLE IF NOT EXISTS product_fts USING fts5(
  name, brand, category, content='products', content_rowid='id'
);

CREATE TABLE IF NOT EXISTS suggestions (
  term        TEXT PRIMARY KEY,
  display     TEXT NOT NULL,
  category    TEXT,
  hits        INTEGER DEFAULT 1,
  min_price   REAL,
  companies   INTEGER DEFAULT 0,
  updated_at  INTEGER
);
CREATE INDEX IF NOT EXISTS idx_sugg_hits ON suggestions(hits DESC);

CREATE TABLE IF NOT EXISTS refresh_runs (
  id           INTEGER PRIMARY KEY AUTOINCREMENT,
  company_slug TEXT,
  started_at   INTEGER,
  finished_at  INTEGER,
  status       TEXT,
  row_count    INTEGER DEFAULT 0,
  healed       INTEGER DEFAULT 0,
  strategy     TEXT,
  error        TEXT
);
CREATE INDEX IF NOT EXISTS idx_runs_started ON refresh_runs(started_at DESC);

CREATE TABLE IF NOT EXISTS pincode_cache (
  pincode      TEXT NOT NULL,
  company_slug TEXT NOT NULL,
  serviceable  INTEGER,
  eta_minutes  INTEGER,
  detail       TEXT,
  checked_at   INTEGER,
  PRIMARY KEY (pincode, company_slug)
);

CREATE TABLE IF NOT EXISTS search_log (
  id         INTEGER PRIMARY KEY AUTOINCREMENT,
  query      TEXT,
  pincode    TEXT,
  intent     TEXT,
  created_at INTEGER
);
`);

const upsertCompany = db.prepare(
  'INSERT INTO companies (slug, name, kind) VALUES (?, ?, ?) ' +
  'ON CONFLICT(slug) DO UPDATE SET name = excluded.name, kind = excluded.kind'
);
for (const c of COMPANIES) upsertCompany.run(c.slug, c.name, c.kind);

export const normalise = s => String(s ?? '')
  .toLowerCase()
  .replace(/[^a-z0-9\s%.+-]/g, ' ')
  .replace(/\s+/g, ' ')
  .trim();

const stmts = {
  insertProduct: db.prepare(
    'INSERT INTO products (company_slug, query, name, norm_name, brand, price, mrp, discount, ' +
    'rating, reviews, url, image, pack, in_stock, rx_required, category, source, scraped_at) ' +
    'VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)'
  ),
  clearCompanyQuery: db.prepare('DELETE FROM products WHERE company_slug = ? AND query = ?'),
  clearCompany: db.prepare('DELETE FROM products WHERE company_slug = ?'),
  upsertSuggestion: db.prepare(
    'INSERT INTO suggestions (term, display, category, hits, min_price, companies, updated_at) ' +
    'VALUES (?,?,?,1,?,1,?) ' +
    'ON CONFLICT(term) DO UPDATE SET ' +
    '  hits = suggestions.hits + 1, ' +
    '  display = excluded.display, ' +
    '  category = COALESCE(excluded.category, suggestions.category), ' +
    '  min_price = CASE WHEN excluded.min_price IS NULL THEN suggestions.min_price ' +
    '                   WHEN suggestions.min_price IS NULL THEN excluded.min_price ' +
    '                   ELSE MIN(suggestions.min_price, excluded.min_price) END, ' +
    '  updated_at = excluded.updated_at'
  ),
  companyStatus: db.prepare(
    'UPDATE companies SET last_refresh = ?, last_status = ?, last_row_count = ?, last_error = ? WHERE slug = ?'
  ),
  bumpHeal: db.prepare('UPDATE companies SET heal_count = heal_count + 1, last_heal_at = ? WHERE slug = ?'),
  setCollector: db.prepare('UPDATE companies SET collector_id = ? WHERE slug = ?'),
  startRun: db.prepare('INSERT INTO refresh_runs (company_slug, started_at, status) VALUES (?,?,?)'),
  finishRun: db.prepare(
    'UPDATE refresh_runs SET finished_at = ?, status = ?, row_count = ?, healed = ?, strategy = ?, error = ? WHERE id = ?'
  ),
  logSearch: db.prepare('INSERT INTO search_log (query, pincode, intent, created_at) VALUES (?,?,?,?)'),
  putPincode: db.prepare(
    'INSERT INTO pincode_cache (pincode, company_slug, serviceable, eta_minutes, detail, checked_at) ' +
    'VALUES (?,?,?,?,?,?) ' +
    'ON CONFLICT(pincode, company_slug) DO UPDATE SET ' +
    '  serviceable = excluded.serviceable, eta_minutes = excluded.eta_minutes, ' +
    '  detail = excluded.detail, checked_at = excluded.checked_at'
  ),
};

/** Replace a company's rows for one query atomically, then refresh the type-ahead index. */
export function replaceProducts(companySlug, query, rows, source = 'unlocker') {
  const now = Date.now();
  db.exec('BEGIN');
  try {
    stmts.clearCompanyQuery.run(companySlug, query);
    for (const r of rows) {
      stmts.insertProduct.run(
        companySlug, query, r.name, normalise(r.name), r.brand ?? null,
        r.price ?? null, r.mrp ?? null, r.discount ?? null,
        r.rating ?? null, r.reviews ?? null, r.url ?? null, r.image ?? null,
        r.pack ?? null, r.inStock === false ? 0 : 1, r.rxRequired ? 1 : 0,
        r.category ?? null, source, now,
      );
      stmts.upsertSuggestion.run(normalise(r.name), r.name, r.category ?? null, r.price ?? null, now);
    }
    db.exec('COMMIT');
  } catch (err) {
    db.exec('ROLLBACK');
    throw err;
  }
  markFtsDirty();
  return rows.length;
}

let ftsDirty = true;
export function markFtsDirty() { ftsDirty = true; }

/** FTS5 is rebuilt lazily - one refresh touches many companies, we only pay the cost once. */
export function ensureFts() {
  if (!ftsDirty) return;
  // The external-content rebuild command re-reads every row of `products` in one pass.
  db.exec("INSERT INTO product_fts(product_fts) VALUES('rebuild')");
  ftsDirty = false;
}

export const setCompanyStatus = (slug, status, rowCount, error = null) =>
  stmts.companyStatus.run(Date.now(), status, rowCount, error, slug);
export const recordHeal = slug => stmts.bumpHeal.run(Date.now(), slug);
export const setCollectorId = (slug, id) => stmts.setCollector.run(id, slug);
export const startRun = slug => stmts.startRun.run(slug, Date.now(), 'running').lastInsertRowid;
export const finishRun = (id, { status, rowCount = 0, healed = 0, strategy = null, error = null }) =>
  stmts.finishRun.run(Date.now(), status, rowCount, healed ? 1 : 0, strategy, error, id);
export const logSearch = (query, pincode, intent) => stmts.logSearch.run(query, pincode, intent, Date.now());
export const cachePincode = (pincode, slug, serviceable, eta, detail) =>
  stmts.putPincode.run(pincode, slug, serviceable ? 1 : 0, eta, detail, Date.now());
export const clearCompany = slug => stmts.clearCompany.run(slug);

export const listCompanies = () => db.prepare('SELECT * FROM companies ORDER BY name').all();

/**
 * The strategy that answered on each company's most recent finished run.
 *
 * companies.last_status records *whether* a refresh worked; only refresh_runs records
 * *how*. The provenance view needs the how - "Zepto via Browser API" is the claim the
 * Scraper Studio judging criterion actually rests on.
 */
export const latestStrategies = () => db.prepare(
  `SELECT r.company_slug AS slug, r.strategy, r.status, r.finished_at, r.healed
     FROM refresh_runs r
     JOIN (SELECT company_slug, MAX(finished_at) AS newest
             FROM refresh_runs WHERE finished_at IS NOT NULL GROUP BY company_slug) m
       ON m.company_slug = r.company_slug AND m.newest = r.finished_at`
).all();
export const recentRuns = (limit = 40) =>
  db.prepare('SELECT * FROM refresh_runs ORDER BY started_at DESC LIMIT ?').all(limit);
