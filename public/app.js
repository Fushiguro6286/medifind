/* MediFind client. No framework: one page, a set of small controllers. */

const $ = sel => document.querySelector(sel);
const $$ = sel => [...document.querySelectorAll(sel)];
const el = (tag, cls, text) => {
  const node = document.createElement(tag);
  if (cls) node.className = cls;
  if (text != null) node.textContent = text;
  return node;
};
const rupee = n => (n == null ? '—' : `₹${Math.round(n).toLocaleString('en-IN')}`);
const escapeHtml = s => String(s ?? '').replace(/[&<>"']/g, c =>
  ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));

const ICONS = {
  star: '<svg viewBox="0 0 24 24" fill="currentColor"><path d="m12 17.3-5.4 3.2 1.4-6.1L3.3 10l6.2-.5L12 3.8l2.5 5.7 6.2.5-4.7 4.4 1.4 6.1z"/></svg>',
  clock: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"><circle cx="12" cy="12" r="9"/><path d="M12 7v5.2l3.2 2"/></svg>',
  truck: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M2 7h11v9H2zM13 10h4l3 3v3h-7z"/><circle cx="6" cy="18" r="1.8"/><circle cx="17" cy="18" r="1.8"/></svg>',
  arrow: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round"><path d="M7 17 17 7M9 7h8v8"/></svg>',
  spark: '<svg viewBox="0 0 24 24" fill="currentColor"><path d="M12 2.5 14 9l6.5 2-6.5 2-2 6.5-2-6.5L3.5 11 10 9z"/></svg>',
  alert: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"><path d="M12 8.5v5M12 17h.01"/><path d="M10.3 3.9 2.5 18a2 2 0 0 0 1.7 3h15.6a2 2 0 0 0 1.7-3L13.7 3.9a2 2 0 0 0-3.4 0Z"/></svg>',
  rx: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M5 20V5h4a3.5 3.5 0 0 1 0 7H5m6 0 8 8m0-8-8 8"/></svg>',
  pill: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><rect x="2.5" y="8" width="19" height="8" rx="4" transform="rotate(-45 12 12)"/><path d="M8.5 8.5 15.5 15.5"/></svg>',
  device: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"><rect x="4" y="3" width="16" height="18" rx="3"/><path d="M8 12h2l1.5-3 2 6 1.5-3H16"/></svg>',
  box: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linejoin="round"><path d="m12 3 8 4.2v9.6L12 21l-8-4.2V7.2z"/><path d="M12 12v9M4 7.2l8 4.8 8-4.8"/></svg>',
  trend: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"><path d="m3 16 5.5-5.5 4 4L21 6"/><path d="M15 6h6v6"/></svg>',
  scale: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M12 3v18M5 8h14M7.5 8 5 14.5h5L7.5 8ZM16.5 8 14 14.5h5L16.5 8Z"/></svg>',
  bell: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M18 9a6 6 0 1 0-12 0c0 5-2 6-2 6h16s-2-1-2-6Z"/><path d="M13.7 20a2 2 0 0 1-3.4 0"/></svg>',
  panel: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><rect x="3" y="4" width="18" height="16" rx="3"/><path d="M9 4v16"/></svg>',
  bolt: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M13 2 4.5 13.5H11L10 22l8.5-11.5H12L13 2Z"/></svg>',
  heal: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M20.5 13A8.5 8.5 0 1 1 18 6.6"/><path d="M21 3v5h-5"/></svg>',
};
const CATEGORY_ICON = { medicine: ICONS.pill, device: ICONS.device, supply: ICONS.box, wellness: ICONS.pill };

/** Which Bright Data product produced a row. Surfaced on every card. */
const SOURCE_LABEL = {
  studio: 'Studio',
  browser: 'Browser API',
  unlocker: 'Unlocker',
};

/* ------------------------------------------------------------- state --- */
const store = {
  get(key, fallback) {
    try { return JSON.parse(localStorage.getItem(key)) ?? fallback; } catch { return fallback; }
  },
  set(key, value) {
    try { localStorage.setItem(key, JSON.stringify(value)); } catch { /* private mode */ }
  },
};

const state = {
  intent: localStorage.getItem('mf:intent') || 'balanced',
  pincode: localStorage.getItem('mf:pin') || '',
  sort: 'best',
  result: null,
  companies: [],
  trackedQueries: [],
  picked: [],                       // offer ids staged for comparison
  watchlist: store.get('mf:watch', []),
  filters: { rx: false, free: false, rated: false, maxPct: 100 },
};

const api = async (path, options) => {
  const res = await fetch(path, options);
  const body = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(body.error || `Request failed (${res.status})`);
  return body;
};

let toastTimer;
function toast(message, ms = 3200) {
  const node = $('#toast');
  node.textContent = message;
  node.hidden = false;
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => { node.hidden = true; }, ms);
}

const ago = ts => {
  if (!ts) return 'never';
  const mins = Math.round((Date.now() - ts) / 60000);
  if (mins < 1) return 'just now';
  if (mins < 60) return `${mins} min ago`;
  if (mins < 1440) return `${Math.round(mins / 60)} h ago`;
  return `${Math.round(mins / 1440)} d ago`;
};

/* ------------------------------------------------------------- theme --- */
const applyTheme = mode => {
  document.documentElement.dataset.theme = mode;
  localStorage.setItem('mf:theme', mode);
};
applyTheme(localStorage.getItem('mf:theme')
  || (matchMedia('(prefers-color-scheme: dark)').matches ? 'dark' : 'light'));
$('#themeToggle').addEventListener('click', () =>
  applyTheme(document.documentElement.dataset.theme === 'dark' ? 'light' : 'dark'));

/* ---------------------------------------------------------- autocomplete */
const input = $('#q');
const list = $('#suggestList');
let items = [];
let cursor = -1;
let debounce;
let lastToken = 0;

function closeSuggestions() {
  list.hidden = true;
  list.innerHTML = '';
  items = [];
  cursor = -1;
  input.setAttribute('aria-expanded', 'false');
}

function highlight(text, query) {
  const q = query.trim().toLowerCase();
  const idx = text.toLowerCase().indexOf(q);
  if (!q || idx === -1) return escapeHtml(text);
  return escapeHtml(text.slice(0, idx))
    + '<mark>' + escapeHtml(text.slice(idx, idx + q.length)) + '</mark>'
    + escapeHtml(text.slice(idx + q.length));
}

