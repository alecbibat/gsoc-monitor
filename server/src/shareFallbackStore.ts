import { pool } from './db';
import { cache } from './cache';
import { FALLBACK_OFF, parseFallbackSetting, type FallbackState } from './shareAccess';

/**
 * Storage for the share-link password break-glass switch.
 *
 * Read on every share-link request (including each SSE reconnect), written
 * rarely from the admin panel — so it is cached, but the RAW setting is what's
 * cached rather than the parsed verdict, which keeps the expiry evaluated
 * against the current time on every read.
 */

export const FALLBACK_KEY = 'share_password_fallback';
const CACHE_KEY = 'share-password-fallback';
const CACHE_TTL_MS = 10_000;

async function readSetting(): Promise<string | null> {
  const { rows: [row] } = await pool.query<{ value: string }>(
    'SELECT value FROM settings WHERE key = $1',
    [FALLBACK_KEY]
  );
  return row?.value ?? null;
}

/** Current break-glass state. A database error fails closed: sign-in only. */
export async function getShareFallback(): Promise<FallbackState> {
  try {
    const raw = await cache.getOrFetch<string | null>(CACHE_KEY, CACHE_TTL_MS, readSetting, {
      staleOnError: true,
    });
    return parseFallbackSetting(raw);
  } catch {
    return FALLBACK_OFF;
  }
}

/** Read straight through the cache — for the admin panel's own status view. */
export async function getShareFallbackFresh(): Promise<FallbackState> {
  const raw = await readSetting();
  cache.set(CACHE_KEY, raw, CACHE_TTL_MS);
  return parseFallbackSetting(raw);
}

/**
 * Open the window for `hours`, returning the new state. Caller is responsible
 * for having checked admin rights.
 */
export async function enableShareFallback(
  hours: number,
  by: { id: string; name: string }
): Promise<FallbackState> {
  const value = JSON.stringify({
    expiresAt: new Date(Date.now() + hours * 3600_000).toISOString(),
    enabledBy: by.id,
    enabledByName: by.name,
    enabledAt: new Date().toISOString(),
  });
  await pool.query(
    `INSERT INTO settings (key, value) VALUES ($1, $2)
     ON CONFLICT (key) DO UPDATE SET value = EXCLUDED.value`,
    [FALLBACK_KEY, value]
  );
  // Prime rather than invalidate so the change lands on the very next request.
  cache.set(CACHE_KEY, value, CACHE_TTL_MS);
  return parseFallbackSetting(value);
}

export async function disableShareFallback(): Promise<FallbackState> {
  await pool.query('DELETE FROM settings WHERE key = $1', [FALLBACK_KEY]);
  cache.set(CACHE_KEY, null, CACHE_TTL_MS);
  return FALLBACK_OFF;
}
