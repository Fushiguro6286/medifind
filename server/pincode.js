/**
 * Pincode resolution and per-company serviceability.
 *
 * Indian PIN codes are hierarchical: the first digit is a zone, the first two identify
 * a postal circle (roughly a state), and the first three a sorting district. That is
 * enough to place a pincode in a state and a city tier without a licensed dataset,
 * which is what the delivery model needs.
 *
 * Live serviceability is confirmed per company during the scrape when the site exposes
 * it; everything else falls back to the structural model below, and every verdict
 * carries a `confidence` so the UI never presents a guess as a fact.
 */
import { getCompany, ACTIVE_COMPANIES } from './companies.js';
import { cachePincode, db } from './db.js';

/** First two digits -> postal circle. */
const CIRCLE = {
  11: ['Delhi', 'DL'], 12: ['Haryana', 'HR'], 13: ['Haryana', 'HR'], 14: ['Punjab', 'PB'],
  15: ['Punjab', 'PB'], 16: ['Chandigarh', 'CH'], 17: ['Himachal Pradesh', 'HP'],
  18: ['Jammu & Kashmir', 'JK'], 19: ['Jammu & Kashmir', 'JK'],
  20: ['Uttar Pradesh', 'UP'], 21: ['Uttar Pradesh', 'UP'], 22: ['Uttar Pradesh', 'UP'],
  23: ['Uttar Pradesh', 'UP'], 24: ['Uttar Pradesh', 'UP'], 25: ['Uttarakhand', 'UK'],
  26: ['Uttar Pradesh', 'UP'], 27: ['Uttar Pradesh', 'UP'], 28: ['Uttar Pradesh', 'UP'],
  30: ['Rajasthan', 'RJ'], 31: ['Rajasthan', 'RJ'], 32: ['Rajasthan', 'RJ'], 33: ['Rajasthan', 'RJ'],
  34: ['Rajasthan', 'RJ'], 36: ['Gujarat', 'GJ'], 37: ['Gujarat', 'GJ'], 38: ['Gujarat', 'GJ'],
  39: ['Gujarat', 'GJ'], 40: ['Maharashtra', 'MH'], 41: ['Maharashtra', 'MH'], 42: ['Maharashtra', 'MH'],
  43: ['Maharashtra', 'MH'], 44: ['Maharashtra', 'MH'], 45: ['Madhya Pradesh', 'MP'],
  46: ['Madhya Pradesh', 'MP'], 47: ['Madhya Pradesh', 'MP'], 48: ['Madhya Pradesh', 'MP'],
  49: ['Chhattisgarh', 'CG'], 50: ['Telangana', 'TS'], 51: ['Andhra Pradesh', 'AP'],
  52: ['Andhra Pradesh', 'AP'], 53: ['Andhra Pradesh', 'AP'], 56: ['Karnataka', 'KA'],
  57: ['Karnataka', 'KA'], 58: ['Karnataka', 'KA'], 59: ['Karnataka', 'KA'],
  60: ['Tamil Nadu', 'TN'], 61: ['Tamil Nadu', 'TN'], 62: ['Tamil Nadu', 'TN'],
  63: ['Tamil Nadu', 'TN'], 64: ['Tamil Nadu', 'TN'], 67: ['Kerala', 'KL'], 68: ['Kerala', 'KL'],
  69: ['Kerala', 'KL'], 70: ['West Bengal', 'WB'], 71: ['West Bengal', 'WB'], 72: ['West Bengal', 'WB'],
  73: ['West Bengal', 'WB'], 74: ['West Bengal', 'WB'], 75: ['Odisha', 'OR'], 76: ['Odisha', 'OR'],
  77: ['Odisha', 'OR'], 78: ['Assam', 'AS'], 79: ['Arunachal / NE', 'NE'], 80: ['Bihar', 'BR'],
  81: ['Bihar', 'BR'], 82: ['Jharkhand', 'JH'], 83: ['Jharkhand', 'JH'], 84: ['Bihar', 'BR'],
  85: ['Bihar', 'BR'],
};

/** Three-digit prefixes for the cities where quick commerce actually operates. */
const CITY = {
  110: ['New Delhi', 1], 111: ['Delhi', 1], 112: ['Delhi NCR', 1], 121: ['Faridabad', 1],
  122: ['Gurugram', 1], 123: ['Rewari', 3], 124: ['Rohtak', 3], 125: ['Hisar', 3],
  131: ['Sonipat', 2], 132: ['Panipat', 2], 133: ['Ambala', 3], 134: ['Panchkula', 2],
  140: ['Mohali', 2], 141: ['Ludhiana', 2], 143: ['Amritsar', 2], 144: ['Jalandhar', 2],
  160: ['Chandigarh', 1], 201: ['Ghaziabad', 1], 203: ['Noida', 1], 226: ['Lucknow', 2],
  208: ['Kanpur', 2], 221: ['Varanasi', 2], 282: ['Agra', 2], 250: ['Meerut', 2],
  248: ['Dehradun', 2], 302: ['Jaipur', 1], 313: ['Udaipur', 3], 342: ['Jodhpur', 3],
  380: ['Ahmedabad', 1], 390: ['Vadodara', 2], 395: ['Surat', 1], 360: ['Rajkot', 2],
  400: ['Mumbai', 1], 401: ['Mumbai (Vasai)', 1], 410: ['Navi Mumbai', 1], 411: ['Pune', 1],
  412: ['Pune', 1], 413: ['Solapur', 3], 421: ['Thane', 1], 422: ['Nashik', 2],
  440: ['Nagpur', 1], 431: ['Aurangabad', 2], 452: ['Indore', 1], 462: ['Bhopal', 2],
  482: ['Jabalpur', 3], 492: ['Raipur', 2], 500: ['Hyderabad', 1], 501: ['Hyderabad', 1],
  502: ['Hyderabad', 1], 530: ['Visakhapatnam', 2], 520: ['Vijayawada', 2], 560: ['Bengaluru', 1],
  561: ['Bengaluru', 1], 562: ['Bengaluru', 1], 570: ['Mysuru', 2], 575: ['Mangaluru', 2],
  580: ['Hubballi', 3], 600: ['Chennai', 1], 601: ['Chennai', 1], 602: ['Chennai', 1],
  603: ['Chennai', 1], 620: ['Tiruchirappalli', 3], 625: ['Madurai', 2], 641: ['Coimbatore', 2],
  682: ['Kochi', 2], 695: ['Thiruvananthapuram', 2], 673: ['Kozhikode', 3],
  700: ['Kolkata', 1], 711: ['Howrah', 1], 712: ['Hooghly', 2], 713: ['Durgapur', 3],
  751: ['Bhubaneswar', 2], 781: ['Guwahati', 2], 800: ['Patna', 2], 834: ['Ranchi', 2],
  842: ['Muzaffarpur', 3], 831: ['Jamshedpur', 3],
};

