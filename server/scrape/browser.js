/**
 * Bright Data Browser API strategy.
 *
 * Connects Playwright to a remote Chrome in Bright Data's browser zone over CDP. This is
 * the middle tier between the cheap Web Unlocker and a full Scraper Studio collector: it
 * renders the SPA and, critically, can satisfy the delivery-location gate that makes
 * these catalogues return nothing to an anonymous fetch.
 *
 * The CLI's `bdata browser open` is not used because it hardcodes a 30s `load` wait,
 * which never resolves on sites this heavy.
 */
import { chromium } from 'playwright-core';
import { config } from '../config.js';

let endpointPromise = null;

/** Resolve the CDP websocket for the browser zone, fetching the zone password once. */
async function cdpEndpoint() {
  if (process.env.BRIGHTDATA_BROWSER_WS) return process.env.BRIGHTDATA_BROWSER_WS;
  endpointPromise ??= (async () => {
    const headers = { Authorization: `Bearer ${config.brightData.apiKey}` };
    const [statusRes, passRes] = await Promise.all([
      fetch(`${config.brightData.apiUrl}/status`, { headers }),
      fetch(`${config.brightData.apiUrl}/zone/passwords?zone=${config.brightData.browserZone}`, { headers }),
    ]);
    const customer = (await statusRes.json()).customer;
    const password = (await passRes.json()).passwords?.[0];
    if (!customer || !password) throw new Error('Could not resolve Bright Data browser credentials');
    return `wss://brd-customer-${customer}-zone-${config.brightData.browserZone}:${password}@brd.superproxy.io:9222`;
  })();
  return endpointPromise;
}

/** Overlays that hide the catalogue: cookie banners, app nags, login walls. */
const DISMISS_SELECTORS = [
  'button:has-text("Accept")', 'button:has-text("Got it")', 'button:has-text("Allow")',
  'button:has-text("Continue")', 'button:has-text("Later")', 'button:has-text("Not now")',
  '[aria-label="Close"]', 'button.close', '.modal button:has-text("×")',
];

/** Where each site takes a delivery location. Empty entry = no known gate. */
const LOCATION_GATES = {
  blinkit: { input: 'input[name="select-locality"], input[placeholder*="location" i]', submit: '.address-list-item, [class*="LocationSearchList"] div' },
  zepto: { input: 'input[placeholder*="location" i], input[placeholder*="address" i]', submit: '[data-testid="address-search-result"], li[role="option"]' },
  'swiggy-instamart': { input: 'input[placeholder*="area" i], #location', submit: '[data-testid="address-recent-item"], ._1yesr' },
  netmeds: { input: 'input[placeholder*="pincode" i], #pincode', submit: 'button:has-text("Check"), button:has-text("Apply")' },
  pharmeasy: { input: 'input[placeholder*="pincode" i]', submit: 'button:has-text("Apply"), button:has-text("Submit")' },
  'tata-1mg': { input: 'input[placeholder*="pincode" i], input[placeholder*="city" i]', submit: 'button:has-text("Apply")' },
  'apollo-247': { input: 'input[placeholder*="pincode" i]', submit: 'button:has-text("Apply"), button:has-text("Check")' },
};

async function dismissOverlays(page) {
  for (const selector of DISMISS_SELECTORS) {
    try {
      const el = page.locator(selector).first();
      if (await el.isVisible({ timeout: 400 })) await el.click({ timeout: 1500 }).catch(() => {});
    } catch { /* selector absent, keep going */ }
  }
}

async function setLocation(page, slug, pincode) {
  const gate = LOCATION_GATES[slug];
  if (!gate || !pincode) return false;
  try {
    const input = page.locator(gate.input).first();
    if (!(await input.isVisible({ timeout: 3000 }))) return false;
    await input.click({ timeout: 2000 });
    await input.fill(pincode, { timeout: 2000 });
    await page.waitForTimeout(1800);
    const option = page.locator(gate.submit).first();
    if (await option.isVisible({ timeout: 3000 })) {
      await option.click({ timeout: 2500 });
      await page.waitForTimeout(2500);
      return true;
    }
    await input.press('Enter').catch(() => {});
    await page.waitForTimeout(2000);
    return true;
  } catch {
    return false;
  }
}

/**
 * Render one search page and return its HTML.
 * Polls for rupee glyphs rather than trusting a load event - these apps paint the
 * shell long before the product grid arrives.
 */
export async function renderSearchPage(company, query, { pincode, maxWaitMs = 45_000 } = {}) {
  const url = company.searchUrl(query);
  const browser = await chromium.connectOverCDP(await cdpEndpoint(), { timeout: 90_000 });
  const context = await browser.newContext({
    locale: 'en-IN',
    viewport: { width: 1440, height: 900 },
  });
  const page = await context.newPage();

  try {
    await page.goto(url, { waitUntil: 'commit', timeout: 60_000 });
    await page.waitForTimeout(3000);
    await dismissOverlays(page);

    const locationSet = await setLocation(page, company.slug, pincode);
    if (locationSet) await page.waitForTimeout(2500);

    let html = '';
    let priceHits = 0;
    const deadline = Date.now() + maxWaitMs;
    while (Date.now() < deadline) {
      html = await page.content();
      priceHits = (html.match(/₹/g) ?? []).length;
      if (priceHits >= 5) break;
      // Lazy grids only load on scroll.
      await page.mouse.wheel(0, 1200).catch(() => {});
      await page.waitForTimeout(2500);
    }

    return { html, url, priceHits, locationSet };
  } finally {
    await context.close().catch(() => {});
    await browser.close().catch(() => {});
  }
}
