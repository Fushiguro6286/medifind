import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { fileURLToPath } from 'node:url';
import { config, hasBrightData } from './config.js';

const execFileAsync = promisify(execFile);

/**
 * Invoke the CLI's JS entry point with the current node binary rather than shelling out
 * to `npx`. On Windows, Node refuses to spawn `npx.cmd` without `shell: true`
 * (spawn EINVAL), and enabling a shell would mean quoting scraper descriptions by hand.
 * Running dist/index.js directly sidesteps both problems and skips npx resolution.
 */
const CLI_ENTRY = fileURLToPath(new URL('../node_modules/@brightdata/cli/dist/index.js', import.meta.url));

export class BrightDataError extends Error {
  constructor(message, { status, body, company } = {}) {
    super(message);
    this.name = 'BrightDataError';
    this.status = status;
    this.body = body;
    this.company = company;
  }
}

/**
 * Web Unlocker. This is the hot path used on every 12-hourly refresh: one HTTP
 * call per company search page, proxied and unblocked by Bright Data.
 */
export async function unlock(url, { format = 'markdown', country = config.brightData.country, mobile = false } = {}) {
  if (!hasBrightData()) throw new BrightDataError('No Bright Data API key. Run: npx -p @brightdata/cli bdata login');

  const body = {
    zone: config.brightData.unlockerZone,
    url,
    format: 'raw',
    country,
  };
  if (format === 'markdown') body.data_format = 'markdown';
  if (format === 'screenshot') body.data_format = 'screenshot';
  if (mobile) body.ua = 'mobile';

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), config.brightData.requestTimeoutMs);
  try {
    const res = await fetch(`${config.brightData.apiUrl}/request`, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${config.brightData.apiKey}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify(body),
      signal: controller.signal,
    });
    const text = await res.text();
    if (!res.ok) {
      throw new BrightDataError(`Web Unlocker responded ${res.status}`, { status: res.status, body: text.slice(0, 600) });
    }
    return text;
  } catch (err) {
    if (err.name === 'AbortError') {
      throw new BrightDataError(`Web Unlocker timed out after ${config.brightData.requestTimeoutMs}ms`, { status: 408 });
    }
    throw err instanceof BrightDataError ? err : new BrightDataError(err.message);
  } finally {
    clearTimeout(timer);
  }
}

/** Run the CLI. Scraper Studio's AI flows are long-lived, so they go through the CLI. */
async function cli(args, { timeoutMs = 15 * 60_000 } = {}) {
  try {
    const { stdout } = await execFileAsync(process.execPath, [CLI_ENTRY, ...args], {
      timeout: timeoutMs,
      maxBuffer: 64 * 1024 * 1024,
      windowsHide: true,
      env: { ...process.env, BRIGHTDATA_API_KEY: config.brightData.apiKey ?? '' },
    });
    return stdout;
  } catch (err) {
    // execFile's own message is just the echoed command line, which for `scraper create`
    // is the 500-char description and tells you nothing. The CLI puts the actual reason
    // on stderr, so surface that instead - it is the difference between a debuggable
    // bootstrap failure and "Command failed: node ... dist/index.js scraper create ...".
    const lines = String(err.stderr || err.stdout || '').trim().split(/\r?\n/).filter(Boolean);
    const reason = lines.at(-1);
    throw new BrightDataError(
      `bdata ${args[0]} ${args[1] ?? ''}`.trim() + (reason ? `: ${reason.slice(0, 300)}` : `: ${err.message.slice(0, 200)}`),
      { body: String(err.stderr ?? '').slice(0, 1200) },
    );
  }
}

function parseJsonLoose(stdout) {
  const trimmed = stdout.trim();
  try { return JSON.parse(trimmed); } catch { /* CLI sometimes prefixes progress lines */ }
  const start = trimmed.search(/[[{]/);
  if (start === -1) return null;
  try { return JSON.parse(trimmed.slice(start)); } catch { return null; }
}

/** Build a Scraper Studio collector from a natural-language description (5-10 min). */
export async function studioCreate(url, description, name) {
  const stdout = await cli(['scraper', 'create', url, description, '--name', name, '--json', '--pretty']);
  return parseJsonLoose(stdout) ?? { raw: stdout };
}

/** Execute an existing collector and return its structured rows. */
export async function studioRun(collectorId, url, { sync = false, timeoutSec = 600 } = {}) {
  const args = ['scraper', 'run', collectorId, url, '--json', '--pretty'];
  if (sync) args.push('--sync');
  else args.push('--timeout', String(timeoutSec));
  const stdout = await cli(args, { timeoutMs: (timeoutSec + 120) * 1000 });
  return parseJsonLoose(stdout) ?? { raw: stdout };
}

/** AI self-healing: hand Studio the failure description and let it repair the collector. */
export async function studioHeal(collectorId, prompt, { url, autoApprove = true, autoSave = true } = {}) {
  const args = ['scraper', 'heal', collectorId, prompt.slice(0, 1000), '--json', '--pretty'];
  if (url) args.push('--url', url);
  if (autoApprove) args.push('--auto-approve');
  if (autoApprove && autoSave) args.push('--auto-save');
  const stdout = await cli(args);
  return parseJsonLoose(stdout) ?? { raw: stdout };
}

export async function studioApprove(collectorId, { reject = false, url } = {}) {
  const args = ['scraper', 'approve', collectorId, '--json', '--pretty'];
  if (reject) args.push('--reject');
  if (url) args.push('--url', url);
  return parseJsonLoose(await cli(args)) ?? {};
}

/** SERP API - used as a discovery fallback when a company's own search page is blocked. */
export async function serpSearch(query, { limit = 10 } = {}) {
  const stdout = await cli(['search', query, '--json'], { timeoutMs: 120_000 });
  const parsed = parseJsonLoose(stdout);
  const rows = Array.isArray(parsed) ? parsed : parsed?.results ?? [];
  return rows.slice(0, limit);
}

export async function accountBudget() {
  try { return parseJsonLoose(await cli(['budget', '--json'], { timeoutMs: 90_000 })); }
  catch { return null; }
}