function renderSuggestions(payload, query) {
  items = payload.suggestions ?? [];
  list.innerHTML = '';

  if (payload.didYouMean?.corrected) {
    const li = el('li', 'sug-fix');
    li.setAttribute('role', 'option');
    li.innerHTML =
      `<span class="sug-icon">${ICONS.spark}</span>` +
      `<span class="sug-main"><span class="sug-name">Did you mean <mark>${escapeHtml(payload.didYouMean.corrected)}</mark>?</span></span>`;
    li.addEventListener('mousedown', e => {
      e.preventDefault();
      input.value = payload.didYouMean.corrected;
      closeSuggestions();
      runSearch();
    });
    list.appendChild(li);
    items = [{ query: payload.didYouMean.corrected, display: payload.didYouMean.corrected }, ...items];
  }

  for (const item of payload.suggestions ?? []) {
    const li = el('li');
    li.setAttribute('role', 'option');
    li.setAttribute('aria-selected', 'false');
    const meta = item.minPrice != null
      ? `from ${rupee(item.minPrice)}`
      : (item.companies ? `${item.companies} sellers` : '');
    li.innerHTML =
      `<span class="sug-icon">${CATEGORY_ICON[item.category] ?? ICONS.trend}</span>` +
      `<span class="sug-main">` +
        `<span class="sug-name">${highlight(item.display, query)}</span>` +
        (item.categoryLabel ? `<span class="sug-sub">${escapeHtml(item.categoryLabel)}</span>` : '') +
      `</span>` +
      (meta ? `<span class="sug-meta">${escapeHtml(meta)}</span>` : '');
    li.addEventListener('mousedown', e => {
      e.preventDefault();
      input.value = item.query;
      closeSuggestions();
      runSearch();
    });
    list.appendChild(li);
  }

  const has = list.children.length > 0;
  list.hidden = !has;
  input.setAttribute('aria-expanded', String(has));
  cursor = -1;
}

function moveCursor(step) {
  const nodes = [...list.children];
  if (!nodes.length) return;
  nodes[cursor]?.setAttribute('aria-selected', 'false');
  cursor = (cursor + step + nodes.length) % nodes.length;
  const active = nodes[cursor];
  active.setAttribute('aria-selected', 'true');
  active.scrollIntoView({ block: 'nearest' });
  if (items[cursor]) input.value = items[cursor].query ?? items[cursor].display;
}

input.addEventListener('input', () => {
  const query = input.value;
  clearTimeout(debounce);
  if (!query.trim()) { closeSuggestions(); return; }
  // Short debounce so the list feels instantaneous while typing.
  debounce = setTimeout(async () => {
    const token = ++lastToken;
    try {
      const payload = await api(`/api/suggest?q=${encodeURIComponent(query)}`);
      if (token !== lastToken) return;   // a newer keystroke already answered
      renderSuggestions(payload, query);
    } catch { /* suggestions are best-effort */ }
  }, 110);
});

input.addEventListener('keydown', e => {
  if (list.hidden) return;
  if (e.key === 'ArrowDown') { e.preventDefault(); moveCursor(1); }
  else if (e.key === 'ArrowUp') { e.preventDefault(); moveCursor(-1); }
  else if (e.key === 'Enter' && cursor >= 0) { e.preventDefault(); closeSuggestions(); runSearch(); }
  else if (e.key === 'Escape') closeSuggestions();
});

document.addEventListener('click', e => {
  if (!e.target.closest('.field-product')) closeSuggestions();
});

/* -------------------------------------------------------------- pincode */
const pinInput = $('#pin');
const pinHint = $('#pinHint');
pinInput.value = state.pincode;

let pinTimer;
async function checkPincode() {
  const pin = pinInput.value.trim();
  pinHint.className = 'pin-hint';
  if (!pin) { pinHint.textContent = ''; return; }
  if (!/^[1-9][0-9]{5}$/.test(pin)) {
    pinHint.textContent = pin.length === 6 ? 'Not a valid Indian pincode' : '6 digits required';
    pinHint.classList.add('bad');
    return;
  }
  try {
    const { place, companies } = await api(`/api/pincode/${pin}`);
    const entries = Object.values(companies);
    const live = entries.filter(c => c.serviceable).length;
    pinHint.textContent = `${place.city}, ${place.state} · ${live}/${entries.length} platforms deliver here`;
    pinHint.classList.add('ok');
    state.pincode = pin;
    localStorage.setItem('mf:pin', pin);
  } catch {
    pinHint.textContent = 'Could not check that pincode';
    pinHint.classList.add('bad');
  }
}
pinInput.addEventListener('input', () => { clearTimeout(pinTimer); pinTimer = setTimeout(checkPincode, 300); });
if (state.pincode) checkPincode();

/* --------------------------------------------------------------- intent */
function setIntent(value, { rerun = true } = {}) {
  state.intent = value;
  localStorage.setItem('mf:intent', value);
  for (const chip of $$('.chip[data-intent]')) {
    const on = chip.dataset.intent === value;
    chip.classList.toggle('is-active', on);
    chip.setAttribute('aria-checked', String(on));
  }
  if (rerun && state.result) runSearch();
}
setIntent(state.intent, { rerun: false });
for (const chip of $$('.chip[data-intent]')) {
  chip.addEventListener('click', () => setIntent(chip.dataset.intent));
}

/* ---------------------------------------------------------------- sort */
for (const button of $$('#sortGroup button')) {
  button.addEventListener('click', () => {
    state.sort = button.dataset.sort;
    for (const other of $$('#sortGroup button')) other.classList.toggle('is-active', other === button);
    if (state.result) renderOffers(state.result);
  });
}

/* -------------------------------------------------------------- filters */
const filterBar = $('#filterBar');
const bindFilter = (id, key) => $(id).addEventListener('change', e => {
  state.filters[key] = e.target.checked;
  if (state.result) renderOffers(state.result);
});
bindFilter('#fRx', 'rx');
bindFilter('#fFree', 'free');
bindFilter('#fRated', 'rated');

$('#fMax').addEventListener('input', e => {
  state.filters.maxPct = Number(e.target.value);
  const offers = state.result?.offers ?? [];
  const ceiling = offers.length ? Math.max(...offers.map(o => o.landedCost)) : 0;
  $('#fMaxOut').textContent = state.filters.maxPct >= 100
    ? 'any'
    : rupee((ceiling * state.filters.maxPct) / 100);
  if (state.result) renderOffers(state.result);
});

/** The budget slider is a percentage of the dearest offer, so it rescales per search. */
function resetFilters() {
  state.filters = { rx: false, free: false, rated: false, maxPct: 100 };
  $('#fRx').checked = $('#fFree').checked = $('#fRated').checked = false;
  $('#fMax').value = 100;
  $('#fMaxOut').textContent = 'any';
}

function applyFilters(offers) {
  const ceiling = offers.length ? Math.max(...offers.map(o => o.landedCost)) : 0;
  const cap = (ceiling * state.filters.maxPct) / 100;
  return offers.filter(o => {
    if (state.filters.rx && o.rxRequired) return false;
    if (state.filters.free && o.deliveryFee > 0) return false;
    if (state.filters.rated && !(o.rating >= 4)) return false;
    if (state.filters.maxPct < 100 && o.landedCost > cap) return false;
    return true;
  });
}

/* -------------------------------------------------------------- search */
$('#searchForm').addEventListener('submit', e => { e.preventDefault(); runSearch(); });

