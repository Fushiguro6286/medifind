# Scraper Studio usage

How MediFind uses Bright Data Scraper Studio: what was built, how it was built, what
works, and what does not. Everything below was run from the terminal through the
`@brightdata/cli` package — no dashboard steps.

---

## 1. Collector IDs

These are the live `c_*` collectors on the account. They are committed in
[`data/collectors.json`](../data/collectors.json), and the running app resolves them
at `GET /api/provenance` and in the **Data trail** panel of the UI.

| Platform | Collector ID | Seed URL | Studio status |
|---|---|---|---|
| Tata 1mg | `c_mt4brsnv2m1udv1uq8` | `1mg.com/search/all?name=digital thermometer` | done |
| Zepto | `c_mt4dak661vbaay3lvh` | `zeptonow.com/search?query=digital thermometer` | done |
| Blinkit | `c_mt4dalu72tulxydu6` | `blinkit.com/s/?q=digital thermometer` | done |
| PharmEasy | `c_mt4dhi2rc9t4o6a9o` | `pharmeasy.in/search/all?name=digital thermometer` | done, healed once |

Each has a console page at `https://brightdata.com/cp/scrapers/<collector-id>`.

Raw creation response, straight from the CLI:

```json
{
  "collector_id": "c_mt4brsnv2m1udv1uq8",
  "name": "medifind-tata-1mg",
  "status": "done",
  "completed_steps": [
    "prepare_intent_analyzer", "planner", "discovery", "collector_mainatiner",
    "output_schema_generator", "code_generator", "input_schema_generator",
    "preview_runner", "preview_picker"
  ],
  "view_url": "https://brightdata.com/cp/scrapers/c_mt4brsnv2m1udv1uq8",
  "created_at": "2026-08-22T11:58:55.195Z"
}
```

Full artefacts: [`docs/evidence/`](evidence/).

---

## 2. How a collector gets built

`npm run studio:bootstrap` walks the active platform list and creates any collector that
is missing. The interesting part is not the command, it is the **description** — Studio's
AI generates the extraction code from it, so it has to name every field the ranker needs
and pre-empt the location interstitial that hides the catalogue on these sites.

That description is generated in [`server/scrape/studio.js`](../server/scrape/studio.js)
by `describe()`:

```
The site asks for a delivery location first: dismiss or accept any location prompt,
entering pincode 110001 if required, then read the search results. For each product
card in the search results extract: product_name, brand, price_inr as a number,
mrp_inr as a number, discount_percent, rating out of 5, review_count, product_url as
an absolute link, image_url, pack_size, in_stock boolean, prescription_required
boolean. Return one row per product, up to 40 rows.
```

Which becomes this CLI call ([`server/brightdata.js`](../server/brightdata.js)):

```bash
bdata scraper create <seed-url> "<description>" --name medifind-<slug> --json --pretty
```

Commands available:

```bash
npm run studio:bootstrap             # every active platform missing a collector
npm run studio:bootstrap -- zepto    # just one
npm run studio:bootstrap -- zepto --force
```

Build time is real: the Tata 1mg collector took **284 poll attempts (~5 minutes)** to walk
`user_intent_analyzer → planner → discovery → output_schema_generator → code_generator →
preview_runner`. Studio caps concurrent AI-Flow jobs, so the bootstrapper runs two at a time.

Abridged build log:

```
Creating scraper template...
Template created: c_mt4brsnv2m1udv1uq8
Triggering AI generation...
Step: user_intent_analyzer — polling (attempt 2/600)
Step: planner              — polling (attempt 41/600)
Step: output_schema_generator
Step: code_generator
Step: preview_runner       — polling (attempt 283/600)
Done in 284 poll attempts.
```

---

## 3. Where Studio sits in the strategy ladder

MediFind does not use one scraping method. Each platform walks a ladder, cheapest rung
that can work first, defined in `strategiesFor()` in
[`server/scrape/runner.js`](../server/scrape/runner.js):

| Platform kind | Ladder |
|---|---|
| Marketplace (server-rendered) | Web Unlocker → Browser API → **Studio collector** |
| Pharmacy / quick-commerce (SPA behind a location gate) | Browser API → **Studio collector** → Web Unlocker |
| `browserRestricted` platform | **Studio collector** → Web Unlocker (browser rung dropped) |
| `retired` platform | *(never scraped)* |

The Browser API leads on SPAs because it answers in ~25 s where a Studio collector takes
several minutes; the collector is the rung that catches a site whose DOM has moved, because
it is the only one that can repair itself.

The live ladder per platform, and which rung actually answered last, is served by
`GET /api/provenance` and drawn in the UI's **Data trail** panel. Every offer card also
carries a badge naming the Bright Data product that produced that row.

