import { Router } from 'express';
import { cache } from '../cache';

const router = Router();

const MANIFEST_URL = 'https://api.rainviewer.com/public/weather-maps.json';
// RainViewer publishes a new frame every 10 minutes; a short TTL keeps the
// dashboard within a minute or so of that without hammering the API.
const TTL_MS = 60_000;

export interface RadarFrame {
  time: number;
  path: string;
}

export interface RadarManifest {
  host: string;
  generated: number;
  past: RadarFrame[];
  nowcast: RadarFrame[];
}

function isRecord(v: unknown): v is Record<string, unknown> {
  return typeof v === 'object' && v !== null;
}

function frames(raw: unknown): RadarFrame[] {
  if (!Array.isArray(raw)) return [];
  const out: RadarFrame[] = [];
  for (const f of raw) {
    if (isRecord(f) && typeof f.time === 'number' && typeof f.path === 'string') {
      out.push({ time: f.time, path: f.path });
    }
  }
  return out.sort((a, b) => a.time - b.time);
}

// Reduce RainViewer's manifest to the radar frames the client needs, rejecting
// anything that couldn't drive the layer (no host, no observed frames) so a
// broken upstream payload never replaces the last good one in the cache.
export function normalizeManifest(raw: unknown): RadarManifest {
  if (!isRecord(raw)) throw new Error('RainViewer manifest is not an object');
  const host = raw.host;
  if (typeof host !== 'string' || !/^https:\/\//.test(host)) {
    throw new Error('RainViewer manifest has no usable tile host');
  }
  const radar = isRecord(raw.radar) ? raw.radar : {};
  const past = frames(radar.past);
  if (past.length === 0) throw new Error('RainViewer manifest has no radar frames');
  return {
    host,
    generated: typeof raw.generated === 'number' ? raw.generated : Math.floor(Date.now() / 1000),
    past,
    nowcast: frames(radar.nowcast),
  };
}

async function fetchManifest(): Promise<RadarManifest> {
  const res = await fetch(MANIFEST_URL, { signal: AbortSignal.timeout(10_000) });
  if (!res.ok) throw new Error(`RainViewer HTTP ${res.status}`);
  return normalizeManifest(await res.json());
}

// RainViewer's frame manifest. Tiles are fetched by the browser straight from
// RainViewer's CDN (`host` in this payload) — only the small manifest goes
// through the dyno, cached and served stale if RainViewer is having a moment.
router.get('/', async (_req, res) => {
  try {
    const data = await cache.getOrFetch('radar:manifest', TTL_MS, fetchManifest, {
      staleOnError: true,
    });
    res.set('Cache-Control', 'public, max-age=30');
    res.json(data);
  } catch (err) {
    res.status(502).json({ error: 'Radar manifest unavailable', detail: String(err) });
  }
});

export default router;