function showSkeleton(query) {
  $('#emptyState').hidden = true;
  const results = $('#results');
  results.hidden = false;
  $('#resultTitle').textContent = query;
  $('#resultMeta').textContent = 'Checking the cache, then scraping anything missing…';
  $('#verdict').innerHTML = '';
  $('#statRow').innerHTML = '';
  $('#coverage').innerHTML = '';
  $('#unavailable').innerHTML = '';
  filterBar.hidden = true;
  const grid = $('#offerGrid');
  const count = state.companies.filter(c => !c.retired).length || 10;
  grid.innerHTML =
    `<div class="progress-note"><span class="spinner"></span>Comparing ${count} platforms — a cold search scrapes live and can take a minute.</div>` +
    '<div class="skeleton">' + '<div class="skel-row"></div>'.repeat(4) + '</div>';
  results.scrollIntoView({ behavior: 'smooth', block: 'start' });
}

async function runSearch() {
  const query = input.value.trim();
  const pincode = pinInput.value.trim();
  if (!query) { input.focus(); toast('Type a product name first.'); return; }
  if (!/^[1-9][0-9]{5}$/.test(pincode)) { pinInput.focus(); toast('Enter a valid 6-digit pincode.'); return; }

  closeSuggestions();
  const button = $('#goBtn');
  button.dataset.busy = '1';
  $('.go-label').textContent = 'Comparing';
  showSkeleton(query);
  state.picked = [];
  renderTray();

  try {
    const result = await api('/api/search', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ query, pincode, intent: state.intent }),
    });
    state.result = result;
    resetFilters();
    render(result);
    checkWatchlist(result);
    // Keep the address bar shareable without adding a history entry per keystroke.
    const url = new URL(location.href);
    url.searchParams.set('q', query);
    url.searchParams.set('pin', pincode);
    url.searchParams.set('intent', state.intent);
    history.replaceState(null, '', url);
  } catch (err) {
    $('#results').hidden = true;
    const empty = $('#emptyState');
    empty.hidden = false;
    empty.innerHTML =
      `<h3>That search did not go through</h3><p>${escapeHtml(err.message)}</p>`;
    empty.appendChild(Object.assign(el('button', 'btn-secondary', 'Try again'), {
      onclick: () => runSearch(),
    }));
  } finally {
    button.removeAttribute('data-busy');
    $('.go-label').textContent = 'Compare';
  }
}

/* -------------------------------------------------------------- render */
function render(result) {
  $('#emptyState').hidden = true;
  $('#results').hidden = false;
  $('#resultTitle').textContent = result.query;

  const bits = [];
  if (result.place) bits.push(`<b>${escapeHtml(result.place.city)}</b>, ${escapeHtml(result.place.state)} · ${result.place.pincode}`);
  if (result.summary) bits.push(`<b>${result.summary.offerCount}</b> offers from <b>${result.summary.companiesCompared}</b> platforms`);
  if (result.meta?.freshness) {
    const mins = result.meta.freshness.ageMinutes;
    bits.push(mins < 60 ? `updated ${mins} min ago` : `updated ${Math.round(mins / 60)} h ago`);
  }
  if (result.meta?.liveScrape) bits.push(`scraped live from ${result.meta.liveScrape} platforms`);
  $('#resultMeta').innerHTML = bits.join(' · ');

  renderVerdict(result);
  renderStats(result);
  renderCoverage(result);
  renderOffers(result);
  renderUnavailable(result);
  filterBar.hidden = (result.offers ?? []).length < 3;
}

function renderVerdict(result) {
  const box = $('#verdict');
  const a = result.analysis;
  if (!a) { box.innerHTML = ''; return; }

  const watchOuts = (a.watchOuts ?? []).map(w =>
    `<li>${ICONS.alert}<span>${escapeHtml(w)}</span></li>`).join('');

  box.innerHTML =
    `<div class="verdict-top">
       <span class="verdict-badge">${ICONS.spark} ${result.summary ? 'Recommended' : 'No match'}</span>
       <span class="verdict-source">${a.source === 'llm' ? 'analysed by local LLM' : 'rule-based analysis'}</span>
     </div>
     <h3>${escapeHtml(a.verdict)}</h3>
     <p>${escapeHtml(a.why)}</p>
     ${a.savingsNote ? `<p><strong>${escapeHtml(a.savingsNote)}</strong></p>` : ''}
     ${watchOuts ? `<ul class="watch-outs">${watchOuts}</ul>` : ''}`;
}

function renderStats(result) {
  const row = $('#statRow');
  const s = result.summary;
  if (!s) { row.innerHTML = ''; return; }

  const stat = (icon, key, value, sub) =>
    `<div class="stat">
       <div class="stat-k">${icon}${escapeHtml(key)}</div>
       <div class="stat-v">${value}</div>
       <div class="stat-sub">${escapeHtml(sub)}</div>
     </div>`;

  row.innerHTML =
    stat(ICONS.trend, 'Best total', rupee(s.recommended.landedCost), `${s.recommended.company} · ${s.recommended.etaLabel}`) +
    stat(ICONS.spark, 'Cheapest', rupee(s.cheapest.landedCost), `${s.cheapest.company} · ${s.cheapest.etaLabel}`) +
    stat(ICONS.clock, 'Fastest', s.fastest.etaLabel, `${s.fastest.company} · ${rupee(s.fastest.landedCost)}`) +
    stat(ICONS.star, 'Top rated', s.bestRated.rating ? `${s.bestRated.rating}<small>/5</small>` : '—',
      `${s.bestRated.company} · ${(s.bestRated.reviews ?? 0).toLocaleString('en-IN')} reviews`) +
    stat(ICONS.truck, 'Max saving', rupee(s.maxSaving), 'cheapest vs costliest');
}

/** Who had this product at all, including the platforms that returned nothing. */
async function renderCoverage(result) {
  const box = $('#coverage');
  box.innerHTML = '';
  try {
    const rows = await api(`/api/coverage?q=${encodeURIComponent(result.query)}`);
    // Retired storefronts are never scraped, so listing them as "0 results" would read
    // as a failure rather than a decision.
    const retired = new Set(state.companies.filter(c => c.retired).map(c => c.slug));
    const list = (rows.companies ?? []).filter(c => !retired.has(c.slug));
    if (!list.length) return;
    box.innerHTML = list.map(c =>
      `<span class="cov${c.hasData ? '' : ' is-empty'}">
         <span class="dot" style="background:${escapeHtml(c.accent)}"></span>
         ${escapeHtml(c.name)}
         ${c.hasData ? `<b>${c.count} · ${rupee(c.minPrice)}+</b>` : '<b>—</b>'}
       </span>`).join('');
  } catch { /* coverage is decoration, never block the result */ }
}

const SORTERS = {
  best:   (a, b) => b.score - a.score,
  price:  (a, b) => a.landedCost - b.landedCost,
  eta:    (a, b) => (a.etaMinutes ?? 1e9) - (b.etaMinutes ?? 1e9),
  rating: (a, b) => (b.rating ?? 0) - (a.rating ?? 0) || (b.reviews ?? 0) - (a.reviews ?? 0),
};

function scoreBars(offer) {
  if (!offer.scores) return '';
  const bar = (cls, label, value) =>
    `<span class="sbar sbar-${cls}" title="${label} score ${Math.round(value * 100)}/100">
       ${label}<span class="sbar-track"><span class="sbar-fill" style="width:${Math.round(value * 100)}%"></span></span>
     </span>`;
  return `<div class="score-bars">
      ${bar('cost', 'cost', offer.scores.cost ?? 0)}
      ${bar('speed', 'speed', offer.scores.speed ?? 0)}
      ${bar('trust', 'trust', offer.scores.trust ?? 0)}
    </div>`;
}

