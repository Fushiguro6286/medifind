/**
 * Local LLM client (Ollama).
 *
 * Everything here is optional by design. Ollama runs on the user's own machine, so it may
 * simply not be installed - and a shopping comparison that returns nothing because a
 * model is missing would be useless. Callers get `available === false` and fall back to
 * the deterministic paths in rank.js.
 */
import { config } from '../config.js';

let probe = { checked: 0, available: false, models: [] };
const PROBE_TTL_MS = 30_000;

export async function status({ force = false } = {}) {
  if (!force && Date.now() - probe.checked < PROBE_TTL_MS) return probe;
  try {
    const res = await fetch(`${config.ollama.host}/api/tags`, {
      signal: AbortSignal.timeout(2500),
    });
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    const models = (await res.json()).models?.map(m => m.name) ?? [];
    probe = { checked: Date.now(), available: true, models };
  } catch (err) {
    probe = { checked: Date.now(), available: false, models: [], error: err.message };
  }
  return probe;
}

export const isAvailable = async () => (await status()).available;

/** Pick a pulled model, preferring the configured one, then any close match. */
async function resolveModel(preferred) {
  const { models } = await status();
  if (!models.length) return preferred;
  if (models.includes(preferred)) return preferred;
  const base = preferred.split(':')[0];
  return models.find(m => m.startsWith(base)) ?? models[0];
}

/**
 * One chat completion. `format: 'json'` puts Ollama in constrained-JSON mode, which is
 * what the ranker and the vision reader both rely on.
 */
export async function chat(messages, {
  model = config.ollama.chatModel,
  json = false,
  temperature = 0.2,
  timeoutMs = config.ollama.timeoutMs,
  images,
} = {}) {
  if (!(await isAvailable())) throw new Error('Ollama is not running');
  const resolved = await resolveModel(model);

  const payload = {
    model: resolved,
    messages: images
      ? messages.map((m, i) => (i === messages.length - 1 ? { ...m, images } : m))
      : messages,
    stream: false,
    options: { temperature, num_predict: 900 },
  };
  if (json) payload.format = 'json';

  const res = await fetch(`${config.ollama.host}/api/chat`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(payload),
    signal: AbortSignal.timeout(timeoutMs),
  });
  if (!res.ok) throw new Error(`Ollama responded ${res.status}: ${(await res.text()).slice(0, 200)}`);
  return (await res.json()).message?.content ?? '';
}

/** Chat that must return JSON. Returns null instead of throwing on unusable output. */
export async function chatJson(messages, options = {}) {
  try {
    const raw = await chat(messages, { ...options, json: true });
    return parseJsonLoose(raw);
  } catch {
    return null;
  }
}

export function parseJsonLoose(text) {
  if (!text) return null;
  const trimmed = String(text).trim().replace(/^```(?:json)?/i, '').replace(/```$/, '').trim();
  try { return JSON.parse(trimmed); } catch { /* model wrapped it in prose */ }
  const start = trimmed.search(/[[{]/);
  if (start === -1) return null;
  // Walk back from the end for the matching close - models often append a sentence.
  for (let end = trimmed.length; end > start; end--) {
    const slice = trimmed.slice(start, end);
    if (!/[\]}]$/.test(slice)) continue;
    try { return JSON.parse(slice); } catch { /* keep shrinking */ }
  }
  return null;
}
