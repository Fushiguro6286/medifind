/**
 * Turns a scraped page into product rows.
 *
 * Four tiers, tried in order of reliability:
 *   1. JSON-LD    - schema.org Product/ItemList blocks.
 *   2. SPA state  - __NEXT_DATA__ / __INITIAL_STATE__ hydration blobs (Next.js sites).
 *   3. DOM cards  - real DOM walk. Finds the repeating element that contains a price
 *                   and reads title/link/rating/reviews out of that subtree.
 *   4. Markdown   - price-anchored heuristic, for the Unlocker's markdown rendering.
 *
 * Every tier emits the same row shape so the ranker never has to care which one fired.
 */
import * as cheerio from 'cheerio';

const RUPEE_G = /(?:₹|Rs\.?\s?|INR\s?)\s?([\d][\d,]*(?:\.\d{1,2})?)/gi;

const toNumber = v => {
  if (v == null) return null;
  if (typeof v === 'number') return Number.isFinite(v) ? v : null;
  const n = parseFloat(String(v).replace(/[^\d.]/g, ''));
  return Number.isFinite(n) ? n : null;
};

const clean = s => String(s ?? '').replace(/\s+/g, ' ').replace(/\\+/g, '').trim();

const absolute = (url, base) => {
  if (!url) return null;
  try { return new URL(url, base).toString(); } catch { return null; }
};

const NOISE = /^(home|login|sign\s?up|sign\s?in|cart|offers?|help|about|careers|privacy|terms|download|view all|see all|shop now|add to cart|buy now|browse|categories|sort by|filter|next|previous|back|menu|search|explore|show more|load more|\d+)$/i;

function plausibleTitle(t) {
  const s = clean(t);
  if (s.length < 6 || s.length > 180) return false;
  if (NOISE.test(s)) return false;
  if (!/[a-z]{3}/i.test(s)) return false;
  // A real product title never carries its own price, rating or delivery promise. When
  // the per-site title selector misses, the longest-text fallback otherwise latches onto
  // strings like "Price, product page ₹155", "4.04.0 out of 5 stars (2.3K) 100+ bought
  // in past month" or "FREE delivery Tue, 25 Aug".
  if (/₹|\bM\.?R\.?P\b|\bRs\.?\s?\d/i.test(s)) return false;
  if (/out of 5 stars|bought in past month|\bratings?\b|\breviews?\b/i.test(s)) return false;
  if (/^(free|fastest|get it|order within|arrives|delivered|ships)\b/i.test(s)) return false;
  if (/\bdelivery\b.*\b(mon|tue|wed|thu|fri|sat|sun)\b/i.test(s)) return false;
  if (/^(price|deal|offer|discount|save|sponsored)\b/i.test(s)) return false;
  // Payment and coupon banners sit inside the product grid and carry a rupee amount,
  // so they survive every other check ("Up to 5% back with Amazon Pay ICICI card").
  if (/%\s*(back|off)\b|cashback|no cost emi|bank offer|credit card|coupon|apply\b/i.test(s)) return false;
  return true;
}

/* ------------------------------------------------------------------ tier 1 */