function renderOffers(result) {
  const grid = $('#offerGrid');
  grid.innerHTML = '';

  const all = [...(result.offers ?? [])].sort(SORTERS[state.sort] ?? SORTERS.best);
  const offers = applyFilters(all);
  $('#filterCount').textContent = offers.length === all.length
    ? `${all.length} offers`
    : `${offers.length} of ${all.length} offers`;

  if (!all.length) {
    grid.innerHTML =
      `<div class="empty-state"><h3>No deliverable offers</h3>
       <p>Nothing here ships to ${escapeHtml(result.place?.city ?? 'that pincode')} right now.
          Try a nearby pincode or a broader product name.</p></div>`;
    return;
  }
  if (!offers.length) {
    grid.innerHTML =
      `<div class="empty-state"><h3>Every offer is filtered out</h3>
       <p>Loosen the filters above to see the ${all.length} offers that matched.</p></div>`;
    return;
  }

  const fastestEta = Math.min(...offers.map(o => o.etaMinutes ?? Infinity));
  const watched = new Set(state.watchlist.map(w => w.key));

  offers.forEach((offer, index) => {
    const isTop = index === 0 && state.sort === 'best';
    const card = el('a', 'offer' + (isTop ? ' is-top' : '') + (state.picked.includes(offer.id) ? ' is-picked' : ''));
    card.href = offer.url;
    card.target = '_blank';
    card.rel = 'noopener noreferrer';
    card.style.animationDelay = `${Math.min(index, 10) * 28}ms`;

    const thumb = offer.image
      ? `<div class="offer-thumb"><img src="${escapeHtml(offer.image)}" alt="" loading="lazy"></div>`
      : `<div class="offer-thumb"><span>${escapeHtml(offer.company.slice(0, 1))}</span></div>`;

    const facts = [];
    if (offer.rating) {
      facts.push(`<span class="fact rating">${ICONS.star}<b>${offer.rating}</b>${offer.reviews ? ` (${offer.reviews.toLocaleString('en-IN')})` : ''}</span>`);
    } else {
      facts.push('<span class="fact">No rating yet</span>');
    }
    facts.push(`<span class="fact eta${offer.etaMinutes === fastestEta ? ' fast' : ''}">${ICONS.clock}${escapeHtml(offer.etaLabel)}</span>`);
    facts.push(offer.deliveryFee > 0
      ? `<span class="fact">${ICONS.truck}${rupee(offer.deliveryFee)} delivery</span>`
      : `<span class="fact">${ICONS.truck}Free delivery</span>`);
    if (offer.rxRequired) facts.push(`<span class="fact rx">${ICONS.rx}Prescription</span>`);
    if (offer.pack) facts.push(`<span class="fact">${escapeHtml(offer.pack)}</span>`);

    const source = SOURCE_LABEL[offer.source]
      ? `<span class="src-badge src-${escapeHtml(offer.source)}" title="Scraped through Bright Data ${escapeHtml(SOURCE_LABEL[offer.source])}">${escapeHtml(SOURCE_LABEL[offer.source])}</span>`
      : '';

    const key = watchKey(offer, result.query);
    card.innerHTML =
      (isTop ? '<span class="rank-flag">Best pick</span>' : '') +
      `<div class="offer-actions">
         <button type="button" class="mini-btn pick-btn${state.picked.includes(offer.id) ? ' is-on' : ''}"
                 data-id="${offer.id}" title="Add to comparison" aria-label="Add to comparison">${ICONS.scale}</button>
         <button type="button" class="mini-btn watch-btn${watched.has(key) ? ' is-watched' : ''}"
                 data-id="${offer.id}" title="Watch this price" aria-label="Watch this price">${ICONS.bell}</button>
       </div>` +
      thumb +
      `<div class="offer-main">
         <div class="offer-company">
           <span class="dot" style="background:${escapeHtml(offer.accent)}"></span>
           <b>${escapeHtml(offer.company)}</b>
           <span class="offer-kind">${offer.companyKind === 'quick_commerce' ? 'Quick' : offer.companyKind === 'pharmacy' ? 'Pharmacy' : 'Marketplace'}</span>
           ${source}
         </div>
         <p class="offer-name">${escapeHtml(offer.productName)}</p>
         <div class="offer-facts">${facts.join('')}</div>
         ${scoreBars(offer)}
       </div>
       <div class="offer-price">
         <div>
           <span class="price-now">${rupee(offer.price)}</span>
           ${offer.mrp && offer.mrp > offer.price ? `<span class="price-was">${rupee(offer.mrp)}</span>` : ''}
           ${offer.discountPercent ? `<span class="price-off">${offer.discountPercent}% off</span>` : ''}
         </div>
         <div class="price-total">${rupee(offer.landedCost)} delivered</div>
         <span class="price-cta">Open on ${escapeHtml(offer.company)} ${ICONS.arrow}</span>
       </div>`;

    // A broken product image should fall back to the company initial, not an alt-text stub.
    card.querySelector('.offer-thumb img')?.addEventListener('error', e => {
      e.target.replaceWith(Object.assign(el('span'), { textContent: offer.company.slice(0, 1) }));
    });

    card.querySelector('.pick-btn').addEventListener('click', e => {
      e.preventDefault(); e.stopPropagation();
      togglePick(offer.id);
    });
    card.querySelector('.watch-btn').addEventListener('click', e => {
      e.preventDefault(); e.stopPropagation();
      toggleWatch(offer, result.query);
    });

    grid.appendChild(card);
  });
}

function renderUnavailable(result) {
  const box = $('#unavailable');
  const rows = result.unavailable ?? [];
  if (!rows.length) { box.innerHTML = ''; return; }

  const seen = new Set();
  const pills = [];
  for (const row of rows) {
    if (seen.has(row.companySlug)) continue;
    seen.add(row.companySlug);
    pills.push(
      `<span class="dead" title="${escapeHtml(row.serviceReason ?? '')}">
         <span class="dot" style="background:${escapeHtml(row.accent)};opacity:.5"></span>
         <s>${escapeHtml(row.company)}</s> ${row.inStock === false ? 'out of stock' : 'no delivery here'}
       </span>`);
  }
  box.innerHTML = `<h4>Not available at this pincode</h4><div class="dead-list">${pills.join('')}</div>`;
}

/* ------------------------------------------------------- compare tray -- */
const findOffer = id => (state.result?.offers ?? []).find(o => o.id === id);

function togglePick(id) {
  const at = state.picked.indexOf(id);
  if (at >= 0) state.picked.splice(at, 1);
  else if (state.picked.length >= 4) { toast('Compare up to four offers at a time.'); return; }
  else state.picked.push(id);
  renderTray();
  if (state.result) renderOffers(state.result);
}

