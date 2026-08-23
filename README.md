# MediFind

Search any medicine, home-use medical device or healthcare supply across **10 Indian health
commerce platforms**, ranked for your pincode by lowest landed cost, fastest delivery, or both.

Data is scraped through **Bright Data**, refreshed on a **12-hour cycle with Scraper Studio
AI self-healing**, cached as per-company JSON plus SQLite, and analysed by a **local LLM**.

```
npm install
npx -p @brightdata/cli bdata login     # once - stores the API key
npm run refresh                        # populate the cache
npm start                              # http://localhost:5173
```

---

## Scraper Studio collectors

The live `c_*` collector IDs on the account. Committed in
[`data/collectors.json`](data/collectors.json) and resolved at runtime by
`GET /api/provenance` and the **Data trail** panel in the UI.

| Platform | Collector ID | Status |
|---|---|---|
| Tata 1mg | `c_mt4brsnv2m1udv1uq8` | done |
| Zepto | `c_mt4dak661vbaay3lvh` | done |
| Blinkit | `c_mt4dalu72tulxydu6` | done |
| PharmEasy | `c_mt4dhi2rc9t4o6a9o` | done, self-healed once |

Console page for each: `https://brightdata.com/cp/scrapers/<collector-id>`.

**Full write-up — how the collectors are built, where they sit in the strategy ladder, how
the self-heal loop verifies itself, and what does not work: [`docs/scraper-studio.md`](docs/scraper-studio.md).**

---

## What it does

| Requirement | Where it lives |
|---|---|
| Scrape 10 active platforms | `server/companies.js`, `server/scrape/` |
| Self-heal every 12 h | `server/scheduler.js` → `server/scrape/runner.js` → `server/scrape/studio.js` |
| Per-company JSON cache | `data/companies/<slug>.json`, rewritten only after a refresh completes |
| Google-style type-ahead | `server/llm/suggest.js` + SQLite FTS5 |
| Photo / camera search | `server/llm/vision.js` (local vision model) |
| Price vs speed vs both | `server/llm/rank.js` |
| Pincode serviceability | `server/pincode.js` |
| Provenance of every row | `GET /api/provenance` → **Data trail** panel |
| Side-by-side comparison, watchlist, CSV export | `public/app.js` |

### The platforms — and their live status

All ten active platforms are wired up and refreshed on the same cycle. They do not all
*yield* data, and the reasons differ. Current measured state:

| Platform | Status | Working strategy / blocker |
|---|---|---|
| Amazon | **live** | Web Unlocker, ~5 s |
| Zepto | **live** | Browser API, ~33 s |
| Apollo 24\|7 | **live** | Browser API, ~26 s |
| Tata 1mg | **live** | Browser API, ~86 s |
| Blinkit | blocked | Bright Data restricts `blinkit.com` on the browser zone **per robots.txt**. The browser rung is dropped for this platform; a Studio collector is the fallback path. |
| PharmEasy | blocked | Same robots.txt restriction. Studio collector built and self-healed; still returns 0 rows. |
| Netmeds | needs work | Renders, but the catalogue stays behind its location gate. |
| Swiggy Instamart | needs work | Same — Instamart shows nothing until a serviceable address is set. |
| MedPlus Mart | needs work | Search URL not yet confirmed. |
| MediBuddy | needs work | Search URL not yet confirmed. |

Two platforms are **retired** — kept in the registry with a stated reason so the platform
count cannot silently drift, and never scraped:

| Platform | Why |
|---|---|
| Flipkart Health+ | `healthplus.flipkart.com` no longer resolves; the service was folded back into Flipkart. |
| HealthHug | `healthhug.com` publishes health articles, not a product catalogue. |

Each platform's search URL is a single line in `server/companies.js`. Run `npm run doctor`
after changing one to see immediately whether it returns rows.

> The measured numbers above come from a real refresh: 4 platforms healthy, **522 rows**
> for one query. Re-run `npm run doctor` to reproduce.

---

## Architecture

```
                    ┌──────────────── every 12 h ────────────────┐
                    ▼                                            │
  scheduler.js ─► runner.js ─► strategy ladder ─► extract.js ─► SQLite + JSON
                    │              │                                  │
                    │              ├─ 1. Studio collector             │
                    │              ├─ 2. Bright Data browser (CDP)    │
                    │              └─ 3. Web Unlocker                 │
                    │                                                 │
                    └─ empty result ─► studio.js heal ─► verify ──────┘

  browser ─► /api/suggest    ─► FTS5 prefix search        (every keystroke)
          ─► /api/identify   ─► local vision model        (photo search)
          ─► /api/search     ─► cache ─► rank.js ─► local LLM explanation
          ─► /api/provenance ─► which Bright Data product produced each row
```

### The strategy ladder

Not every site can be scraped the same way, and the cheapest method that works wins:

1. **Scraper Studio collector** — an AI-built collector driving a real browser. The only
   rung that can repair itself when a site changes.
2. **Bright Data Browser API** — Playwright over CDP. Renders the page and can fill in a
   pincode itself. Leads on SPAs because it answers in ~25 s against a collector's minutes.
3. **Web Unlocker** — one cheap HTTP call. Enough for server-rendered sites like Amazon.

Platforms flagged `browserRestricted` (Blinkit, PharmEasy) drop rung 2 entirely rather than
burning a 90-second timeout on a domain Bright Data blocks per the site's robots.txt.

