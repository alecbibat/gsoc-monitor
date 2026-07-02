import { cache } from '../cache';
import { config } from '../config';

// Server-side place-name → coordinates for intel items that arrive without
// coordinates (news headlines, social posts). Nominatim's usage policy is ~1
// req/s, so results are cached for 30 days and the ingest cycle caps how many
// NEW lookups it performs; repeated places come straight from cache.

interface NomResult {
  lat: string;
  lon: string;
}

const GEO_TTL_MS = 30 * 24 * 60 * 60_000;

function keyFor(q: string): string {
  return `intel-geocode:${q.toLowerCase().trim()}`;
}

function toCoords(data: NomResult[] | undefined): { lat: number; lon: number } | null {
  const top = data?.[0];
  if (!top) return null;
  const lat = parseFloat(top.lat);
  const lon = parseFloat(top.lon);
  return Number.isFinite(lat) && Number.isFinite(lon) ? { lat, lon } : null;
}

// A cache-only lookup (no network) — lets the cycle geocode already-seen places
// for free without spending its per-cycle budget.
export function cachedPlace(q: string): { lat: number; lon: number } | null {
  const key = keyFor(q);
  return toCoords(cache.get<NomResult[]>(key) ?? cache.getStale<NomResult[]>(key));
}

export async function geocodePlace(q: string): Promise<{ lat: number; lon: number } | null> {
  const trimmed = q.trim();
  if (!trimmed || trimmed.length > 160) return null;
  try {
    const data = await cache.getOrFetch<NomResult[]>(
      keyFor(trimmed),
      GEO_TTL_MS,
      async () => {
        const url = `https://nominatim.openstreetmap.org/search?format=jsonv2&limit=1&q=${encodeURIComponent(trimmed)}`;
        const r = await fetch(url, {
          headers: { 'User-Agent': config.nwsUserAgent },
          signal: AbortSignal.timeout(10_000),
        });
        if (!r.ok) throw new Error(`nominatim ${r.status}`);
        return (await r.json()) as NomResult[];
      },
      { staleOnError: true }
    );
    return toCoords(data);
  } catch {
    return null;
  }
}