function renderTray() {
  const tray = $('#tray');
  if (!state.picked.length) { tray.hidden = true; return; }
  tray.hidden = false;
  $('#trayItems').innerHTML = state.picked.map(id => {
    const offer = findOffer(id);
    if (!offer) return '';
    return `<span class="tray-item">
        <span class="dot" style="background:${escapeHtml(offer.accent)}"></span>
        <span>${escapeHtml(offer.company)} · ${rupee(offer.landedCost)}</span>
        <button type="button" data-id="${id}" aria-label="Remove">×</button>
      </span>`;
  }).join('');
  for (const button of $$('#trayItems button')) {
    button.addEventListener('click', () => togglePick(Number(button.dataset.id)));
  }
}

$('#trayClear').addEventListener('click', () => {
  state.picked = [];
  renderTray();
  if (state.result) renderOffers(state.result);
});

$('#trayCompare').addEventListener('click', () => {
  const offers = state.picked.map(findOffer).filter(Boolean);
  if (offers.length < 2) { toast('Pick at least two offers to compare.'); return; }

  // Winner per row is computed here, not styled by hand, so the highlight cannot drift.
  const best = {
    price: Math.min(...offers.map(o => o.price)),
    landed: Math.min(...offers.map(o => o.landedCost)),
    eta: Math.min(...offers.map(o => o.etaMinutes ?? Infinity)),
    rating: Math.max(...offers.map(o => o.rating ?? 0)),
    score: Math.max(...offers.map(o => o.score ?? 0)),
  };
  const cell = (value, isWin) => `<td class="${isWin ? 'win' : ''}">${value}</td>`;
  const row = (label, cells) => `<tr><th>${label}</th>${cells}</tr>`;

  $('#compareBody').innerHTML = `<div class="cmp-scroll"><table class="cmp">
      <thead><tr><th></th>${offers.map(o =>
        `<th><div class="cmp-head"><span class="dot" style="background:${escapeHtml(o.accent)}"></span>${escapeHtml(o.company)}</div>
             <div class="cmp-name">${escapeHtml(o.productName)}</div></th>`).join('')}</tr></thead>
      <tbody>
        ${row('Price', offers.map(o => cell(rupee(o.price), o.price === best.price)).join(''))}
        ${row('Delivery fee', offers.map(o => cell(o.deliveryFee > 0 ? rupee(o.deliveryFee) : 'Free', !(o.deliveryFee > 0))).join(''))}
        ${row('Landed cost', offers.map(o => cell(`<b>${rupee(o.landedCost)}</b>`, o.landedCost === best.landed)).join(''))}
        ${row('Delivery', offers.map(o => cell(escapeHtml(o.etaLabel), o.etaMinutes === best.eta)).join(''))}
        ${row('Rating', offers.map(o => cell(o.rating ? `${o.rating}/5 (${(o.reviews ?? 0).toLocaleString('en-IN')})` : '—', o.rating === best.rating && o.rating)).join(''))}
        ${row('Pack', offers.map(o => cell(escapeHtml(o.pack ?? '—'), false)).join(''))}
        ${row('Prescription', offers.map(o => cell(o.rxRequired ? 'Required' : 'Not required', !o.rxRequired)).join(''))}
        ${row('MediFind score', offers.map(o => cell(`${Math.round((o.score ?? 0) * 100)}/100`, o.score === best.score)).join(''))}
        ${row('Scraped via', offers.map(o => cell(escapeHtml(SOURCE_LABEL[o.source] ?? '—'), false)).join(''))}
        ${row('Last seen', offers.map(o => cell(escapeHtml(ago(o.scrapedAt)), false)).join(''))}
        ${row('', offers.map(o => cell(`<a class="price-cta" href="${escapeHtml(o.url)}" target="_blank" rel="noopener noreferrer">Open ${ICONS.arrow}</a>`, false)).join(''))}
      </tbody>
    </table></div>`;
  $('#compareDialog').showModal();
});
$('#compareClose').addEventListener('click', () => $('#compareDialog').close());

/* --------------------------------------------------------- watchlist -- */
/** Identity for a watched offer: the same product on the same platform. */
const watchKey = (offer, query) => `${offer.companySlug}::${(query ?? '').toLowerCase()}::${offer.productName.slice(0, 60)}`;

function toggleWatch(offer, query) {
  const key = watchKey(offer, query);
  const at = state.watchlist.findIndex(w => w.key === key);
  if (at >= 0) {
    state.watchlist.splice(at, 1);
    toast('Removed from watchlist.');
  } else {
    state.watchlist.push({
      key, query,
      company: offer.company, companySlug: offer.companySlug, accent: offer.accent,
      productName: offer.productName, url: offer.url,
      seenPrice: offer.landedCost, bestPrice: offer.landedCost, addedAt: Date.now(),
    });
    toast(`Watching ${offer.company} at ${rupee(offer.landedCost)}.`);
  }
  store.set('mf:watch', state.watchlist);
  updateWatchCount();
  if (state.result) renderOffers(state.result);
}

function updateWatchCount() {
  const node = $('#watchCount');
  node.textContent = state.watchlist.length;
  node.hidden = state.watchlist.length === 0;
}
updateWatchCount();

/**
 * Re-price the watchlist against whatever this search returned.
 *
 * There is no background job here: a watched price updates when you happen to search
 * that product again. The UI says so rather than implying a live alert.
 */
function checkWatchlist(result) {
  let dropped = 0;
  for (const watch of state.watchlist) {
    if ((watch.query ?? '').toLowerCase() !== result.query.toLowerCase()) continue;
    const match = (result.offers ?? []).find(o => watchKey(o, result.query) === watch.key);
    if (!match) continue;
    watch.lastPrice = match.landedCost;
    watch.checkedAt = Date.now();
    if (match.landedCost < watch.bestPrice) { watch.bestPrice = match.landedCost; dropped++; }
  }
  store.set('mf:watch', state.watchlist);
  if (dropped) toast(`${dropped} watched ${dropped === 1 ? 'price has' : 'prices have'} hit a new low.`);
}

/* ------------------------------------------------------ share + export */
$('#shareBtn').addEventListener('click', async () => {
  const url = location.href;
  try {
    if (navigator.share) await navigator.share({ title: `MediFind — ${state.result?.query ?? ''}`, url });
    else { await navigator.clipboard.writeText(url); toast('Link copied to clipboard.'); }
  } catch { toast('Could not copy the link.'); }
});

