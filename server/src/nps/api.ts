import { config } from '../config';

// ── NPS Data API client ──────────────────────────────────────────────────────
// developer.nps.gov — documented, JSON, free key from
// https://www.nps.gov/subjects/developer/get-started.htm (NPS_API_KEY).
// The key goes in the X-Api-Key header rather than the query string so it
// never lands in a logged URL. A personal key allows 1,000 requests an hour;
// without one the server falls back to DEMO_KEY, which allows only a handful
// an hour per IP, so every NPS fetch here is cached and shared by all viewers
// and the TTLs stretch while on DEMO_KEY (npsTtl).

export const NPS_API = 'https://developer.nps.gov/api/v1';
const TIMEOUT_MS = 15_000;
const USER_AGENT = 'gsoc-monitor/1.0 (national-parks dashboard)';

export class NpsHttpError extends Error {
  constructor(
    readonly status: number,
    path: string
  ) {
    super(
      status === 429
        ? `NPS API rate limit reached (${path})${usingDemoKey() ? ' — set NPS_API_KEY' : ''}`
        : status === 401 || status === 403
          ? `NPS API rejected the key (${path}, HTTP ${status}) — check NPS_API_KEY`
          : `NPS API ${path} HTTP ${status}`
    );
    this.name = 'NpsHttpError';
  }
}

export function usingDemoKey(): boolean {
  return !config.npsApiKey || config.npsApiKey === 'DEMO_KEY';
}

/** DEMO_KEY's tiny hourly quota: poll the NPS API this many times less often without a key. */
const DEMO_KEY_TTL_FACTOR = 4;

/** A cache TTL for an NPS feed, stretched while running on DEMO_KEY. */
export function npsTtl(ms: number): number {
  return usingDemoKey() ? ms * DEMO_KEY_TTL_FACTOR : ms;
}

export interface NpsApiStatus {
  /** NPS_API_KEY is set (false = running on the shared DEMO_KEY). */
  keyConfigured: boolean;
  /** The hourly quota and what was left of it, per the last response's headers. */
  rateLimit: number | null;
  rateRemaining: number | null;
  lastOkAt: string | null;
  lastError: string | null;
  lastErrorAt: string | null;
}

const state: Omit<NpsApiStatus, 'keyConfigured'> = {
  rateLimit: null,
  rateRemaining: null,
  lastOkAt: null,
  lastError: null,
  lastErrorAt: null,
};

export function npsApiStatus(): NpsApiStatus {
  return { keyConfigured: !usingDemoKey(), ...state };
}

function noteRateLimit(headers: Headers): void {
  const limit = Number(headers.get('x-ratelimit-limit'));
  const remaining = Number(headers.get('x-ratelimit-remaining'));
  if (headers.has('x-ratelimit-limit') && Number.isFinite(limit)) state.rateLimit = limit;
  if (headers.has('x-ratelimit-remaining') && Number.isFinite(remaining)) state.rateRemaining = remaining;
}

function noteError(err: unknown): void {
  state.lastError = err instanceof Error ? err.message : String(err);
  state.lastErrorAt = new Date().toISOString();
}

/**
 * The request URL. Commas stay literal: the API splits list parameters
 * (parkCode=glac,yell,…) on a bare comma only, and reads an encoded %2C list
 * as the first code alone — so URLSearchParams' encoding would silently drop
 * every park but the first.
 */
export function npsUrl(path: string, params: Record<string, string | number> = {}): string {
  const url = new URL(NPS_API + path);
  for (const [k, v] of Object.entries(params)) url.searchParams.set(k, String(v));
  return url.toString().replace(/%2C/gi, ',');
}

/** GET an NPS Data API path (e.g. '/alerts') with query parameters. */
export async function npsGet<T>(path: string, params: Record<string, string | number> = {}): Promise<T> {
  const url = npsUrl(path, params);
  let res: Response;
  try {
    res = await fetch(url, {
      signal: AbortSignal.timeout(TIMEOUT_MS),
      headers: {
        'X-Api-Key': config.npsApiKey || 'DEMO_KEY',
        'User-Agent': USER_AGENT,
        Accept: 'application/json',
      },
    });
  } catch (err) {
    noteError(err);
    throw err;
  }
  noteRateLimit(res.headers);
  if (!res.ok) {
    const err = new NpsHttpError(res.status, path);
    noteError(err);
    throw err;
  }
  let body: T;
  try {
    body = (await res.json()) as T;
  } catch (err) {
    noteError(err);
    throw err;
  }
  state.lastOkAt = new Date().toISOString();
  return body;
}
