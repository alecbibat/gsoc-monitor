// Shared NASA FIRMS active-fire fetching. Used by both FireLayer (which draws
// the flame billboards) and the proximity widget (which lists hotspots near
// each property), so both read the same detections from the same service.

import { haversineMeters } from '../../lib/geo';
import { LOCATION_GROUPS } from '../locations/locations';

// NASA FIRMS VIIRS active-fire detections, served (no API key) through Esri's
// CORS-enabled Living Atlas feature service and queried by area so the global
// feed stays manageable. Same browser-side approach as the other GIS layers.
const SERVICE =
  'https://services9.arcgis.com/RHVPKKiFTONKtxq3/arcgis/rest/services/Satellite_VIIRS_Thermal_Hotspots_and_Fire_Activity/FeatureServer';

export const MAX_FIRES = 2500; // strongest-by-FRP hotspots we draw at once
const FALLBACK_LAYER_ID = 0; // "past 24 hrs" sublayer if name discovery fails

const ALL_PINS: Array<[number, number]> = LOCATION_GROUPS.flatMap((g) =>
  g.locations.map((l) => [l.lon, l.lat] as [number, number])
);

function nearAnyPin(lat: number, lon: number, radiusM: number): boolean {
  return ALL_PINS.some(([plon, plat]) => haversineMeters(lat, lon, plat, plon) <= radiusM);
}

// Query envelopes are padded for the maximum supported radius (200 mi) so the
// same set of boxes works for all distance options. The haversine check above
// does the precise per-hotspot filtering.
export const PIN_ENVELOPES: string[] = LOCATION_GROUPS.map((g) => {
  const lats = g.locations.map((l) => l.lat);
  const lons = g.locations.map((l) => l.lon);
  const minLat = Math.min(...lats);
  const maxLat = Math.max(...lats);
  const minLon = Math.min(...lons);
  const maxLon = Math.max(...lons);
  const latPad = 200 / 69; // ~2.9° per 200 mi
  const maxAbsLat = Math.max(Math.abs(minLat), Math.abs(maxLat));
  const lonPad = Math.min(6, 200 / (69 * Math.cos((maxAbsLat * Math.PI) / 180)));
  return `${minLon - lonPad},${minLat - latPad},${maxLon + lonPad},${maxLat + latPad}`;
});

interface ServiceLayer {
  id: number;
  name: string;
}

export interface FireHotspot {
  lat: number;
  lon: number;
  frp: number | null;
  brightness: number | null;
  confidence: string;
  satellite: string;
  daynight: string;
  acqDate: string;
  acqTime: string;
}

function pick<T = unknown>(
  props: Record<string, unknown> | undefined,
  keys: string[]
): T | undefined {
  if (!props) return undefined;
  for (const k of keys) {
    const v = props[k];
    if (v != null && v !== '') return v as T;
  }
  return undefined;
}

function asNumber(v: unknown): number | undefined {
  if (v == null || v === '') return undefined;
  const n = typeof v === 'number' ? v : Number(v);
  return Number.isFinite(n) ? n : undefined;
}

// --- Intensity assessment -----------------------------------------------------
// "Is this open flames?" can't be read from brightness temperature alone: the
// VIIRS I-4 value is the average of the whole ~375 m pixel (flames fill only a
// fraction of it) and the band saturates near 367 K. The discriminator fire
// science actually uses is Fire Radiative Power — MW of radiant output — with
// brightness temperature as a secondary signal. Thresholds below are rough
// operational bands for 375 m VIIRS detections, deliberately phrased as
// likelihoods.
export type FireIntensityLevel = 'inferno' | 'flaming' | 'active' | 'smoldering' | 'residual';

export interface FireAssessment {
  level: FireIntensityLevel;
  label: string; // short badge text
  detail: string; // one-line explanation for the card
  color: string; // badge hex
  saturated: boolean; // sensor pinned at ~367 K — extremely hot pixel
}

export function kelvinToF(k: number): number {
  return ((k - 273.15) * 9) / 5 + 32;
}
export function kelvinToC(k: number): number {
  return k - 273.15;
}

export function assessHotspot(
  frp: number | null,
  brightnessK: number | null,
  daynight: string
): FireAssessment {
  const saturated = brightnessK != null && brightnessK >= 366.5;
  const f = frp ?? -1;
  const b = brightnessK ?? 0;
  const night = daynight === 'N';
  const nightNote = night ? ' Night detection — weak fires stand out clearly.' : '';

  if (f >= 75 || (saturated && f >= 30)) {
    return {
      level: 'inferno',
      label: 'Intense fire front — open flames',
      detail: 'Radiative power at wildfire-front levels; vigorous flaming combustion.' + nightNote,
      color: '#ef4444',
      saturated,
    };
  }
  if (f >= 15 || saturated) {
    return {
      level: 'flaming',
      label: 'Actively flaming',
      detail: 'Strong heat output consistent with open flames across part of the pixel.' + nightNote,
      color: '#f97316',
      saturated,
    };
  }
  if (f >= 3 || b >= 345) {
    return {
      level: 'active',
      label: 'Active fire — flames likely',
      detail: 'Sustained burning; open flame at least in patches.' + nightNote,
      color: '#f59e0b',
      saturated,
    };
  }
  if (f >= 0.8 || b >= 325) {
    return {
      level: 'smoldering',
      label: 'Low intensity — likely smoldering',
      detail:
        'Weak heat output: smoldering ground fire, embers, or a small / partly-obscured flame.' +
        nightNote,
      color: '#eab308',
      saturated,
    };
  }
  return {
    level: 'residual',
    label: 'Weak or residual heat',
    detail:
      'Barely above the detection floor — a cooling burn scar, smoldering remnant, or a non-fire heat source (flare, industrial).' +
      nightNote,
    color: '#94a3b8',
    saturated,
  };
}