`extract.js` then parses whatever came back through four tiers — JSON-LD, SPA hydration
state, a real DOM card walk, and a markdown fallback — so a site that changes how it renders
usually keeps working without any change here.

### Self-healing

When a company returns zero priced rows, `runner.js` does not just log it:

1. It sends the failure symptom to Scraper Studio's AI healer (`bdata scraper heal`).
2. The heal is auto-approved and saved.
3. The collector is re-run to **verify** the repair actually produced rows — a heal that
   reports success but still returns nothing is not treated as healed.
4. Only then is the company's JSON snapshot rewritten.

A heal can also be triggered by hand from **Data trail → Heal this collector** in the UI,
which runs the identical code path through `POST /api/admin/heal/:slug`.

### Ranking

Ordering is **deterministic**, computed in `rank.js`, never by the model — a shopping result
has a right answer and it must not drift between runs. Each offer scores on:

- **cost** — price *plus* delivery fee (landed cost), not the sticker price
- **speed** — ETA derived from the platform's fulfilment model and your pincode's city tier
- **trust** — rating damped by log-scaled review volume, so one 5-star review cannot
  outrank a 4.4 with twelve thousand

Weights shift with your choice of *Lowest price* / *Fastest delivery* / *Balanced*. The three
sub-scores are drawn as bars on every offer card, so the ranking is inspectable rather than
asserted.

The local LLM then explains the ranking and flags trade-offs. **If Ollama is not installed
the app still works** — it falls back to a rule-based explanation.

### Pincode serviceability

Indian PIN codes are hierarchical, so the first 2–3 digits give a state and city tier without
a licensed dataset. Quick-commerce platforms are metro-only; pharmacies courier nationally.
Verdicts are marked `modelled` unless a scrape confirmed them, and the UI never presents a
guess as a fact.

---

## Interface

- **Search** — type-ahead over SQLite FTS5, with a "did you mean" repair on a miss.
- **Photo search** — drop a photo of the pack, or use the camera; a local vision model reads it.
- **Ranked offers** — landed cost, modelled ETA, rating, prescription flag, and a badge naming
  the Bright Data product that scraped that row.
- **Score bars** — the cost / speed / trust breakdown behind each ranking.
- **Coverage strip** — every platform for this query, including the ones that returned nothing.
- **Filters** — hide prescription-only, free delivery only, 4★ and up, and a landed-cost ceiling.
- **Compare** — stage up to four offers and open a side-by-side table with the winner marked
  per row.
- **Watchlist** — track an offer's landed cost; it re-prices when you search that product again.
  (There is no background alert job, and the UI says so.)
- **Share / Export** — copy a deep link, or download the current offers as CSV.
- **Data trail** — Bright Data zones, per-platform strategy ladder, collector IDs, heal counts,
  rows-by-strategy, and a heal button.
- **Command palette** — `Ctrl`/`Cmd` + `K`. `/` focuses search, `Esc` closes panels.
- Dark mode, full keyboard navigation, and a responsive layout down to 390 px.

---

## Commands

```bash
npm start                         # server + 12 h scheduler
npm run dev                       # with --watch
npm run refresh                   # refresh all active companies now
npm run refresh:one -- amazon     # one company
npm run doctor                    # probe which sites the Unlocker path can reach
npm run studio:bootstrap          # build Studio collectors (5-10 min each)
npm run studio:bootstrap -- zepto # build one
npm run studio:heal -- zepto "price is null"
```

## Local LLM (optional)

```bash
ollama pull llama3.2    # ranking analysis and spell repair
ollama pull llava       # photo search
```

Without these: ranking, comparison, autocomplete and delivery estimates all work. Photo
search reports that it needs a vision model, and the analysis text is rule-based.

## API

| Endpoint | Purpose |
|---|---|
| `GET /api/suggest?q=` | type-ahead (+ `didYouMean` when the index misses) |
| `POST /api/search` | `{query, pincode, intent}` → ranked offers + analysis |
| `GET /api/coverage?q=` | per-platform coverage for one query |
| `POST /api/identify` | `{image}` base64 → product name |
| `GET /api/pincode/:pin` | city, state, and per-company serviceability |
| `GET /api/companies` | platform list with refresh + heal status |
| `GET /api/provenance` | Bright Data trail: zones, ladders, collector IDs, heals |
| `GET /api/status` | Bright Data, LLM, cache and schedule state |
| `GET /api/admin/runs` | recent refresh runs |
| `GET /api/admin/snapshot/:slug` | that company's cached JSON |
| `POST /api/admin/refresh` | trigger a refresh |
| `POST /api/admin/heal/:slug` | repair one Studio collector on demand |

## Configuration

See `.env.example`. Every value has a working default; the Bright Data key is read from the
CLI's credentials file, so nothing secret needs to live in this repo.

---

## Notes and limits

- **Prices and ETAs are estimates from public listings.** Confirm on the seller's site before
  ordering — the offer cards link straight to the product page.
- **Delivery ETAs are modelled**, not quoted by the platforms. They reflect each platform's
  fulfilment type and your city tier.
- Quick-commerce catalogues are genuinely pincode-dependent; the same search in a tier-3
  pincode will legitimately return fewer platforms.
- Only publicly available listing pages are scraped. No login-protected, paywalled or
  restricted content, and the two domains Bright Data restricts per robots.txt are left
  restricted rather than worked around.
- This is a price-comparison tool, not medical advice. Prescription items are flagged but
  still require a valid prescription at checkout.