$('#exportBtn').addEventListener('click', () => {
  const offers = applyFilters([...(state.result?.offers ?? [])]);
  if (!offers.length) { toast('Nothing to export yet.'); return; }

  const columns = ['company', 'productName', 'price', 'deliveryFee', 'landedCost', 'etaLabel',
    'rating', 'reviews', 'pack', 'rxRequired', 'source', 'url'];
  const cell = v => {
    const s = v == null ? '' : String(v);
    return /[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
  };
  const csv = [columns.join(','), ...offers.map(o => columns.map(c => cell(o[c])).join(','))].join('\n');

  const blob = new Blob([csv], { type: 'text/csv;charset=utf-8' });
  const link = el('a');
  link.href = URL.createObjectURL(blob);
  link.download = `medifind-${state.result.query.replace(/\W+/g, '-')}-${state.result.place?.pincode ?? ''}.csv`;
  link.click();
  URL.revokeObjectURL(link.href);
  toast(`Exported ${offers.length} offers.`);
});

/* --------------------------------------------------------- quick picks */
async function loadReference() {
  try {
    const { companies, trackedQueries } = await api('/api/companies');
    state.companies = companies;
    state.trackedQueries = trackedQueries ?? [];

    $('#quickPicks').innerHTML = state.trackedQueries.slice(0, 8).map(q =>
      `<button type="button" class="quick-pick">${escapeHtml(q)}</button>`).join('');
    for (const button of $$('.quick-pick')) {
      button.addEventListener('click', () => { input.value = button.textContent; runSearch(); });
    }

    const active = companies.filter(c => !c.retired);
    const healthy = active.filter(c => c.status === 'ok' || c.status === 'healed').length;
    $('#eyebrowText').textContent =
      `${active.length} platforms · ${healthy} live right now · refreshed every 12 hours`;

    const dot = $('#healthDot');
    dot.className = 'pulse-dot ' + (healthy === 0 ? 'bad' : healthy < active.length / 2 ? 'warn' : 'ok');

    const strip = $('#heroStrip');
    strip.hidden = false;
    strip.innerHTML = companies.map(c => {
      const live = c.status === 'ok' || c.status === 'healed';
      const label = c.retired ? `<s>${escapeHtml(c.name)}</s>` : escapeHtml(c.name);
      const title = c.retired ?? (live ? `${c.rowCount} rows · ${ago(c.lastRefresh)}` : (c.lastError ?? 'no data yet'));
      return `<span class="strip-chip${live ? '' : ' is-off'}" title="${escapeHtml(title)}">
          <span class="dot" style="background:${escapeHtml(c.accent)}"></span>${label}
        </span>`;
    }).join('');

    $('#footerMeta').textContent =
      `${active.length} platforms tracked · ${companies.length - active.length} retired · ` +
      `${companies.filter(c => c.collectorId).length} Scraper Studio collectors`;
  } catch { /* reference data is not critical to search */ }
}
loadReference();

/* --------------------------------------------------------------- panels */
const panel = $('#panel');
const scrim = $('#scrim');

function openPanel(title, html) {
  $('#panelTitle').textContent = title;
  $('#panelBody').innerHTML = html;
  panel.hidden = false;
  panel.setAttribute('aria-hidden', 'false');
  scrim.hidden = false;
}
function closePanel() {
  panel.hidden = true;
  panel.setAttribute('aria-hidden', 'true');
  scrim.hidden = true;
}
$('#panelClose').addEventListener('click', closePanel);
scrim.addEventListener('click', closePanel);

const kv = (k, v) => `<div class="kv"><span>${escapeHtml(k)}</span><b>${v}</b></div>`;

/* ── platforms ── */
function panelCompanies() {
  const rows = state.companies.map(c => {
    const status = c.retired ? 'retired' : c.status;
    return `<div class="co-row">
        <span class="dot" style="background:${escapeHtml(c.accent)}"></span>
        <div>
          <div class="co-name">${escapeHtml(c.name)}</div>
          <div class="co-note">${escapeHtml(c.retired ?? c.note ?? '')}</div>
        </div>
        <div class="co-state">
          <span class="state-pill state-${escapeHtml(status)}">${escapeHtml(status)}</span>
          <div class="co-sub">${c.retired ? 'not scraped' : `${c.rowCount} rows · ${ago(c.lastRefresh)}`}</div>
        </div>
      </div>`;
  }).join('');
  openPanel('Platforms tracked', rows || '<p>Loading…</p>');
}

/* ── data trail ── */
async function panelTrail() {
  openPanel('Bright Data trail', '<p class="co-note">Loading…</p>');
  try {
    const trail = await api('/api/provenance');
    const strategyRows = (trail.rowsByStrategy ?? [])
      .map(r => kv(SOURCE_LABEL[r.source] ?? r.source ?? 'unknown', `${r.rows.toLocaleString('en-IN')} rows · ${r.companies} platforms`))
      .join('');

    const platforms = trail.platforms.map(p => {
      const ladder = p.retired
        ? '<span class="rung is-blocked">retired</span>'
        : [...p.ladder.map(rung =>
            `<span class="rung rung-${escapeHtml(rung)}${rung === p.lastStrategy ? ' is-used' : ''}">${escapeHtml(SOURCE_LABEL[rung] ?? rung)}</span>`),
           ...p.blockedRungs.map(rung =>
            `<span class="rung is-blocked" title="${escapeHtml(p.blockedReason ?? '')}">${escapeHtml(SOURCE_LABEL[rung] ?? rung)}</span>`),
          ].join('<span class="ladder-arrow">›</span>');

      return `<div class="trail-row">
          <div class="trail-top">
            <span class="dot" style="background:${escapeHtml(p.accent)}"></span>
            <b>${escapeHtml(p.name)}</b>
            <span class="state-pill state-${escapeHtml(p.retired ? 'retired' : p.status)}">${escapeHtml(p.retired ? 'retired' : p.status)}</span>
          </div>
          <div class="ladder">${ladder}</div>
          ${p.collectorId
            ? `<div class="collector">collector
                 <a href="${escapeHtml(p.collectorUrl ?? '#')}" target="_blank" rel="noopener noreferrer">${escapeHtml(p.collectorId)}</a>
                 ${p.healCount ? `· healed ${p.healCount}× (${ago(p.lastHealAt)})` : '· never healed'}
               </div>`
            : (p.retired ? '' : '<div class="collector">no collector yet</div>')}
          ${p.blockedReason ? `<p class="trail-note">${escapeHtml(p.blockedReason)}</p>` : ''}
          ${p.retired ? `<p class="trail-note">${escapeHtml(p.retired)}</p>` : ''}
          ${p.collectorId && !p.retired
            ? `<button type="button" class="heal-btn" data-slug="${escapeHtml(p.slug)}">Heal this collector</button>`
            : ''}
        </div>`;
    }).join('');

    $('#panelBody').innerHTML =
      `<div class="health-block"><h4>Bright Data zones</h4>
         ${kv('Web Unlocker zone', escapeHtml(trail.zones.unlocker))}
         ${kv('Browser API zone', escapeHtml(trail.zones.browser))}
         ${kv('Proxy country', escapeHtml(String(trail.zones.country).toUpperCase()))}
         ${kv('Studio collectors', trail.collectors)}
         ${kv('Total self-heals', trail.totalHeals)}
       </div>
       <div class="health-block"><h4>Rows by strategy</h4>${strategyRows || '<p class="co-note">No rows cached yet.</p>'}</div>
       <div class="health-block"><h4>Per platform</h4>${platforms}</div>`;

    for (const button of $$('.heal-btn')) {
      button.addEventListener('click', async () => {
        button.disabled = true;
        button.textContent = 'Healing… (this takes minutes)';
        try {
          const result = await api(`/api/admin/heal/${button.dataset.slug}`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ reason: 'manual heal from the data-trail panel' }),
          });
          toast(`Heal ${result.status ?? 'done'} — verify returned ${result.verified ?? 0} rows.`);
          panelTrail();
        } catch (err) {
          toast(err.message);
          button.disabled = false;
          button.textContent = 'Heal this collector';
        }
      });
    }
  } catch (err) {
    $('#panelBody').innerHTML = `<p>${escapeHtml(err.message)}</p>`;
  }
}