export function fromJsonLd(html, baseUrl) {
  const out = [];
  for (const [, body] of html.matchAll(/<script[^>]+type=["']application\/ld\+json["'][^>]*>([\s\S]*?)<\/script>/gi)) {
    let parsed;
    try { parsed = JSON.parse(body.trim()); } catch { continue; }
    for (const node of flattenLd(parsed)) {
      const type = [].concat(node['@type'] ?? []).map(String);
      if (!type.some(t => /product/i.test(t))) continue;
      const offer = [].concat(node.offers ?? [])[0] ?? {};
      const agg = node.aggregateRating ?? {};
      out.push({
        name: clean(node.name),
        brand: clean(node.brand?.name ?? node.brand ?? '') || null,
        price: toNumber(offer.price ?? offer.lowPrice ?? node.price),
        mrp: toNumber(offer.highPrice),
        rating: toNumber(agg.ratingValue),
        reviews: toNumber(agg.reviewCount ?? agg.ratingCount),
        url: absolute(node.url ?? offer.url, baseUrl),
        image: absolute([].concat(node.image ?? [])[0], baseUrl),
        inStock: offer.availability ? !/OutOfStock/i.test(String(offer.availability)) : true,
      });
    }
  }
  return out.filter(r => plausibleTitle(r.name) && r.price != null);
}

function* flattenLd(node) {
  if (Array.isArray(node)) { for (const n of node) yield* flattenLd(n); return; }
  if (!node || typeof node !== 'object') return;
  yield node;
  for (const key of ['@graph', 'itemListElement', 'item', 'mainEntity', 'hasPart']) {
    if (node[key]) yield* flattenLd(node[key]);
  }
}

/* ------------------------------------------------------------------ tier 2 */

/**
 * Read a balanced JSON value starting at `start` (which must point at `{` or `[`).
 * A non-greedy regex cannot do this: hydration blobs are megabytes of nested
 * objects, and `\{[\s\S]*?\}` stops at the very first closing brace.
 */
function readBalanced(text, start) {
  const open = text[start];
  if (open !== '{' && open !== '[') return null;
  const close = open === '{' ? '}' : ']';
  let depth = 0;
  let inString = false;
  let escaped = false;

  for (let i = start; i < text.length; i++) {
    const ch = text[i];
    if (escaped) { escaped = false; continue; }
    if (ch === '\\') { if (inString) escaped = true; continue; }
    if (ch === '"') { inString = !inString; continue; }
    if (inString) continue;
    if (ch === open) depth++;
    else if (ch === close) {
      depth--;
      if (depth === 0) return text.slice(start, i + 1);
    }
  }
  return null;
}

const STATE_MARKERS = [
  '__NEXT_DATA__',
  'window.__INITIAL_STATE__',
  'window.__PRELOADED_STATE__',
  'window.__ROUTER_INITIAL_DATA__',
  'window.__APOLLO_STATE__',
  'window.__NUXT__',
];

/**
 * Next.js App Router streams its payload as `self.__next_f.push([1,"<escaped json>"])`.
 * Concatenating those string literals reconstructs the flight stream, which carries
 * the same product objects the page renders from.
 */
function fromNextFlight(html, baseUrl) {
  const chunks = [];
  for (const m of html.matchAll(/self\.__next_f\.push\(\s*\[\s*\d+\s*,\s*("(?:[^"\\]|\\.)*")\s*\]\s*\)/g)) {
    try { chunks.push(JSON.parse(m[1])); } catch { /* skip malformed chunk */ }
  }
  if (!chunks.length) return [];
  const stream = chunks.join('');

  const rows = [];
  const seenAt = new Set();
  // Product objects in the stream are recognisable by a price-ish key.
  for (const m of stream.matchAll(/\{"(?:[^"\\]|\\.){0,80}?"/g)) {
    if (rows.length > 300) break;
    const at = m.index;
    if (seenAt.has(at)) continue;
    const raw = readBalanced(stream, at);
    if (!raw || raw.length < 60 || raw.length > 400_000) continue;
    if (!/"(?:price|sellingPrice|selling_price|mrp|specialPrice)"\s*:/.test(raw)) continue;
    seenAt.add(at);
    try { rows.push(...harvestProducts(JSON.parse(raw), baseUrl)); } catch { /* not valid on its own */ }
  }
  return rows;
}

export function fromSpaState(html, baseUrl) {
  for (const marker of STATE_MARKERS) {
    let from = 0;
    for (let guard = 0; guard < 5; guard++) {
      const at = html.indexOf(marker, from);
      if (at === -1) break;
      from = at + marker.length;
      // Skip past `=` / `>` to the first structural character.
      const braceAt = html.slice(from, from + 400).search(/[[{]/);
      if (braceAt === -1) continue;
      const raw = readBalanced(html, from + braceAt);
      if (!raw) continue;
      try {
        const rows = harvestProducts(JSON.parse(raw), baseUrl);
        if (rows.length) return rows;
      } catch { /* try the next occurrence */ }
    }
  }
  return fromNextFlight(html, baseUrl);
}

const NAME_KEYS = ['name', 'product_name', 'productName', 'title', 'display_name', 'displayName'];
const PRICE_KEYS = ['price', 'selling_price', 'sellingPrice', 'discounted_price', 'discountedPrice',
  'offer_price', 'offerPrice', 'final_price', 'finalPrice', 'sp'];
const MRP_KEYS = ['mrp', 'max_retail_price', 'original_price', 'originalPrice', 'strike_price', 'strikePrice'];
const RATING_KEYS = ['rating', 'avg_rating', 'averageRating', 'average_rating', 'ratingValue'];
const REVIEW_KEYS = ['review_count', 'reviewCount', 'ratings_count', 'ratingCount', 'total_reviews', 'numReviews'];
const URL_KEYS = ['url', 'product_url', 'productUrl', 'link', 'slug', 'permalink', 'canonical_url'];
const IMG_KEYS = ['image', 'image_url', 'imageUrl', 'thumbnail', 'images', 'primary_image'];

const pick = (obj, keys) => {
  for (const k of keys) if (obj[k] != null && obj[k] !== '') return obj[k];
  return null;
};

/** Walk an arbitrary hydration blob and keep any object that looks like a priced product. */
function harvestProducts(root, baseUrl, depth = 0, seen = new Set(), out = []) {
  if (depth > 14 || out.length > 400 || root == null || typeof root !== 'object') return out;
  if (seen.has(root)) return out;
  seen.add(root);

  if (Array.isArray(root)) {
    for (const item of root) harvestProducts(item, baseUrl, depth + 1, seen, out);
    return out;
  }

  const rawName = pick(root, NAME_KEYS);
  const rawPrice = pick(root, PRICE_KEYS);
  if (typeof rawName === 'string' && rawPrice != null) {
    const price = toNumber(typeof rawPrice === 'object' ? pick(rawPrice, PRICE_KEYS) ?? rawPrice.value : rawPrice);
    if (price != null && price > 0 && plausibleTitle(rawName)) {
      let img = pick(root, IMG_KEYS);
      if (Array.isArray(img)) img = img[0];
      if (img && typeof img === 'object') img = img.url ?? img.src ?? null;
      out.push({
        name: clean(rawName),
        brand: clean(root.brand?.name ?? root.brand ?? root.manufacturer ?? '') || null,
        price,
        mrp: toNumber(pick(root, MRP_KEYS)),
        rating: toNumber(pick(root, RATING_KEYS)),
        reviews: toNumber(pick(root, REVIEW_KEYS)),
        url: absolute(pick(root, URL_KEYS), baseUrl),
        image: absolute(img, baseUrl),
        pack: clean(root.pack_size ?? root.packSize ?? root.unit ?? root.variant ?? '') || null,
        inStock: root.in_stock ?? root.inStock ?? root.available ?? true,
        rxRequired: Boolean(root.prescription_required ?? root.rx_required ?? root.is_prescription_required),
      });
    }
  }

  for (const value of Object.values(root)) harvestProducts(value, baseUrl, depth + 1, seen, out);
  return out;
}

/* ------------------------------------------------------------------ tier 3 */

/** Per-site card selectors. When one matches we get clean rows; otherwise we fall
 *  back to the generic "smallest ancestor holding a price" walk below. */
const CARD_HINTS = {
  'amazon.in': { card: 'div[data-asin][data-component-type="s-search-result"]', title: 'h2 span, h2 a span', link: 'h2 a, a.a-link-normal.s-no-outline', price: '.a-price .a-price-whole', mrp: '.a-text-price .a-offscreen', rating: '.a-icon-alt', reviews: 'a[aria-label$="ratings"], span[aria-label$="ratings"]' },
  'flipkart.com': { card: 'div[data-id]', title: 'a[title], div._4rR01T, a.s1Q9rs', link: 'a[href*="/p/"]', price: 'div._30jeq3, div._1_WHN1', mrp: 'div._3I9_wc', rating: 'div._3LWZlK', reviews: 'span._2_R_DZ' },
  // 1mg ships CSS-module class names with a build hash suffix (…__etaGT), so match on the
  // stable prefix only. The price text reads "Discounted Price: ₹87".
  '1mg.com': { card: 'div[class*="VerticalProductTile__container"], div[class*="ProductCard"]', title: 'img[title], div[class*="ProductTitle"], span[class*="ProductTitle"]', link: 'a', price: 'span[class*="textPrimary"], div[class*="Price__price"]', mrp: 'strike, span[class*="Price__slashed"]', rating: 'span[class*="CardRatingDetail__ratings"]', reviews: 'span[class*="CardRatingDetail__read-review"]' },
  'pharmeasy.in': { card: 'div[class*="ProductCard_medicineUnitWrapper"], div[class*="SearchResults_productCard"]', title: 'h1[class*="ProductCard_medicineName"], div[class*="ProductCard_medicineName"]', link: 'a', price: 'div[class*="ProductCard_ourPrice"], span[class*="ProductCard_gcdDiscountContainer"]', mrp: 'div[class*="ProductCard_striketrough"]', rating: 'span[class*="ProductCard_ratingValue"]', reviews: 'span[class*="ProductCard_ratingCount"]' },
  'netmeds.com': { card: 'li.ph-item, div.cat-item', title: '.clip-text, .drug-name', link: 'a', price: '.final-price, .price', mrp: '.strike-price', rating: '.rating-value', reviews: '.rating-count' },
  'apollopharmacy.in': { card: 'li[class*="ProductCard"], div[class*="ProductCard_productCard"]', title: 'p[class*="ProductCard_productName"], h2', link: 'a', price: 'p[class*="ProductCard_sellingPrice"], span[class*="price"]', mrp: 'span[class*="ProductCard_mrpPrice"]', rating: 'span[class*="rating"]', reviews: 'span[class*="review"]' },
  'zeptonow.com': { card: 'a[data-testid="product-card"], div[class*="ProductCard"]', title: '[data-testid="product-card-name"], h5', link: 'a', price: '[data-testid="product-card-price"]', mrp: 'p[class*="line-through"]', rating: '', reviews: '' },
  'blinkit.com': { card: 'div[role="button"][id], div[class*="Product__UpdatedPLPCard"]', title: 'div[class*="Product__UpdatedTitle"], .plp-product__name', link: 'a', price: 'div[class*="Product__UpdatedPriceAndAtcContainer"] div, .plp-product__price', mrp: 'div[class*="strike"]', rating: '', reviews: '' },
  'medplusmart.com': { card: 'div.product-item, li.product', title: '.product-name, .prod-name', link: 'a', price: '.price, .best-price', mrp: '.mrp', rating: '', reviews: '' },
};

function hintFor(baseUrl) {
  try {
    const host = new URL(baseUrl).hostname;
    for (const [domain, hint] of Object.entries(CARD_HINTS)) if (host.includes(domain)) return hint;
  } catch { /* fall through to generic */ }
  return null;
}

/** Read a selector's visible text, falling back to the accessibility attributes.
 *  Amazon keeps both the rating and the review count only in `aria-label`. */
const textOf = ($, el, selector) => {
  if (!selector) return '';
  const node = $(el).find(selector).first();
  if (!node.length) return '';
  return clean(node.text() || node.attr('aria-label') || node.attr('title') || node.attr('alt') || '');
};

/** All aria-label/title/alt values inside a card, joined - a second haystack for
 *  the rating and review regexes when the numbers never appear as text nodes. */
const attrPool = ($, el) => {
  const parts = [];
  $(el).find('[aria-label], [title], img[alt]').each((_, n) => {
    const node = $(n);
    parts.push(node.attr('aria-label'), node.attr('title'), node.attr('alt'));
  });
  return clean(parts.filter(Boolean).join(' | '));
};

function readCard($, el, baseUrl, hint) {
  const scope = $(el);
  const whole = clean(scope.text());
  if (whole.length > 1200) return null;

  const priceText = hint?.price ? textOf($, el, hint.price) : '';
  const priceSource = priceText || whole;

  /**
   * A card can carry three rupee amounts: price, struck MRP, and the saving. Zepto renders
   * "ADD ₹136 ₹149 ₹13 OFF" - taking the smallest would return the ₹13 discount as the
   * price. Drop any amount that reads as a saving, then the smallest of what remains is
   * the selling price regardless of which order the site lists them in.
   */
  let prices = [...priceSource.matchAll(RUPEE_G)]
    .filter(m => {
      // These cards are rendered without whitespace ("₹13OFFHicks DT-11"), so `off\b`
      // never fires - match the token without requiring a boundary after it.
      const after = priceSource.slice(m.index + m[0].length, m.index + m[0].length + 12);
      const before = priceSource.slice(Math.max(0, m.index - 14), m.index);
      if (/^\s*(off|discount|saved?)/i.test(after)) return false;
      if (/(save|saving|discount|off)\s*$/i.test(before)) return false;
      return true;
    })
    .map(m => toNumber(m[1]))
    .filter(n => n && n >= 5);

  // Belt and braces: a saving is arithmetically the gap between price and MRP, so drop any
  // amount that equals the difference of two others. Catches the label-free layouts too.
  if (prices.length >= 3) {
    const kept = prices.filter((v, i) =>
      !prices.some((a, ai) => prices.some((b, bi) =>
        ai !== i && bi !== i && ai !== bi && Math.abs(Math.abs(a - b) - v) <= 1)));
    if (kept.length >= 1) prices = kept;
  }

  // Amazon's .a-price-whole carries no rupee glyph inside the span.
  const bare = priceText && !prices.length ? toNumber(priceText) : null;
  const price = prices.length ? Math.min(...prices) : bare;
  if (price == null || price < 5 || price > 500000) return null;

  let title = hint?.title ? textOf($, el, hint.title) : '';
  if (!plausibleTitle(title)) {
    // Longest anchor/heading text in the card is nearly always the product name.
    let best = '';
    scope.find('a[title]').each((_, a) => { const t = clean($(a).attr('title')); if (t.length > best.length) best = t; });
    if (!plausibleTitle(best)) {
      scope.find('h1,h2,h3,h4,h5,a,p,span,div').each((_, n) => {
        const kids = $(n).children().length;
        if (kids > 2) return;
        const t = clean($(n).text());
        if (plausibleTitle(t) && t.length > best.length && t.length < 160) best = t;
      });
    }
    title = best;
  }
  if (!plausibleTitle(title)) return null;

  const href = (hint?.link ? scope.find(hint.link).first().attr('href') : null)
    ?? scope.find('a[href]').first().attr('href')
    ?? scope.closest('a[href]').attr('href');

  // Lazy-loaded grids seed `src` with a 1x1 data URI and keep the real asset in
  // data-src/srcset, so take the first candidate that is an actual remote image.
  let imgSrc = null;
  scope.find('img').each((_, node) => {
    if (imgSrc) return false;
    const image = $(node);
    const candidates = [
      image.attr('src'),
      image.attr('data-src'),
      image.attr('data-old-hires'),
      image.attr('srcset')?.split(',')[0]?.trim().split(/\s+/)[0],
    ];
    imgSrc = candidates.find(c => c && !/^data:/i.test(c) && /\.(jpe?g|png|webp|avif)/i.test(c))
      ?? candidates.find(c => c && !/^data:/i.test(c))
      ?? null;
  });

  const attrs = attrPool($, el);
  const RATING_RE = /\b([0-5](?:\.\d)?)\s*(?:\/\s*5|out of 5|★|stars?\b)/i;
  // Must start with a digit: a bare `[\d,]` class happily matches the lone comma in
  // "4.0 out of 5 stars, rating details" and swallows the real count that follows.
  const REVIEW_RE = /(\d[\d,]{0,8})\s*(?:ratings?|reviews?)\b/i;

  // Note: `||` not `??` - an empty selector match is a miss that must fall through,
  // and '' is not nullish.
  const firstMatch = (re, ...haystacks) => {
    for (const h of haystacks) {
      if (!h) continue;
      const m = re.exec(h);
      if (m) return m;
    }
    return null;
  };

  const ratingText = hint?.rating ? textOf($, el, hint.rating) : '';
  const ratingMatch = firstMatch(RATING_RE, ratingText, attrs, whole)
    || (ratingText ? /^\s*([0-5](?:\.\d)?)\s*$/.exec(ratingText) : null);

  const reviewText = hint?.reviews ? textOf($, el, hint.reviews) : '';
  const reviewMatch = firstMatch(REVIEW_RE, reviewText, attrs, whole)
    || (reviewText ? /^\s*\(?\s*([\d,]{2,9})\s*\)?\s*$/.exec(reviewText) : null);

  const mrpText = hint?.mrp ? textOf($, el, hint.mrp) : '';
  // Amazon renders a price as whole+fraction spans, so the card's raw text yields
  // "94900" for 949.00. Cap the strike-through at a believable multiple of the
  // selling price so that artefact never becomes an MRP.
  const mrpCandidates = [...(mrpText || whole).matchAll(RUPEE_G)]
    .map(m => toNumber(m[1]))
    .filter(n => n != null && n > price && n <= price * 12);

  return {
    name: title,
    brand: null,
    price,
    mrp: mrpCandidates.length ? Math.max(...mrpCandidates) : null,
    rating: ratingMatch ? toNumber(ratingMatch[1]) : null,
    reviews: reviewMatch ? toNumber(reviewMatch[1]) : null,
    url: absolute(href, baseUrl),
    image: absolute(imgSrc, baseUrl),
    inStock: !/out of stock|sold out|notify me|currently unavailable/i.test(whole),
    rxRequired: /prescription required|rx required|prescription drug/i.test(whole),
  };
}

export function fromDom(html, baseUrl) {
  const $ = cheerio.load(html);
  $('script, style, noscript, header, footer, nav').remove();
  const hint = hintFor(baseUrl);

  // Preferred path: the site-specific card selector.
  if (hint?.card) {
    const cards = $(hint.card).toArray();
    if (cards.length) {
      const rows = cards.map(el => readCard($, el, baseUrl, hint)).filter(Boolean);
      if (rows.length) return rows;
    }
  }

  // Generic path: for every price in the document, climb to the smallest ancestor
  // that also carries a link and an image - that ancestor is the product card.
  //
  // The price is rarely a bare text node. Sites wrap it with a screen-reader label
  // ("Discounted Price: ₹87" as span > span), so allow one level of nesting instead of
  // requiring a true leaf.
  const seen = new Set();
  const rows = [];
  $('*').each((_, el) => {
    if (rows.length > 120) return false;
    const node = $(el);
    if (node.children().length > 1) return;
    const text = clean(node.text());
    if (!/(?:₹|Rs\.?\s|INR)/i.test(text)) return;
    if (text.length > 60) return;

    let card = node;
    for (let hop = 0; hop < 8; hop++) {
      const parent = card.parent();
      if (!parent.length) break;
      card = parent;
      const el0 = card[0];
      if (card.find('a[href]').length && card.find('img').length && clean(card.text()).length < 900) {
        if (seen.has(el0)) return;
        seen.add(el0);
        const row = readCard($, el0, baseUrl, hint);
        if (row) rows.push(row);
        return;
      }
    }
  });
  return rows;
}

/* ------------------------------------------------------------------ tier 4 */

export function fromMarkdown(md, baseUrl) {
  const rows = [];
  const links = [...md.matchAll(/\[([^\]]{0,200}?)\]\(([^)\s]+)[^)]*\)/g)]
    .map(m => ({ text: clean(m[1].replace(/!\[[^\]]*\]\([^)]*\)/g, '')), url: m[2], index: m.index }));

  for (const priceMatch of md.matchAll(RUPEE_G)) {
    const at = priceMatch.index;
    const price = toNumber(priceMatch[1]);
    if (price == null || price < 5 || price > 500000) continue;

    let anchor = null;
    for (let i = links.length - 1; i >= 0; i--) {
      const link = links[i];
      if (link.index >= at) continue;
      if (at - link.index > 1200) break;
      if (plausibleTitle(link.text)) { anchor = link; break; }
    }
    if (!anchor) continue;

    const window = md.slice(Math.max(0, at - 400), at + 400);
    const strike = [...window.matchAll(RUPEE_G)].map(m => toNumber(m[1])).filter(n => n && n > price);
    const ratingMatch = window.match(/\b([1-5](?:\.\d)?)\s*(?:\/\s*5|★|stars?\b|out of 5)/i);
    const reviewMatch = window.match(/(\d[\d,]{0,8})\s*(?:ratings?|reviews?)/i) ?? window.match(/\(\s*(\d[\d,]{1,8})\s*\)/);

    rows.push({
      name: anchor.text,
      brand: null,
      price,
      mrp: strike.length ? Math.max(...strike) : null,
      rating: ratingMatch ? toNumber(ratingMatch[1]) : null,
      reviews: reviewMatch ? toNumber(reviewMatch[1]) : null,
      url: absolute(anchor.url, baseUrl),
      image: null,
      inStock: !/out of stock|sold out|notify me|currently unavailable/i.test(window),
      rxRequired: /prescription required|rx required/i.test(window),
    });
  }
  return rows;
}

/* ------------------------------------------------------------------ merge */

/** Collapse duplicates across tiers, keeping the richest record per title+price. */
export function dedupe(rows) {
  const best = new Map();
  for (const row of rows) {
    if (!row?.name || row.price == null) continue;
    const key = row.name.toLowerCase().replace(/[^a-z0-9]/g, '').slice(0, 60) + '|' + Math.round(row.price);
    const existing = best.get(key);
    if (!existing) { best.set(key, row); continue; }
    best.set(key, {
      ...existing,
      ...Object.fromEntries(Object.entries(row).filter(([, v]) => v != null && v !== '')),
      rating: existing.rating ?? row.rating,
      reviews: Math.max(existing.reviews ?? 0, row.reviews ?? 0) || null,
    });
  }
  return [...best.values()];
}

export function extractProducts({ body, format, baseUrl }) {
  const tiers = [];
  if (format === 'html') {
    tiers.push(['json-ld', fromJsonLd(body, baseUrl)]);
    tiers.push(['spa-state', fromSpaState(body, baseUrl)]);
    tiers.push(['dom', fromDom(body, baseUrl)]);
  } else {
    tiers.push(['markdown', fromMarkdown(body, baseUrl)]);
  }

  const used = [];
  let all = [];
  for (const [tier, rows] of tiers) {
    if (rows.length) { used.push(`${tier}:${rows.length}`); all = all.concat(rows); }
  }
  return { rows: dedupe(all), tiers: used };
}

export { toNumber, clean, plausibleTitle };
