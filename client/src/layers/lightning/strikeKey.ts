// Strike quantization, identity and frame parsing — the client half of
// server/src/lightning/quant.ts. Both are pinned by the same golden vectors in
// their tests; change them together.
//
// A strike is identified by (tick, latQ, lonQ):
//   latQ = round((lat + 90) / 180 · QMAX)   → ≈19 m steps
//   lonQ = round((lon + 180) / 360 · QMAX)  → ≈38 m steps at the equator
//   tick = floor(tMs / 10)                  → 10 ms resolution
// Derived from Blitzortung's own `time`, the triple is identical for a strike
// the browser saw live and the copy the server hands back, so they dedupe.
import type { LightningMarks } from '../../types/lightning';

export const QMAX = 1_048_575; // 2^20 − 1
export const TICK_MS = 10;

export const qLat = (lat: number): number =>
  Math.min(QMAX, Math.max(0, Math.round(((lat + 90) / 180) * QMAX)));
export const qLon = (lon: number): number =>
  Math.min(QMAX, Math.max(0, Math.round(((lon + 180) / 360) * QMAX)));
export const dqLat = (latQ: number): number => (latQ / QMAX) * 180 - 90;
export const dqLon = (lonQ: number): number => (lonQ / QMAX) * 360 - 180;
export const tickOf = (tMs: number): number => Math.floor(tMs / TICK_MS);

export const strikeKey = (tick: number, latQ: number, lonQ: number): string =>
  `${tick}:${latQ}:${lonQ}`;

/** Accept a strike's own timestamp only inside this window around receipt. */
export const NETWORK_TIME_PAST_MS = 600_000;
export const NETWORK_TIME_FUTURE_MS = 60_000;

/**
 * Blitzortung's `time` field, normalized to epoch ms (ns today; µs/ms/s
 * tolerated by magnitude). Trusted only within [recvMs − 10 min, recvMs + 60 s];
 * otherwise null and the caller uses its receive time.
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

// LZW-style decompressor matching Blitzortung's wire format. Frames are JSON
// objects compressed with this scheme; decode then JSON.parse to get a strike.
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

export interface LiveStrike {
  lat: number;
  lon: number;
  /** Epoch ms — Blitzortung's own time when valid, else recvMs. */
  tMs: number;
  networkTime: boolean;
  tick: number;
  latQ: number;
  lonQ: number;
  key: string;
}

/** Decode one relay frame. null = not a strike (or out-of-range coordinates). */
export function parseFrame(raw: string, recvMs: number): LiveStrike | null {
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
  const tMs = net ?? recvMs;
  const tick = tickOf(tMs);
  const latQ = qLat(lat);
  const lonQ = qLon(lon);
  return { lat, lon, tMs, networkTime: net !== null, tick, latQ, lonQ, key: strikeKey(tick, latQ, lonQ) };
}

export interface DecodedMark {
  key: string;
  tick: number;
  /** Epoch ms of the strike (tick · 10). */
  tMs: number;
  lat: number;
  lon: number;
}

/** Expand delta-encoded marks from the server. Malformed input yields []. */
export function decodeMarks(m: LightningMarks | null | undefined): DecodedMark[] {
  if (!m || !Array.isArray(m.dt) || !Array.isArray(m.la) || !Array.isArray(m.lo)) return [];
  const n = Math.min(m.dt.length, m.la.length, m.lo.length);
  const out: DecodedMark[] = new Array(n);
  let tick = m.tick0;
  for (let i = 0; i < n; i++) {
    tick += m.dt[i];
    const latQ = m.la[i];
    const lonQ = m.lo[i];
    out[i] = {
      key: strikeKey(tick, latQ, lonQ),
      tick,
      tMs: tick * TICK_MS,
      lat: dqLat(latQ),
      lon: dqLon(lonQ),
    };
  }
  return out;
}
