// Strike quantization and identity. The client mirrors the quantization and
// parsing half of this in client/src/layers/lightning/strikeKey.ts; both are
// pinned by the same golden vectors in their tests — change them together.
//
// A strike is stored and sent as (tick, latQ, lonQ):
//   latQ = round((lat + 90) / 180 · QMAX)   → 1.72e-4° ≈ 19 m steps
//   lonQ = round((lon + 180) / 360 · QMAX)  → 3.43e-4° ≈ 38 m steps at the equator
//   tick = floor(tMs / 10)                  → 10 ms resolution
// That is far finer than Blitzortung's own location accuracy, and it makes the
// triple an exact identity: the server and the browser, each listening on its
// own relay, derive the same key for the same strike from Blitzortung's `time`.

export const QMAX = 1_048_575; // 2^20 − 1
export const TICK_MS = 10;

export const qLat = (lat: number): number =>
  Math.min(QMAX, Math.max(0, Math.round(((lat + 90) / 180) * QMAX)));
export const qLon = (lon: number): number =>
  Math.min(QMAX, Math.max(0, Math.round(((lon + 180) / 360) * QMAX)));
export const dqLat = (latQ: number): number => (latQ / QMAX) * 180 - 90;
export const dqLon = (lonQ: number): number => (lonQ / QMAX) * 360 - 180;
export const tickOf = (tMs: number): number => Math.floor(tMs / TICK_MS);

/** Accept a strike's own timestamp only inside this window around receipt. */
export const NETWORK_TIME_PAST_MS = 600_000;
export const NETWORK_TIME_FUTURE_MS = 60_000;

/**
 * Blitzortung's `time` field, normalized to epoch ms. The unit is detected by
 * magnitude (ns today; µs/ms/s tolerated) and the value is only trusted within
 * [recvMs − 10 min, recvMs + 60 s]; anything else returns null and the caller
 * falls back to its receive time.
 */
export function parseStrikeTime(v: unknown, recvMs: number): number | null {
  const n = typeof v === 'number' ? v : typeof v === 'string' && v.trim() !== '' ? Number(v) : NaN;
  if (!Number.isFinite(n) || n <= 0) return null;
  let tMs: number;
  if (n > 1e17) tMs = n / 1e6; // ns
  else if (n > 1e14) tMs = n / 1e3; // µs
  else if (n > 1e11) tMs = n; // ms
  else tMs = n * 1e3; // s
  if (tMs < recvMs - NETWORK_TIME_PAST_MS || tMs > recvMs + NETWORK_TIME_FUTURE_MS) return null;
  return tMs;
}

// LZW-style decompressor matching Blitzortung's wire format (same scheme the
// public lightningmaps.org client uses). Decode, then JSON.parse to get a strike.
export function inflate(input: string): string {
  const dict: Record<number, string> = {};
  const data = input.split('');
  let current = data[0];
  let oldPhrase = current;
  const out: string[] = [current];
  let code = 256;
  const baseCode = 256;
  for (let i = 1; i < data.length; i++) {
    const charCode = data[i].charCodeAt(0);
    let phrase: string;
    if (baseCode > charCode) {
      phrase = data[i];
    } else {
      phrase = dict[charCode] ? dict[charCode] : oldPhrase + current;
    }
    out.push(phrase);
    current = phrase.charAt(0);
    dict[code] = oldPhrase + current;
    code++;
    oldPhrase = phrase;
  }
  return out.join('');
}

export interface ParsedStrike {
  lat: number;
  lon: number;
  /** Epoch ms — Blitzortung's own time when valid, else recvMs. */
  tMs: number;
  networkTime: boolean;
}

/** Decode one relay frame. null = not a strike (or out-of-range coordinates). */
export function parseFrame(raw: string, recvMs: number): ParsedStrike | null {
  let msg: { lat?: unknown; lon?: unknown; time?: unknown } | null = null;
  try {
    msg = JSON.parse(inflate(raw));
  } catch {
    try {
      msg = JSON.parse(raw);
    } catch {
      return null;
    }
  }
  if (!msg || typeof msg !== 'object') return null;
  const { lat, lon } = msg;
  if (typeof lat !== 'number' || typeof lon !== 'number') return null;
  if (!Number.isFinite(lat) || !Number.isFinite(lon)) return null;
  if (lat < -90 || lat > 90 || lon < -180 || lon > 180) return null;
  const net = parseStrikeTime(msg.time, recvMs);
  return { lat, lon, tMs: net ?? recvMs, networkTime: net !== null };
}

// murmur3 32-bit finalizer.
export function fmix32(h: number): number {
  h ^= h >>> 16;
  h = Math.imul(h, 0x85ebca6b);
  h ^= h >>> 13;
  h = Math.imul(h, 0xc2b2ae35);
  h ^= h >>> 16;
  return h >>> 0;
}

/**
 * Deterministic 32-bit hash of a strike's identity. It depends only on the
 * quantized values, so a strike gets the same hash live, after a restore, and
 * on any dyno — which is what keeps the display sample from reshuffling.
 */
export function strikeHash(tick: number, latQ: number, lonQ: number): number {
  const tLo = tick >>> 0; // low 32 bits (tick < 2^53)
  const tHi = Math.floor(tick / 4294967296) >>> 0;
  let h = fmix32((latQ ^ 0x9e3779b9) >>> 0);
  h = Math.imul(h, 31) ^ fmix32((lonQ + 0x7f4a7c15) >>> 0);
  h ^= Math.imul(tLo, 0x27d4eb2f) ^ Math.imul(tHi, 0x165667b1);
  return fmix32(h >>> 0);
}

/** Great-circle distance in statute miles. */
export function haversineMi(aLat: number, aLon: number, bLat: number, bLon: number): number {
  const R = 3958.7613;
  const dLat = ((bLat - aLat) * Math.PI) / 180;
  const dLon = ((bLon - aLon) * Math.PI) / 180;
  const s =
    Math.sin(dLat / 2) ** 2 +
    Math.cos((aLat * Math.PI) / 180) * Math.cos((bLat * Math.PI) / 180) * Math.sin(dLon / 2) ** 2;
  return 2 * R * Math.asin(Math.min(1, Math.sqrt(s)));
}