/* ── watchlist ── */
function panelWatchlist() {
  if (!state.watchlist.length) {
    openPanel('Watchlist', `<p class="co-note">Nothing watched yet. Hit the bell on any offer to track its
      landed cost — MediFind re-checks it the next time you search that product.</p>`);
    return;
  }
  const rows = state.watchlist.map(w => {
    const now = w.lastPrice ?? w.seenPrice;
    const delta = now - w.seenPrice;
    const move = delta < 0
      ? `<span class="watch-drop">${rupee(Math.abs(delta))} cheaper</span>`
      : delta > 0 ? `<span class="watch-rise">${rupee(delta)} dearer</span>` : 'unchanged';
    return `<div class="watch-row">
        <div>
          <div class="watch-name">${escapeHtml(w.productName)}</div>
          <div class="watch-sub">
            <span class="dot" style="background:${escapeHtml(w.accent)};display:inline-block"></span>
            ${escapeHtml(w.company)} · added at ${rupee(w.seenPrice)} · ${move}
            ${w.checkedAt ? `· checked ${escapeHtml(ago(w.checkedAt))}` : '· not re-checked yet'}
          </div>
        </div>
        <button type="button" class="btn-ghost unwatch" data-key="${escapeHtml(w.key)}">Remove</button>
      </div>`;
  }).join('');

  openPanel('Watchlist', rows + `<p class="trail-note" style="margin-top:1rem">
    Prices refresh when you search that product again — there is no background alert job.</p>`);

  for (const button of $$('.unwatch')) {
    button.addEventListener('click', () => {
      state.watchlist = state.watchlist.filter(w => w.key !== button.dataset.key);
      store.set('mf:watch', state.watchlist);
      updateWatchCount();
      panelWatchlist();
      if (state.result) renderOffers(state.result);
    });
  }
}

/* ── health ── */
async function panelHealth() {
  openPanel('Data health', '<p class="co-note">Loading…</p>');
  try {
    const status = await api('/api/status');
    const s = status.schedule;
    const active = state.companies.filter(c => !c.retired);
    const healed = state.companies.filter(c => c.healCount > 0);

    $('#panelBody').innerHTML =
      `<div class="health-block"><h4>Refresh cycle</h4>
         ${kv('Interval', `every ${s.intervalHours} h`)}
         ${kv('Last run', s.lastRunAt ? new Date(s.lastRunAt).toLocaleString('en-IN') : 'not yet')}
         ${kv('Next run', s.running ? 'running now' : `in ${s.minutesUntilNext} min`)}
         ${kv('Self-healing', s.autoHeal ? 'enabled' : 'off')}
         ${s.lastSummary ? kv('Last result', `${s.lastSummary.healthy}/${s.lastSummary.companies} healthy · ${s.lastSummary.totalRows} rows`) : ''}
       </div>
       <div class="health-block"><h4>Cache</h4>
         ${kv('Products stored', status.cache.products.toLocaleString('en-IN'))}
         ${kv('Platforms with data', `${status.cache.companies}/${active.length}`)}
       </div>
       <div class="health-block"><h4>Bright Data</h4>
         ${kv('Credentials', status.brightData.configured ? 'configured' : 'missing')}
         ${kv('Unlocker zone', escapeHtml(status.brightData.unlockerZone))}
         ${kv('Browser zone', escapeHtml(status.brightData.browserZone))}
       </div>
       <div class="health-block"><h4>Local LLM</h4>
         ${kv('Ollama', status.llm.available ? 'connected' : 'not running')}
         ${kv('Chat model', escapeHtml(status.llm.chatModel))}
         ${kv('Vision model', escapeHtml(status.llm.visionModel))}
         ${status.llm.available ? '' : '<p class="co-note">Ranking still works — it falls back to the deterministic scorer. Install Ollama for written analysis and photo search.</p>'}
       </div>
       <div class="health-block"><h4>Scraper Studio self-heals</h4>
         ${healed.length
           ? healed.map(c => kv(c.name, `${c.healCount}× · ${ago(c.lastHealAt)}`)).join('')
           : '<p class="co-note">No collector has needed repair yet.</p>'}
       </div>
       <button class="btn-primary" id="refreshNow">Run a refresh now</button>`;

    $('#refreshNow')?.addEventListener('click', async e => {
      e.target.disabled = true;
      e.target.textContent = 'Refresh started…';
      try {
        await api('/api/admin/refresh', { method: 'POST' });
        toast(`Refresh started across ${active.length} platforms. This takes a few minutes.`);
      } catch (err) { toast(err.message); }
    });
  } catch (err) {
    $('#panelBody').innerHTML = `<p>${escapeHtml(err.message)}</p>`;
  }
}

const PANELS = { companies: panelCompanies, trail: panelTrail, watchlist: panelWatchlist, health: panelHealth };
for (const button of $$('.nav-link[data-panel]')) {
  button.addEventListener('click', () => PANELS[button.dataset.panel]?.());
}

/* ------------------------------------------------------ command palette */
const palette = $('#palette');
const paletteQ = $('#paletteQ');
const paletteList = $('#paletteList');
let paletteItems = [];
let paletteCursor = 0;

const COMMANDS = [
  { label: 'Platforms tracked', kind: 'panel', icon: ICONS.panel, run: panelCompanies },
  { label: 'Bright Data trail', kind: 'panel', icon: ICONS.heal, run: panelTrail },
  { label: 'Watchlist', kind: 'panel', icon: ICONS.bell, run: panelWatchlist },
  { label: 'Data health', kind: 'panel', icon: ICONS.trend, run: panelHealth },
  { label: 'Optimise for lowest price', kind: 'intent', icon: ICONS.spark, run: () => setIntent('price') },
  { label: 'Optimise for fastest delivery', kind: 'intent', icon: ICONS.bolt, run: () => setIntent('speed') },
  { label: 'Optimise for balance', kind: 'intent', icon: ICONS.scale, run: () => setIntent('balanced') },
  { label: 'Toggle dark mode', kind: 'theme', icon: ICONS.spark,
    run: () => applyTheme(document.documentElement.dataset.theme === 'dark' ? 'light' : 'dark') },
  { label: 'Search by photo', kind: 'action', icon: ICONS.device, run: () => { resetDialog(); $('#photoDialog').showModal(); } },
];

function renderPalette() {
  const q = paletteQ.value.trim().toLowerCase();
  const products = state.trackedQueries
    .filter(t => !q || t.toLowerCase().includes(q))
    .slice(0, 6)
    .map(t => ({ label: t, kind: 'search', icon: ICONS.pill, run: () => { input.value = t; runSearch(); } }));
  const commands = COMMANDS.filter(c => !q || c.label.toLowerCase().includes(q));

  // A free-text query is always offered first, so the palette doubles as the search box.
  const freeText = q && !state.trackedQueries.includes(q)
    ? [{ label: `Search "${paletteQ.value.trim()}"`, kind: 'search', icon: ICONS.trend,
        run: () => { input.value = paletteQ.value.trim(); runSearch(); } }]
    : [];

  paletteItems = [...freeText, ...products, ...commands].slice(0, 12);
  paletteCursor = 0;
  paletteList.innerHTML = paletteItems.map((item, i) =>
    `<li role="option" aria-selected="${i === 0}">
       <span class="pal-icon">${item.icon}</span>${escapeHtml(item.label)}
       <span class="pal-kind">${escapeHtml(item.kind)}</span>
     </li>`).join('');
  for (const [i, node] of [...paletteList.children].entries()) {
    node.addEventListener('click', () => { palette.close(); paletteItems[i].run(); });
  }
}

