/**
 * Offer ranking.
 *
 * Ordering is deterministic and computed in code, not by the model. A shopping result has
 * a right answer - the cheapest landed cost, or the earliest arrival - and that must not
 * drift between runs or depend on whether Ollama happens to be installed. The local LLM
 * sits on top: it explains the pick in plain language and flags trade-offs a score cannot.
 *
 * `intent` is one of 'price' | 'speed' | 'balanced'.
 */
import { getCompany } from '../companies.js';
import { deliveryFeeFor, etaFor, formatEta, resolvePincode, serviceabilityFor, confirmedVerdict } from '../pincode.js';
import { chatJson, isAvailable } from './ollama.js';

const INTENT_WEIGHTS = {
  price: { cost: 0.75, speed: 0.10, trust: 0.15 },
  speed: { cost: 0.15, speed: 0.70, trust: 0.15 },
  balanced: { cost: 0.42, speed: 0.38, trust: 0.20 },
};

/** Normalise to 0..1 where 1 is best, guarding the all-equal case. */
function normalise(values, { invert = false } = {}) {
  const finite = values.filter(v => Number.isFinite(v));
  if (!finite.length) return values.map(() => 0.5);
  const min = Math.min(...finite);
  const max = Math.max(...finite);
  if (max === min) return values.map(v => (Number.isFinite(v) ? 1 : 0.35));
  return values.map(v => {
    if (!Number.isFinite(v)) return 0.35;
    const t = (v - min) / (max - min);
    return invert ? 1 - t : t;
  });
}

/**
 * Trust from rating and review volume together. A lone 5-star review must not outrank
 * a 4.4 with twelve thousand, so the rating is damped by log-scaled review count.
 */
function trustScore(rating, reviews) {
  if (!Number.isFinite(rating)) return 0.4;
  const volume = Math.min(1, Math.log10((reviews ?? 0) + 1) / 4);
  const quality = Math.max(0, Math.min(1, (rating - 2.5) / 2.5));
  return 0.35 + 0.65 * (quality * (0.45 + 0.55 * volume));
}

/**
 * Build the comparable offer set: attach serviceability, ETA and true landed cost
 * (price + delivery fee) to every scraped row.
 */
export function buildOffers(rows, { pincode, intent = 'balanced' } = {}) {
  const place = resolvePincode(pincode);

  const offers = rows.map(row => {
    const company = getCompany(row.company_slug ?? row.companySlug);
    if (!company) return null;

    const confirmed = place ? confirmedVerdict(place.pincode, company.slug) : null;
    const modelled = serviceabilityFor(company, place);
    const serviceable = confirmed ? confirmed.serviceable : modelled.serviceable;
    const etaMinutes = serviceable ? (confirmed?.etaMinutes ?? etaFor(company, place)) : null;

    const price = Number(row.price);
    const deliveryFee = serviceable ? deliveryFeeFor(company, price) : null;
    const landedCost = serviceable ? price + (deliveryFee ?? 0) : null;

    return {
      id: row.id,
      company: company.name,
      companySlug: company.slug,
      companyKind: company.kind,
      accent: company.accent,
      productName: row.name,
      brand: row.brand ?? null,
      price,
      mrp: row.mrp ?? null,
      discountPercent: row.mrp && row.mrp > price ? Math.round(((row.mrp - price) / row.mrp) * 100) : null,
      rating: row.rating ?? null,
      reviews: row.reviews ?? null,
      pack: row.pack ?? null,
      image: row.image ?? null,
      url: row.url ?? company.home,
      inStock: row.in_stock !== 0 && row.inStock !== false,
      rxRequired: Boolean(row.rx_required ?? row.rxRequired),
      deliveryFee,
      landedCost,
      etaMinutes,
      etaLabel: serviceable ? formatEta(etaMinutes) : 'Not serviceable',
      serviceable,
      serviceConfidence: confirmed ? 'confirmed' : modelled.confidence,
      serviceReason: confirmed ? confirmed.detail : modelled.reason,
      scrapedAt: row.scraped_at ?? null,
      source: row.source ?? null,
    };
  }).filter(Boolean);

  // Score only what can actually be delivered; the rest is shown separately.
  const deliverable = offers.filter(o => o.serviceable && o.inStock);
  const weights = INTENT_WEIGHTS[intent] ?? INTENT_WEIGHTS.balanced;

  const costScores = normalise(deliverable.map(o => o.landedCost), { invert: true });
  const speedScores = normalise(deliverable.map(o => o.etaMinutes), { invert: true });

  deliverable.forEach((offer, i) => {
    const trust = trustScore(offer.rating, offer.reviews);
    offer.scores = {
      cost: round2(costScores[i]),
      speed: round2(speedScores[i]),
      trust: round2(trust),
    };
    offer.score = round2(
      weights.cost * costScores[i] + weights.speed * speedScores[i] + weights.trust * trust
    );
  });

  deliverable.sort((a, b) => b.score - a.score || a.landedCost - b.landedCost);
  const unavailable = offers.filter(o => !o.serviceable || !o.inStock);

  return { offers: deliverable, unavailable, place, intent };
}

const round2 = n => Math.round(n * 100) / 100;

