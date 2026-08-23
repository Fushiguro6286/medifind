/**
 * The 12-hourly refresh loop.
 *
 * Each cycle re-scrapes every company across the tracked catalogue. Companies that come
 * back empty are handed to Scraper Studio's AI healer inside runner.js, and the cached
 * JSON snapshot for a company is only rewritten once its refresh - heal included - has
 * finished. So the cache a user reads is never half-updated.
 *
 * State lives in data/schedule.json so a restart does not lose the cycle.
 */
import fs from 'node:fs';
import path from 'node:path';
import { DATA_DIR, config } from './config.js';
import { refreshAll } from './scrape/runner.js';

const STATE_FILE = path.join(DATA_DIR, 'schedule.json');
const INTERVAL_MS = config.refresh.intervalHours * 60 * 60 * 1000;

let timer = null;
let running = false;
let listeners = [];

const readState = () => {
  try { return JSON.parse(fs.readFileSync(STATE_FILE, 'utf8')); } catch { return {}; }
};
const writeState = patch => {
  const next = { ...readState(), ...patch };
  fs.writeFileSync(STATE_FILE, JSON.stringify(next, null, 2));
  return next;
};

export const onRefresh = fn => { listeners.push(fn); return () => { listeners = listeners.filter(l => l !== fn); }; };
const emit = event => { for (const fn of listeners) { try { fn(event); } catch { /* listener errors are not our problem */ } } };

export function scheduleState() {
  const state = readState();
  const last = state.lastRunAt ? new Date(state.lastRunAt).getTime() : null;
  const next = last ? last + INTERVAL_MS : Date.now() + 5000;
  return {
    intervalHours: config.refresh.intervalHours,
    running,
    lastRunAt: state.lastRunAt ?? null,
    lastSummary: state.lastSummary ?? null,
    nextRunAt: new Date(running ? Date.now() : next).toISOString(),
    minutesUntilNext: running ? 0 : Math.max(0, Math.round((next - Date.now()) / 60_000)),
    autoHeal: config.refresh.autoHeal,
  };
}

export async function runRefreshNow({ reason = 'manual' } = {}) {
  if (running) return { skipped: true, reason: 'a refresh is already running' };
  running = true;
  emit({ type: 'start', reason, at: new Date().toISOString() });
  const startedAt = new Date().toISOString();
  try {
    const summary = await refreshAll();
    writeState({
      lastRunAt: startedAt,
      lastSummary: {
        healthy: summary.healthy,
        companies: summary.companies,
        healed: summary.healed,
        totalRows: summary.totalRows,
        durationMs: summary.durationMs,
        reason,
      },
    });
    emit({ type: 'done', summary });
    return summary;
  } catch (err) {
    writeState({ lastRunAt: startedAt, lastError: err.message });
    emit({ type: 'error', error: err.message });
    throw err;
  } finally {
    running = false;
  }
}

/**
 * Start the loop. If the last run is already older than the interval we catch up
 * immediately, otherwise we wait out the remainder before the first tick.
 */
export function startScheduler() {
  const state = readState();
  const last = state.lastRunAt ? new Date(state.lastRunAt).getTime() : 0;
  const due = last + INTERVAL_MS;
  const delay = Math.max(0, due - Date.now());

  const tick = () => {
    runRefreshNow({ reason: 'scheduled' }).catch(err => console.error('[scheduler] refresh failed:', err.message));
  };

  if (config.refresh.runOnBoot || (last && delay === 0)) {
    console.log('[scheduler] refresh is due - starting now');
    setTimeout(tick, 3000);
  } else if (last) {
    console.log(`[scheduler] next refresh in ${Math.round(delay / 60_000)} min`);
  } else {
    console.log('[scheduler] no refresh recorded yet; run `npm run refresh` or POST /api/admin/refresh');
  }

  timer = setInterval(tick, INTERVAL_MS);
  timer.unref?.();
  return timer;
}

export function stopScheduler() {
  if (timer) clearInterval(timer);
  timer = null;
}
