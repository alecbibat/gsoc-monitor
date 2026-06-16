import { Router } from 'express';
import { cache } from '../cache';

const router = Router();

// Both services are free and keyless:
//  - Overpass (OpenStreetMap) finds the nearest hospital / hotel
//  - OSRM's public demo server computes the driving route + turn-by-turn steps
const OVERPASS = 'https://overpass-api.de/api/interpreter';
const OSRM = 'https://router.project-osrm.org';

const UA = 'gsoc-monitor/1.0 (national-parks dashboard)';

type LegKind = 'hospital' | 'hotel';

interface Poi {
  name: string;
  lat: number;
  lon: number;
  distanceM: number;
}

interface RouteStep {
  instruction: string;
  distanceM: number;
}

interface Leg {
  name: string;
  category: LegKind;
  lat: number;
  lon: number;
  distanceM: number; // road distance when routed, else straight-line
  durationS: number;
  geometry: Array<[number, number]>; // [lon, lat] pairs
  steps: RouteStep[];
  routed: boolean; // false = OSRM had no route, geometry is a straight line
}

interface DirectionsResult {
  origin: { lat: number; lon: number };
  hospital: Leg | null;
  hotel: Leg | null;
}

function haversine(aLat: number, aLon: number, bLat: number, bLon: number): number {
  const R = 6_371_000;
  const dLat = ((bLat - aLat) * Math.PI) / 180;
  const dLon = ((bLon - aLon) * Math.PI) / 180;
  const s =
    Math.sin(dLat / 2) ** 2 +
    Math.cos((aLat * Math.PI) / 180) *
      Math.cos((bLat * Math.PI) / 180) *
      Math.sin(dLon / 2) ** 2;
  return 2 * R * Math.asin(Math.sqrt(s));
}

// Progressive radii (metres). Starting small keeps dense-city result sets
// complete (so the true nearest is included) while still reaching POIs in
// remote parks by expanding outward only when nothing closer was found.
const RADII: Record<LegKind, number[]> = {
  hospital: [12_000, 45_000, 120_000, 260_000],
  hotel: [5_000, 15_000, 45_000, 90_000],
};

function overpassFilter(kind: LegKind): string {
  return kind === 'hospital'
    ? 'nwr["amenity"~"^(hospital|clinic)$"]'
    : 'nwr["tourism"="hotel"]';
}

async function nearestPoi(lat: number, lon: number, kind: LegKind): Promise<Poi | null> {
  for (const radius of RADII[kind]) {
    const q =
      `[out:json][timeout:25];(${overpassFilter(kind)}(around:${radius},${lat},${lon}););out center 120;`;
    let data: { elements?: Array<{ lat?: number; lon?: number; center?: { lat: number; lon: number }; tags?: Record<string, string> }> };
    try {
      const r = await fetch(OVERPASS, {
        method: 'POST',
        body: `data=${encodeURIComponent(q)}`,
        headers: {
          'Content-Type': 'application/x-www-form-urlencoded',
          'User-Agent': UA,
        },
        signal: AbortSignal.timeout(28_000),
      });
      if (!r.ok) throw new Error(`Overpass HTTP ${r.status}`);
      data = (await r.json()) as typeof data;
    } catch (err) {
      console.error(`[directions] overpass ${kind} r=${radius}:`, err);
      continue; // try a wider radius
    }

    let best: Poi | null = null;
    for (const el of data.elements ?? []) {
      const elLat = el.lat ?? el.center?.lat;
      const elLon = el.lon ?? el.center?.lon;
      if (elLat == null || elLon == null) continue;
      const d = haversine(lat, lon, elLat, elLon);
      // Skip the pin itself (a hotel pin will match its own building).
      if (kind === 'hotel' && d < 80) continue;
      if (!best || d < best.distanceM) {
        best = {
          name: el.tags?.name ?? (kind === 'hospital' ? 'Hospital' : 'Hotel'),
          lat: elLat,
          lon: elLon,
          distanceM: d,
        };
      }
    }
    if (best) return best;
  }
  return null;
}