function confidenceLabel(raw: unknown): string {
  if (raw == null || raw === '') return 'Unknown';
  const s = String(raw).toLowerCase();
  if (s === 'h' || s === 'high') return 'High';
  if (s === 'n' || s === 'nominal') return 'Nominal';
  if (s === 'l' || s === 'low') return 'Low';
  const n = Number(raw);
  if (Number.isFinite(n)) return `${n}%`;
  return String(raw);
}

/** Parse one ArcGIS GeoJSON point feature into a FireHotspot (null if not a point). */
export function parseHotspot(f: GeoJSON.Feature): FireHotspot | null {
  if (f.geometry?.type !== 'Point') return null;
  const [lon, lat] = f.geometry.coordinates as [number, number];
  const p = (f.properties ?? undefined) as Record<string, unknown> | undefined;
  return {
    lat,
    lon,
    frp: asNumber(pick(p, ['frp', 'FRP'])) ?? null,
    brightness: asNumber(pick(p, ['bright_ti4', 'BRIGHT_TI4', 'brightness'])) ?? null,
    confidence: confidenceLabel(pick(p, ['confidence', 'CONFIDENCE'])),
    satellite: (pick<string>(p, ['satellite', 'SATELLITE']) ?? '—') as string,
    daynight: (pick<string>(p, ['daynight', 'DAYNIGHT']) ?? '') as string,
    acqDate: (pick<string>(p, ['acq_date', 'ACQ_DATE']) ?? '') as string,
    acqTime: (pick<string>(p, ['acq_time', 'ACQ_TIME']) ?? '') as string,
  };
}

// Discover the "past 24 hrs" sublayer once, by name, with an index fallback.
// Memoised across the app's lifetime.
let layerIdPromise: Promise<number> | null = null;
export function getFireLayerId(): Promise<number> {
  if (!layerIdPromise) {
    layerIdPromise = (async () => {
      try {
        const r = await fetch(`${SERVICE}?f=json`);
        if (r.ok) {
          const meta = (await r.json()) as { layers?: ServiceLayer[] };
          const found = meta.layers?.find((l) => {
            const n = l.name.toLowerCase();
            return n.includes('24') || n.includes('last');
          });
          return found?.id ?? meta.layers?.[0]?.id ?? FALLBACK_LAYER_ID;
        }
      } catch {
        /* fall through to fallback */
      }
      return FALLBACK_LAYER_ID;
    })();
  }
  return layerIdPromise;
}

export interface EnvelopeResult {
  features: GeoJSON.Feature[] | null; // null only on hard failure
  error: string | null;
}

// Fetch + parse one ArcGIS envelope. Returns features (possibly empty) on
// success, or null with an error string on a hard failure.
export async function fetchEnvelope(layerId: number, envelope: string): Promise<EnvelopeResult> {
  // Only the attributes parseHotspot reads — outFields=* roughly doubles the
  // payload for no benefit.
  const OUT_FIELDS = 'frp,bright_ti4,confidence,satellite,daynight,acq_date,acq_time';
  const base =
    `${SERVICE}/${layerId}/query?where=1%3D1` +
    `&geometry=${encodeURIComponent(envelope)}&geometryType=esriGeometryEnvelope` +
    `&inSR=4326&spatialRel=esriSpatialRelIntersects&outFields=${OUT_FIELDS}&outSR=4326` +
    `&resultRecordCount=${MAX_FIRES}&f=geojson`;
  // Prefer the strongest fires first (matters only when we hit the cap), but
  // don't let a schema surprise on that field break the layer — fall back to
  // an unordered query.
  const candidates = [`${base}&orderByFields=frp%20DESC`, base];
  let error: string | null = null;
  for (const url of candidates) {
    try {
      const r = await fetch(url);
      if (!r.ok) {
        error = `HTTP ${r.status}`;
        continue;
      }
      const j = (await r.json()) as { features?: GeoJSON.Feature[] };
      return { features: j.features ?? [], error: null };
    } catch (err) {
      error = err instanceof Error ? err.message : 'unreachable';
    }
  }
  return { features: null, error: error ?? 'unreachable' };
}

export interface HotspotsResult {
  hotspots: FireHotspot[] | null; // null only when every region failed
  error: string | null;
}

// Query a fixed box around each pin group (independent of the camera), then keep
// only hotspots within `radiusM` of an actual pin. Adjacent group boxes can
// overlap, so results are deduped by position.
export async function fetchHotspotsNearPins(radiusM: number): Promise<HotspotsResult> {
  const layerId = await getFireLayerId();
  const results = await Promise.all(PIN_ENVELOPES.map((env) => fetchEnvelope(layerId, env)));

  if (results.every((r) => r.features === null)) {
    return { hotspots: null, error: results.find((r) => r.error)?.error ?? 'unreachable' };
  }

  const seen = new Set<string>();
  const hotspots: FireHotspot[] = [];
  for (const r of results) {
    if (!r.features) continue;
    for (const f of r.features) {
      if (f.geometry?.type !== 'Point') continue;
      const [lon, lat] = f.geometry.coordinates as [number, number];
      if (!nearAnyPin(lat, lon, radiusM)) continue;
      const key = `${lon.toFixed(4)},${lat.toFixed(4)}`;
      if (seen.has(key)) continue;
      seen.add(key);
      const h = parseHotspot(f);
      if (h) hotspots.push(h);
    }
  }
  return { hotspots, error: null };
}
