/**
 * Registry of every platform Scraper Studio targets.
 *
 * `searchUrl`  - where a keyword search lives on that site.
 * `kind`       - quick_commerce (10-30 min riders, metro-limited) vs pharmacy
 *                (courier, near-nationwide) vs marketplace. Drives the delivery model.
 * `service`    - how the pincode serviceability verdict is derived.
 * `delivery`   - baseline ETA in minutes, refined per pincode at query time.
 *
 * Search URLs drift. That is precisely what the 12-hourly self-heal exists for:
 * when a company's scrape returns nothing, `scrape/heal.js` sends the failure to
 * Bright Data Scraper Studio's AI healer instead of waiting for a human.
 */
export const COMPANIES = [
  {
    slug: 'blinkit', name: 'Blinkit', kind: 'quick_commerce', accent: '#F8CB46',
    browserRestricted: true,
    home: 'https://blinkit.com',
    searchUrl: q => `https://blinkit.com/s/?q=${encodeURIComponent(q)}`,
    delivery: { baseMinutes: 12, spreadMinutes: 8, freeAbove: 199, fee: 25 },
    service: { mode: 'metro', tiers: [1], note: 'Dark-store network; 10-20 min in covered metros only.' },
  },
  {
    slug: 'zepto', name: 'Zepto', kind: 'quick_commerce', accent: '#5B1BB0',
    home: 'https://www.zeptonow.com',
    searchUrl: q => `https://www.zeptonow.com/search?query=${encodeURIComponent(q)}`,
    delivery: { baseMinutes: 10, spreadMinutes: 8, freeAbove: 199, fee: 25 },
    service: { mode: 'metro', tiers: [1], note: 'Dense dark-store coverage in top metros.' },
  },
  {
    slug: 'swiggy-instamart', name: 'Swiggy Instamart', kind: 'quick_commerce', accent: '#FC8019',
    home: 'https://www.swiggy.com/instamart',
    searchUrl: q => `https://www.swiggy.com/instamart/search?custom_back=true&query=${encodeURIComponent(q)}`,
    delivery: { baseMinutes: 15, spreadMinutes: 10, freeAbove: 199, fee: 25 },
    service: { mode: 'metro', tiers: [1, 2], note: 'Instamart stores across metros and large tier-2 cities.' },
  },
  {
    slug: 'flipkart-health', name: 'Flipkart Health+', kind: 'marketplace', accent: '#2874F0',
    home: 'https://healthplus.flipkart.com',
    retired: 'healthplus.flipkart.com no longer resolves - the service was folded back into Flipkart.',
    searchUrl: q => `https://healthplus.flipkart.com/search?q=${encodeURIComponent(q)}`,
    delivery: { baseMinutes: 2160, spreadMinutes: 1440, freeAbove: 499, fee: 40 },
    service: { mode: 'national', tiers: [1, 2, 3], note: 'Courier delivery nationwide, 1-3 days typical.' },
  },
  {
    slug: 'pharmeasy', name: 'PharmEasy', kind: 'pharmacy', accent: '#10847E',
    browserRestricted: true,
    home: 'https://pharmeasy.in',
    searchUrl: q => `https://pharmeasy.in/search/all?name=${encodeURIComponent(q)}`,
    delivery: { baseMinutes: 1440, spreadMinutes: 1440, freeAbove: 499, fee: 49 },
    service: { mode: 'national', tiers: [1, 2, 3], note: 'Pan-India courier; same-day in select metros.' },
  },
  {
    slug: 'amazon', name: 'Amazon', kind: 'marketplace', accent: '#FF9900',
    home: 'https://www.amazon.in',
    searchUrl: q => `https://www.amazon.in/s?k=${encodeURIComponent(q)}&i=hpc`,
    delivery: { baseMinutes: 1440, spreadMinutes: 1440, freeAbove: 499, fee: 40 },
    service: { mode: 'national', tiers: [1, 2, 3], note: 'Widest pincode reach of any player here.' },
  },
  {
    slug: 'apollo-247', name: 'Apollo 24|7', kind: 'pharmacy', accent: '#00695C',
    home: 'https://www.apollopharmacy.in',
    searchUrl: q => `https://www.apollopharmacy.in/search-medicines/${encodeURIComponent(q)}`,
    delivery: { baseMinutes: 240, spreadMinutes: 720, freeAbove: 499, fee: 45 },
    service: { mode: 'national', tiers: [1, 2, 3], note: '5000+ physical stores enable 2-4 h delivery near a store.' },
  },
  {
    slug: 'tata-1mg', name: 'Tata 1mg', kind: 'pharmacy', accent: '#FF6F61',
    home: 'https://www.1mg.com',
    searchUrl: q => `https://www.1mg.com/search/all?name=${encodeURIComponent(q)}`,
    delivery: { baseMinutes: 720, spreadMinutes: 900, freeAbove: 399, fee: 45 },
    service: { mode: 'national', tiers: [1, 2, 3], note: 'Express same-day in metros, courier elsewhere.' },
  },
  {
    slug: 'netmeds', name: 'Netmeds', kind: 'pharmacy', accent: '#00A0A0',
    home: 'https://www.netmeds.com',
    searchUrl: q => `https://www.netmeds.com/catalogsearch/result/${encodeURIComponent(q)}/all`,
    delivery: { baseMinutes: 1440, spreadMinutes: 1440, freeAbove: 500, fee: 49 },
    service: { mode: 'national', tiers: [1, 2, 3], note: 'Reliance-backed courier network, pan-India.' },
  },
  {
    slug: 'medplusmart', name: 'MedPlus Mart', kind: 'pharmacy', accent: '#0F9D58',
    home: 'https://www.medplusmart.com',
    searchUrl: q => `https://www.medplusmart.com/search?q=${encodeURIComponent(q)}`,
    delivery: { baseMinutes: 300, spreadMinutes: 900, freeAbove: 300, fee: 40 },
    service: { mode: 'regional', tiers: [1, 2], states: ['TS', 'AP', 'KA', 'TN', 'MH', 'WB', 'OR'],
      note: 'Strongest in South India where its own stores are dense.' },
  },
  {
    slug: 'medibuddy', name: 'MediBuddy', kind: 'pharmacy', accent: '#1A73E8',
    home: 'https://www.medibuddy.in',
    searchUrl: q => `https://www.medibuddy.in/buy-medicines?search=${encodeURIComponent(q)}`,
    delivery: { baseMinutes: 1440, spreadMinutes: 1440, freeAbove: 499, fee: 49 },
    service: { mode: 'national', tiers: [1, 2], note: 'Corporate-health led; metro and tier-2 coverage.' },
  },
  {
    slug: 'healthhug', name: 'HealthHug', kind: 'pharmacy', accent: '#7C4DFF',
    retired: 'healthhug.com publishes health articles, not a product catalogue.',
    home: 'https://healthhug.com',
    searchUrl: q => `https://healthhug.com/?s=${encodeURIComponent(q)}&post_type=product`,
    delivery: { baseMinutes: 2880, spreadMinutes: 1440, freeAbove: 999, fee: 60 },
    service: { mode: 'national', tiers: [1, 2, 3], note: 'Niche catalogue; slower courier fulfilment.' },
  },
];

/**
 * Companies a refresh should actually spend Bright Data budget on.
 *
 * A `retired` entry stays in the registry so the UI can explain *why* it is gone -
 * silently deleting it would make the platform count drift with no record. It is
 * simply never scraped again.
 */
export const ACTIVE_COMPANIES = COMPANIES.filter(c => !c.retired);
export const RETIRED_COMPANIES = COMPANIES.filter(c => c.retired);

export const BY_SLUG = new Map(COMPANIES.map(c => [c.slug, c]));
export const getCompany = slug => BY_SLUG.get(slug);
export const companySlugs = () => COMPANIES.map(c => c.slug);