export function isValidPincode(pincode) {
  return /^[1-9][0-9]{5}$/.test(String(pincode ?? '').trim());
}

export function resolvePincode(pincode) {
  const pin = String(pincode ?? '').trim();
  if (!isValidPincode(pin)) return null;

  const three = Number(pin.slice(0, 3));
  const two = Number(pin.slice(0, 2));
  const [city, tier] = CITY[three] ?? [];
  const [state, stateCode] = CIRCLE[two] ?? ['India', 'IN'];

  return {
    pincode: pin,
    city: city ?? `${state} (${pin.slice(0, 3)}xxx)`,
    state,
    stateCode,
    // Unlisted districts are treated as tier 3: courier reach, no rider network.
    tier: tier ?? 3,
    isMetro: (tier ?? 3) === 1,
  };
}

/**
 * Structural serviceability verdict for one company at one pincode.
 * `confidence` is 'confirmed' only when the scrape itself proved it.
 */
export function serviceabilityFor(company, place) {
  if (!place) return { serviceable: false, confidence: 'unknown', reason: 'Invalid pincode' };
  const { mode, tiers, states, note } = company.service;

  if (mode === 'regional') {
    const inState = states.includes(place.stateCode);
    return {
      serviceable: inState && tiers.includes(place.tier),
      confidence: 'modelled',
      reason: inState
        ? `${company.name} operates in ${place.state}.`
        : `${company.name} has no store network in ${place.state}.`,
      note,
    };
  }

  const covered = tiers.includes(place.tier);
  return {
    serviceable: covered,
    confidence: 'modelled',
    reason: covered
      ? (mode === 'metro'
        ? `${place.city} is inside ${company.name}'s dark-store network.`
        : `${company.name} couriers to ${place.city}.`)
      : (mode === 'metro'
        ? `${company.name} does not run dark stores in ${place.city} yet.`
        : `${place.city} is outside ${company.name}'s usual delivery reach.`),
    note,
  };
}

/**
 * Delivery ETA in minutes. Quick commerce degrades sharply outside its core metros;
 * couriers scale with distance from the nearest fulfilment hub, approximated by tier.
 */
export function etaFor(company, place) {
  if (!place) return null;
  const { baseMinutes, spreadMinutes } = company.delivery;
  const tierPenalty = { 1: 0, 2: 0.45, 3: 1 }[place.tier] ?? 1;

  if (company.kind === 'quick_commerce') {
    return Math.round(baseMinutes + spreadMinutes * tierPenalty);
  }
  // Couriers: tier-1 beats the baseline, tier-3 pays the full spread.
  return Math.round(baseMinutes * (0.6 + 0.4 * tierPenalty) + spreadMinutes * tierPenalty);
}

export function formatEta(minutes) {
  if (minutes == null) return 'Unknown';
  if (minutes < 60) return `${minutes} min`;
  if (minutes < 24 * 60) return `${Math.round(minutes / 60)} hr`;
  const days = Math.round(minutes / (24 * 60));
  return days === 1 ? 'Next day' : `${days} days`;
}

/** Delivery fee for a basket of `orderValue` at this company. */
export function deliveryFeeFor(company, orderValue) {
  const { freeAbove, fee } = company.delivery;
  return orderValue >= freeAbove ? 0 : fee;
}

/** Full serviceability map for every company at a pincode, cached in SQLite. */
export function serviceabilityMap(pincode) {
  const place = resolvePincode(pincode);
  const out = {};
  for (const company of ACTIVE_COMPANIES) {
    const verdict = serviceabilityFor(company, place);
    const eta = verdict.serviceable ? etaFor(company, place) : null;
    out[company.slug] = { ...verdict, etaMinutes: eta, etaLabel: formatEta(eta) };
    if (place) cachePincode(place.pincode, company.slug, verdict.serviceable, eta, verdict.reason);
  }
  return { place, companies: out };
}

/** A scrape that proves serviceability overrides the model. */
export function recordConfirmedServiceability(pincode, slug, serviceable, etaMinutes, detail) {
  if (!isValidPincode(pincode) || !getCompany(slug)) return;
  cachePincode(pincode, slug, serviceable, etaMinutes, `confirmed: ${detail ?? ''}`.trim());
}

export function confirmedVerdict(pincode, slug) {
  const row = db.prepare(
    'SELECT serviceable, eta_minutes, detail FROM pincode_cache WHERE pincode = ? AND company_slug = ?'
  ).get(pincode, slug);
  if (!row || !String(row.detail ?? '').startsWith('confirmed')) return null;
  return { serviceable: Boolean(row.serviceable), etaMinutes: row.eta_minutes, detail: row.detail };
}