function formatStep(step: {
  maneuver?: { type?: string; modifier?: string };
  name?: string;
}): string {
  const type = step.maneuver?.type;
  const mod = step.maneuver?.modifier;
  const road = step.name && step.name.trim() ? step.name : 'the road';
  switch (type) {
    case 'depart':
      return `Head out on ${road}`;
    case 'arrive':
      return 'Arrive at your destination';
    case 'turn':
      return `Turn ${mod ?? ''} onto ${road}`.replace(/\s+/g, ' ').trim();
    case 'end of road':
      return `At the end of the road, turn ${mod ?? ''} onto ${road}`.replace(/\s+/g, ' ').trim();
    case 'continue':
      return `Continue on ${road}`;
    case 'new name':
      return `Continue onto ${road}`;
    case 'merge':
      return `Merge onto ${road}`;
    case 'on ramp':
      return `Take the ramp onto ${road}`;
    case 'off ramp':
      return `Take the exit toward ${road}`;
    case 'fork':
      return `Keep ${mod ?? 'straight'} at the fork onto ${road}`.replace(/\s+/g, ' ').trim();
    case 'roundabout':
    case 'rotary':
      return `Enter the roundabout and exit onto ${road}`;
    default:
      return `Continue onto ${road}`;
  }
}

async function driveRoute(
  fromLat: number,
  fromLon: number,
  toLat: number,
  toLon: number
): Promise<{ distanceM: number; durationS: number; geometry: Array<[number, number]>; steps: RouteStep[] } | null> {
  const url =
    `${OSRM}/route/v1/driving/${fromLon},${fromLat};${toLon},${toLat}` +
    `?overview=full&geometries=geojson&steps=true`;
  const r = await fetch(url, {
    headers: { 'User-Agent': UA },
    signal: AbortSignal.timeout(15_000),
  });
  if (!r.ok) throw new Error(`OSRM HTTP ${r.status}`);
  const data = (await r.json()) as {
    code?: string;
    routes?: Array<{
      distance: number;
      duration: number;
      geometry: { coordinates: Array<[number, number]> };
      legs?: Array<{ steps?: Array<{ distance: number; name?: string; maneuver?: { type?: string; modifier?: string } }> }>;
    }>;
  };
  const route = data.routes?.[0];
  if (data.code !== 'Ok' || !route) return null;
  const steps: RouteStep[] = (route.legs?.[0]?.steps ?? [])
    .map((s) => ({ instruction: formatStep(s), distanceM: s.distance }))
    .filter((s) => s.instruction.length > 0);
  return {
    distanceM: route.distance,
    durationS: route.duration,
    geometry: route.geometry.coordinates,
    steps,
  };
}

async function buildLeg(lat: number, lon: number, kind: LegKind): Promise<Leg | null> {
  const poi = await nearestPoi(lat, lon, kind);
  if (!poi) return null;

  try {
    const r = await driveRoute(lat, lon, poi.lat, poi.lon);
    if (r) {
      return {
        name: poi.name,
        category: kind,
        lat: poi.lat,
        lon: poi.lon,
        distanceM: r.distanceM,
        durationS: r.durationS,
        geometry: r.geometry,
        steps: r.steps,
        routed: true,
      };
    }
  } catch (err) {
    console.error(`[directions] osrm ${kind}:`, err);
  }

  // Routing failed — still return the POI with a straight-line fallback so the
  // user at least sees where it is and can open Google Maps for live routing.
  return {
    name: poi.name,
    category: kind,
    lat: poi.lat,
    lon: poi.lon,
    distanceM: poi.distanceM,
    durationS: 0,
    geometry: [
      [lon, lat],
      [poi.lon, poi.lat],
    ],
    steps: [],
    routed: false,
  };
}

router.get('/', async (req, res) => {
  const lat = Number(req.query.lat);
  const lon = Number(req.query.lon);
  if (!Number.isFinite(lat) || !Number.isFinite(lon)) {
    res.status(400).json({ error: 'lat and lon query params are required' });
    return;
  }

  // Pins are static, so cache aggressively (per ~11 m grid cell).
  const key = `directions:${lat.toFixed(4)}:${lon.toFixed(4)}`;
  const cached = cache.get<DirectionsResult>(key);
  if (cached) {
    res.json(cached);
    return;
  }

  try {
    const [hospital, hotel] = await Promise.all([
      buildLeg(lat, lon, 'hospital').catch((e) => {
        console.error('[directions] hospital leg failed:', e);
        return null;
      }),
      buildLeg(lat, lon, 'hotel').catch((e) => {
        console.error('[directions] hotel leg failed:', e);
        return null;
      }),
    ]);

    const result: DirectionsResult = { origin: { lat, lon }, hospital, hotel };
    // Only cache a useful answer; otherwise let the next click retry.
    if (hospital || hotel) cache.set(key, result, 24 * 60 * 60_000);
    res.json(result);
  } catch (err) {
    console.error('[directions] failed:', err);
    res.status(502).json({ error: String(err) });
  }
});

export default router;