/** Headline facts the UI shows above the table, computed independently of the LLM. */
export function summarise({ offers, place, intent }) {
  if (!offers.length) return null;
  const cheapest = offers.reduce((a, b) => (a.landedCost <= b.landedCost ? a : b));
  const fastest = offers.reduce((a, b) => ((a.etaMinutes ?? 1e9) <= (b.etaMinutes ?? 1e9) ? a : b));
  const bestRated = offers.reduce((a, b) => (trustScore(a.rating, a.reviews) >= trustScore(b.rating, b.reviews) ? a : b));
  const dearest = offers.reduce((a, b) => (a.landedCost >= b.landedCost ? a : b));

  return {
    recommended: offers[0],
    cheapest,
    fastest,
    bestRated,
    maxSaving: Math.round(dearest.landedCost - cheapest.landedCost),
    companiesCompared: new Set(offers.map(o => o.companySlug)).size,
    offerCount: offers.length,
    place,
    intent,
  };
}

/* --------------------------------------------------------------- LLM layer */

const INTENT_TEXT = {
  price: 'the lowest total cost',
  speed: 'the fastest delivery',
  balanced: 'the best balance of price and delivery speed',
};

/**
 * Ask the local model to explain the ranking. The model never reorders anything - it is
 * given the computed top offers and asked to justify and caveat them.
 */
export async function explain({ query, summary, offers, intent, place }) {
  const fallback = templateExplanation({ query, summary, intent, place });
  if (!summary || !(await isAvailable())) return { ...fallback, source: 'rules' };

  const shortlist = offers.slice(0, 8).map(o => ({
    company: o.company,
    product: o.productName.slice(0, 90),
    price: o.price,
    delivery_fee: o.deliveryFee,
    total: o.landedCost,
    eta: o.etaLabel,
    rating: o.rating,
    reviews: o.reviews,
    rx_required: o.rxRequired,
  }));

  const result = await chatJson([
    {
      role: 'system',
      content:
        'You are a careful Indian healthcare shopping assistant. You are given an ALREADY RANKED ' +
        'list of real offers. Do not reorder them and do not invent products, prices or sellers. ' +
        'Reply as JSON: {"verdict": string, "why": string, "watch_outs": [string], "savings_note": string}. ' +
        'Keep verdict under 30 words and why under 60 words. Mention rupee amounts as "Rs 249".',
    },
    {
      role: 'user',
      content: JSON.stringify({
        searched_for: query,
        delivering_to: place ? `${place.city}, ${place.state} (${place.pincode})` : 'unknown',
        user_wants: INTENT_TEXT[intent] ?? INTENT_TEXT.balanced,
        top_pick: shortlist[0],
        all_offers: shortlist,
        max_saving_vs_costliest: summary.maxSaving,
      }),
    },
  ], { temperature: 0.25 });

  if (!result?.verdict) return { ...fallback, source: 'rules' };
  return {
    verdict: String(result.verdict).slice(0, 260),
    why: String(result.why ?? fallback.why).slice(0, 420),
    watchOuts: Array.isArray(result.watch_outs) ? result.watch_outs.slice(0, 4).map(String) : fallback.watchOuts,
    savingsNote: String(result.savings_note ?? fallback.savingsNote).slice(0, 200),
    source: 'llm',
  };
}

/** Deterministic explanation used when Ollama is absent, and as the LLM's safety net. */
function templateExplanation({ query, summary, intent, place }) {
  if (!summary) {
    return {
      verdict: `No deliverable offers found for "${query}"${place ? ` in ${place.city}` : ''}.`,
      why: 'Either no company stocks this item at that pincode, or the cached data is stale. Try a broader product name.',
      watchOuts: [],
      savingsNote: '',
    };
  }
  const { recommended, cheapest, fastest, maxSaving, companiesCompared } = summary;
  const rupees = n => `Rs ${Math.round(n)}`;

  const watchOuts = [];
  if (recommended.rxRequired) watchOuts.push('This item needs a valid prescription at checkout.');
  if (recommended.deliveryFee > 0) {
    watchOuts.push(`${recommended.company} adds ${rupees(recommended.deliveryFee)} delivery below their free-shipping threshold.`);
  }
  if (cheapest.companySlug !== recommended.companySlug) {
    watchOuts.push(`${cheapest.company} is cheaper at ${rupees(cheapest.landedCost)} but arrives in ${cheapest.etaLabel}.`);
  }
  if (fastest.companySlug !== recommended.companySlug) {
    watchOuts.push(`${fastest.company} is fastest at ${fastest.etaLabel} for ${rupees(fastest.landedCost)}.`);
  }
  if (!recommended.rating) watchOuts.push('This listing has no rating yet, so quality is unverified.');

  return {
    verdict: `${recommended.company} at ${rupees(recommended.landedCost)} delivered, arriving in ${recommended.etaLabel}.`,
    why:
      `Compared ${summary.offerCount} offers across ${companiesCompared} platforms for ${INTENT_TEXT[intent] ?? INTENT_TEXT.balanced}. ` +
      `${recommended.company} wins on the blend of landed cost (${rupees(recommended.landedCost)} including delivery), ` +
      `${recommended.etaLabel} delivery${recommended.rating ? `, and a ${recommended.rating}star rating from ${(recommended.reviews ?? 0).toLocaleString('en-IN')} reviews` : ''}.`,
    watchOuts: watchOuts.slice(0, 4),
    savingsNote: maxSaving > 0
      ? `Picking this over the costliest option saves ${rupees(maxSaving)}.`
      : 'All deliverable offers are priced similarly.',
  };
}
