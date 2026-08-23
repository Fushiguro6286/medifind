/**
 * Photo search: turn a picture of a product (camera capture or a file from disk/Drive)
 * into a search term.
 *
 * A local vision model reads the pack. Because model output is free text and our search
 * index is not, the raw reading is snapped to the closest known catalogue entry before it
 * is used - that keeps a hallucinated brand name from becoming a dead-end search.
 */
import { chatJson, isAvailable, status } from './ollama.js';
import { config } from '../config.js';
import { SEED_TERMS } from '../catalog.js';
import { db, ensureFts } from '../db.js';

const PROMPT =
  'Identify the healthcare product in this image. It is a medicine pack, a home medical ' +
  'device, or a healthcare supply sold in India. Reply as JSON: ' +
  '{"product_name": string, "brand": string|null, "strength_or_size": string|null, ' +
  '"category": "medicine"|"device"|"supply"|"wellness", "confidence": 0..1, ' +
  '"visible_text": string}. Use the text printed on the pack. If unsure, put your best ' +
  'guess in product_name and set confidence below 0.5.';

/** Levenshtein-free similarity: token overlap plus substring credit. Good enough to snap. */
function similarity(a, b) {
  const ta = new Set(a.toLowerCase().split(/[^a-z0-9]+/).filter(Boolean));
  const tb = new Set(b.toLowerCase().split(/[^a-z0-9]+/).filter(Boolean));
  if (!ta.size || !tb.size) return 0;
  let shared = 0;
  for (const t of ta) if (tb.has(t)) shared++;
  const overlap = shared / Math.min(ta.size, tb.size);
  const substring = b.toLowerCase().includes(a.toLowerCase()) || a.toLowerCase().includes(b.toLowerCase()) ? 0.3 : 0;
  return Math.min(1, overlap + substring);
}

/** Snap free-text model output to something we can actually search. */
export function snapToCatalogue(reading) {
  const raw = [reading.brand, reading.product_name, reading.strength_or_size]
    .filter(Boolean).join(' ').trim() || reading.product_name || '';
  if (!raw) return null;

  let best = null;
  for (const term of SEED_TERMS) {
    const score = Math.max(similarity(raw, term.display), similarity(raw, term.q));
    if (!best || score > best.score) best = { score, term };
  }

  // Also consider titles we have actually scraped - they beat the seed list when present.
  try {
    ensureFts();
    const token = raw.split(/\s+/).filter(w => w.length > 2)[0];
    if (token) {
      const rows = db.prepare(
        'SELECT name FROM product_fts WHERE product_fts MATCH ? LIMIT 20'
      ).all(`${token.replace(/["*]/g, '')}*`);
      for (const row of rows) {
        const score = similarity(raw, row.name);
        if (!best || score > best.score) best = { score, term: { display: row.name, q: row.name, category: null } };
      }
    }
  } catch { /* index not ready yet */ }

  return best && best.score >= 0.34
    ? { query: best.term.q, display: best.term.display, category: best.term.category, matchScore: Math.round(best.score * 100) / 100 }
    : { query: raw, display: raw, category: reading.category ?? null, matchScore: 0 };
}

/**
 * @param {string} base64 raw base64 (no data: prefix)
 */
export async function identifyProduct(base64) {
  if (!(await isAvailable())) {
    return { ok: false, reason: 'no-llm', message: 'Photo search needs a local vision model. Install Ollama and run: ollama pull llava' };
  }
  const { models } = await status();
  const hasVision = models.some(m => /llava|vision|moondream|minicpm|qwen2\.?5vl|gemma3/i.test(m));
  if (!hasVision) {
    return { ok: false, reason: 'no-vision-model', message: `No vision model pulled. Run: ollama pull ${config.ollama.visionModel}` };
  }

  const reading = await chatJson(
    [{ role: 'user', content: PROMPT }],
    { model: config.ollama.visionModel, images: [base64], temperature: 0.1, timeoutMs: Math.max(config.ollama.timeoutMs, 90_000) },
  );
  if (!reading?.product_name) {
    return { ok: false, reason: 'unreadable', message: 'Could not read a product from that photo. Try a sharper shot of the front of the pack.' };
  }

  const snapped = snapToCatalogue(reading);
  return {
    ok: true,
    query: snapped.query,
    display: snapped.display,
    reading: {
      productName: reading.product_name,
      brand: reading.brand ?? null,
      strength: reading.strength_or_size ?? null,
      category: reading.category ?? null,
      confidence: Number(reading.confidence) || null,
      visibleText: String(reading.visible_text ?? '').slice(0, 200),
    },
    matchScore: snapped.matchScore,
  };
}
