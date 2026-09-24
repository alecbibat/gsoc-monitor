// Lightning endpoints (see types/lightning.ts for the contract).
import type {
  LightningFieldResponse,
  LightningNearResponse,
  LightningStatusResponse,
} from '../types/lightning';

/** Carries the HTTP status so callers can fall back (e.g. 404 on an older server). */
export class LightningHttpError extends Error {
  constructor(
    public status: number,
    path: string
  ) {
    super(`Request to ${path} failed: ${status}`);
    this.name = 'LightningHttpError';
  }
}

async function getJson<T>(path: string, signal?: AbortSignal): Promise<T> {
  const res = await fetch(path, { signal });
  if (!res.ok) throw new LightningHttpError(res.status, path);
  return res.json() as Promise<T>;
}

// 5 decimals is ~1 m — plenty, and keeps equivalent views on one server memo key.
const fmt = (n: number) => String(Math.round(n * 1e5) / 1e5);

/**
 * The display field for a view box (null = whole globe): a stable sample of
 * the last 24 h plus every strike of the last 2 minutes.
 */
export function fetchLightningField(p: {
  bbox: [number, number, number, number] | null;
  budget: number;
  fresh: number;
  signal?: AbortSignal;
}): Promise<LightningFieldResponse> {
  const qs = new URLSearchParams({ budget: String(p.budget), fresh: String(p.fresh) });
  if (p.bbox) qs.set('bbox', p.bbox.map(fmt).join(','));
  return getJson<LightningFieldResponse>(`/api/lightning/field?${qs}`, p.signal);
}

/** Exact counts, nearest strike and map points around a location. */
export function fetchLightningNear(p: {
  lat: number;
  lon: number;
  radiusMi?: number;
  hours?: number;
  maxPoints?: number;
  signal?: AbortSignal;
}): Promise<LightningNearResponse> {
  const qs = new URLSearchParams({
    lat: p.lat.toFixed(3),
    lon: p.lon.toFixed(3),
    radiusMi: String(p.radiusMi ?? 130),
    hours: String(p.hours ?? 24),
    maxPoints: String(p.maxPoints ?? 6000),
  });
  return getJson<LightningNearResponse>(`/api/lightning/near?${qs}`, p.signal);
}

/** Server collector health: true global rate, coverage, persistence, memory. */
export function fetchLightningStatus(signal?: AbortSignal): Promise<LightningStatusResponse> {
  return getJson<LightningStatusResponse>('/api/lightning/status', signal);
}