**Honest status:** across the last full refresh, 476 rows came from the Browser API and 174
from the Web Unlocker. The Studio collectors are wired in and healed, but on the platforms
where they sit behind a working Browser API rung they are not reached, and on the two
`browserRestricted` platforms they currently return 0 rows. See §6.

---

## 4. Self-healing

When a platform returns zero *priced* rows, the runner does not just log it — it hands the
failure symptom to Studio's AI healer and then verifies the repair.

```bash
npm run studio:heal -- zepto "price is null"
```

Under the hood ([`server/brightdata.js`](../server/brightdata.js)):

```bash
bdata scraper heal <collector-id> "<symptom>" --url <seed-url> \
      --auto-approve --auto-save --json --pretty
```

The healing loop in `healOne()` ([`server/scrape/studio.js`](../server/scrape/studio.js)):

1. Send the failure symptom to `bdata scraper heal`.
2. Auto-approve and auto-save the repair.
3. **Re-run the collector to verify it now returns rows.**
4. Only then rewrite the platform's JSON snapshot.

Step 3 is the part that matters. A heal that reports `status: done` but still yields nothing
is not treated as healed — otherwise the dashboard would report a fixed scraper that returns
an empty table.

The heal is reachable three ways:

- **Automatically**, from the 12-hourly refresh when a platform comes back empty.
- **From the CLI**, with `npm run studio:heal -- <slug> "<symptom>"`.
- **From the UI**, via *Data trail → Heal this collector*, which posts to
  `POST /api/admin/heal/:slug` and runs the identical code path. This is the one to use
  in a demo, because it shows the heal and its verification result on screen.

### The heal that has actually run

PharmEasy, recorded in `data/collectors.json`:

```json
"lastHeal": "2026-08-22T13:10:28.484Z",
"lastHealReason": "digital thermometer/viaBrowser: page.goto: Protocol error (Page.navigate):
                   Requested URL (https://pharmeasy.in/search/all?name=digital%20thermometer)
                   is restricted | digital thermometer/unlocker: 0 priced rows",
"healStatus": "done"
```

The heal completed and the collector was repaired. It did **not** restore data, because the
root cause was not a DOM change — see §6.

---

## 5. Production integration

The Collector IDs are not a demo artefact; they are wired into the running system.

| Where | What it does |
|---|---|
| `server/scheduler.js` | 12-hourly refresh across all active platforms |
| `server/scrape/runner.js` | resolves the collector per platform and runs it as a ladder rung |
| `server/scrape/studio.js` | `collectorFor(slug)` reads `data/collectors.json`; heals write back to it |
| `server/db.js` | `products.source` records which rung produced each row; `companies.collector_id` and `heal_count` persist |
| `GET /api/provenance` | serves the whole trail: zones, ladders, collector IDs, heal counts, rows-by-strategy |
| `POST /api/admin/heal/:slug` | triggers a heal from the dashboard |
| `data/companies/<slug>.json` | per-platform snapshot, rewritten only after a refresh completes |

---

## 6. What does not work, and why

Reported plainly, because a scraper dashboard that hides its failures is worth nothing.

| Platform | State | Reason |
|---|---|---|
| Blinkit | collector built, 0 rows | Bright Data restricts `blinkit.com` on the browser zone **per the site's own robots.txt**. This is a policy block, not a broken selector — no amount of healing fixes it. The browser rung is now dropped for this platform rather than retried into a pointless heal. |
| PharmEasy | collector built + healed, 0 rows | Same robots.txt restriction. |
| Netmeds, Swiggy Instamart | no collector | `bdata scraper create` failed; the catalogue also stays behind a location gate. |
| MedPlus Mart, MediBuddy | no collector | Search URL not yet confirmed. |
| Flipkart Health+ | **retired** | `healthplus.flipkart.com` no longer resolves; the service was folded back into Flipkart. |
| HealthHug | **retired** | `healthhug.com` publishes health articles, not a product catalogue. |

Retired platforms are kept in the registry with a stated reason rather than deleted, so the
platform count cannot silently drift, and they are never scraped.

The two robots.txt restrictions are respected, not worked around. Lifting them needs
account-manager approval on the Bright Data side.

---

## 7. Reproducing all of this

```bash
npm install
npx -p @brightdata/cli bdata login     # stores the API key

npm run studio:bootstrap               # build collectors (5-10 min each)
npm run refresh                        # full refresh across active platforms
npm run doctor                         # which platforms the Unlocker path can reach
npm start                              # http://localhost:5173 → Data trail panel
```

`npm run doctor` is the quickest check: it probes each platform's search URL and reports
which ones return parseable rows, so a changed search URL shows up in seconds rather than
after a 12-hour cycle.
