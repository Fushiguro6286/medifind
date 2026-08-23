import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

export const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
export const DATA_DIR = path.join(ROOT, 'data');
export const COMPANY_DIR = path.join(DATA_DIR, 'companies');
export const PUBLIC_DIR = path.join(ROOT, 'public');

for (const dir of [DATA_DIR, COMPANY_DIR, path.join(DATA_DIR, 'raw'), path.join(DATA_DIR, 'uploads')]) {
  fs.mkdirSync(dir, { recursive: true });
}

/**
 * The Bright Data key is never checked into this repo. We resolve it, in order, from
 * the environment and then from the credentials file `bdata login` writes.
 */
function resolveApiKey() {
  if (process.env.BRIGHTDATA_API_KEY) return process.env.BRIGHTDATA_API_KEY.trim();
  const candidates = [
    path.join(os.homedir(), 'AppData', 'Roaming', 'brightdata-cli', 'credentials.json'),
    path.join(os.homedir(), '.config', 'brightdata-cli', 'credentials.json'),
    path.join(os.homedir(), '.brightdata', 'credentials.json'),
  ];
  for (const file of candidates) {
    try {
      const key = JSON.parse(fs.readFileSync(file, 'utf8')).api_key;
      if (key) return String(key).trim();
    } catch { /* try the next location */ }
  }
  return null;
}

const num = (value, fallback) => (Number.isFinite(Number(value)) ? Number(value) : fallback);

export const config = {
  port: num(process.env.PORT, 5173),
  brightData: {
    apiKey: resolveApiKey(),
    apiUrl: process.env.BRIGHTDATA_API_URL || 'https://api.brightdata.com',
    unlockerZone: process.env.BRIGHTDATA_UNLOCKER_ZONE || 'cli_unlocker',
    browserZone: process.env.BRIGHTDATA_BROWSER_ZONE || 'cli_browser',
    country: process.env.BRIGHTDATA_COUNTRY || 'in',
    requestTimeoutMs: num(process.env.BRIGHTDATA_TIMEOUT_MS, 90_000),
    maxConcurrent: num(process.env.SCRAPE_CONCURRENCY, 4),
  },
  ollama: {
    host: process.env.OLLAMA_HOST || 'http://127.0.0.1:11434',
    chatModel: process.env.OLLAMA_CHAT_MODEL || 'llama3.2',
    visionModel: process.env.OLLAMA_VISION_MODEL || 'llava',
    timeoutMs: num(process.env.OLLAMA_TIMEOUT_MS, 60_000),
  },
  refresh: {
    intervalHours: num(process.env.REFRESH_INTERVAL_HOURS, 12),
    runOnBoot: process.env.REFRESH_ON_BOOT === 'true',
    // A company whose scrape yields fewer rows than this is treated as drifted
    // and handed to Scraper Studio's AI self-healing.
    healthyRowThreshold: num(process.env.HEALTH_ROW_THRESHOLD, 1),
    autoHeal: process.env.AUTO_HEAL !== 'false',
    autoApproveHeal: process.env.AUTO_APPROVE_HEAL !== 'false',
  },
  cacheTtlMinutes: num(process.env.CACHE_TTL_MINUTES, 12 * 60),
};

export const hasBrightData = () => Boolean(config.brightData.apiKey);