function movePalette(step) {
  const nodes = [...paletteList.children];
  if (!nodes.length) return;
  nodes[paletteCursor]?.setAttribute('aria-selected', 'false');
  paletteCursor = (paletteCursor + step + nodes.length) % nodes.length;
  nodes[paletteCursor].setAttribute('aria-selected', 'true');
  nodes[paletteCursor].scrollIntoView({ block: 'nearest' });
}

function openPalette() {
  paletteQ.value = '';
  renderPalette();
  palette.showModal();
  paletteQ.focus();
}
$('#paletteBtn').addEventListener('click', openPalette);
paletteQ.addEventListener('input', renderPalette);
paletteQ.addEventListener('keydown', e => {
  if (e.key === 'ArrowDown') { e.preventDefault(); movePalette(1); }
  else if (e.key === 'ArrowUp') { e.preventDefault(); movePalette(-1); }
  else if (e.key === 'Enter') {
    e.preventDefault();
    const item = paletteItems[paletteCursor];
    palette.close();
    item?.run();
  }
});

/* ------------------------------------------------------------ shortcuts */
document.addEventListener('keydown', e => {
  const typing = /^(INPUT|TEXTAREA)$/.test(e.target.tagName);

  if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'k') {
    e.preventDefault();
    palette.open ? palette.close() : openPalette();
    return;
  }
  if (e.key === 'Escape') {
    if (!panel.hidden) closePanel();
    return;
  }
  if (typing) return;
  if (e.key === '/') { e.preventDefault(); input.focus(); input.select(); }
});

/* -------------------------------------------------------- photo search */
const dialog = $('#photoDialog');
const dropZone = $('#dropZone');
const camStage = $('#camStage');
const preview = $('#photoPreview');
let stream = null;

function resetDialog() {
  dropZone.hidden = false;
  camStage.hidden = true;
  preview.hidden = true;
  $('#photoResult').innerHTML = '';
  stopCamera();
}

function stopCamera() {
  stream?.getTracks().forEach(t => t.stop());
  stream = null;
}

$('#cameraBtn').addEventListener('click', () => { resetDialog(); dialog.showModal(); });
dialog.addEventListener('close', stopCamera);

$('#pickFile').addEventListener('click', () => $('#fileInput').click());
$('#fileInput').addEventListener('change', e => { if (e.target.files[0]) handleImage(e.target.files[0]); });
$('#camInput').addEventListener('change', e => { if (e.target.files[0]) handleImage(e.target.files[0]); });

$('#useCamera').addEventListener('click', async () => {
  // getUserMedia needs a secure context; on plain http the file-capture input is the fallback.
  if (!navigator.mediaDevices?.getUserMedia) { $('#camInput').click(); return; }
  try {
    stream = await navigator.mediaDevices.getUserMedia({ video: { facingMode: 'environment' } });
    $('#camVideo').srcObject = stream;
    await $('#camVideo').play();
    dropZone.hidden = true;
    camStage.hidden = false;
  } catch {
    $('#camInput').click();
  }
});

$('#shutter').addEventListener('click', () => {
  const video = $('#camVideo');
  const canvas = document.createElement('canvas');
  canvas.width = video.videoWidth;
  canvas.height = video.videoHeight;
  canvas.getContext('2d').drawImage(video, 0, 0);
  stopCamera();
  canvas.toBlob(blob => handleImage(blob), 'image/jpeg', 0.85);
});

for (const event of ['dragenter', 'dragover']) {
  dropZone.addEventListener(event, e => { e.preventDefault(); dropZone.classList.add('is-over'); });
}
for (const event of ['dragleave', 'drop']) {
  dropZone.addEventListener(event, e => { e.preventDefault(); dropZone.classList.remove('is-over'); });
}
dropZone.addEventListener('drop', e => {
  const file = e.dataTransfer?.files?.[0];
  if (file) handleImage(file);
});

/** Downscale before upload: a phone photo is several MB and the model does not need it. */
function toDataUrl(file, maxEdge = 1024) {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onerror = () => reject(new Error('Could not read that file.'));
    reader.onload = () => {
      const img = new Image();
      img.onerror = () => reject(new Error('That file is not a readable image.'));
      img.onload = () => {
        const scale = Math.min(1, maxEdge / Math.max(img.width, img.height));
        const canvas = document.createElement('canvas');
        canvas.width = Math.round(img.width * scale);
        canvas.height = Math.round(img.height * scale);
        canvas.getContext('2d').drawImage(img, 0, 0, canvas.width, canvas.height);
        resolve(canvas.toDataURL('image/jpeg', 0.85));
      };
      img.src = reader.result;
    };
    reader.readAsDataURL(file);
  });
}

async function handleImage(file) {
  try {
    const dataUrl = await toDataUrl(file);
    dropZone.hidden = true;
    camStage.hidden = true;
    preview.hidden = false;
    $('#previewImg').src = dataUrl;
    $('#photoResult').innerHTML = '<div class="progress-note"><span class="spinner"></span>Reading the pack…</div>';

    const result = await api('/api/identify', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ image: dataUrl }),
    });

    if (!result.ok) {
      $('#photoResult').innerHTML =
        `<div class="warn"><strong>Could not identify it.</strong><br>${escapeHtml(result.message)}</div>`;
      return;
    }

    const r = result.reading;
    $('#photoResult').innerHTML =
      `<div class="found">
         <b>${escapeHtml(result.display)}</b>
         ${r.brand ? `<div>Brand: ${escapeHtml(r.brand)}</div>` : ''}
         ${r.strength ? `<div>Size: ${escapeHtml(r.strength)}</div>` : ''}
         ${r.confidence ? `<div>Model confidence: ${Math.round(r.confidence * 100)}%</div>` : ''}
         <div style="margin-top:.7rem"><button type="button" class="btn-primary" id="usePhotoResult">Search ${escapeHtml(result.query)}</button></div>
       </div>`;
    $('#usePhotoResult').addEventListener('click', () => {
      input.value = result.query;
      dialog.close();
      runSearch();
    });
  } catch (err) {
    $('#photoResult').innerHTML = `<div class="warn">${escapeHtml(err.message)}</div>`;
  }
}

/* Deep link: /?q=…&pin=…&intent=… so a result can be shared. */
const params = new URLSearchParams(location.search);
if (params.get('q')) {
  input.value = params.get('q');
  if (params.get('pin')) pinInput.value = params.get('pin');
  if (params.get('intent')) setIntent(params.get('intent'), { rerun: false });
  if (pinInput.value) runSearch();
}
