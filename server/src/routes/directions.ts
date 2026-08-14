import { Router } from 'express';
import { cache } from '../cache';

const router = Router();

// NOT WIRED UP. `api.directions` in the client has no call sites — the panel
// calls client/src/layers/locations/directionsClient.ts directly — so this
// route and its 24h cache are currently dead, and its POI filters still
// predate the classifier. Do not point the client at this until it adopts
// client/src/layers/locations/poiClassifier.ts, or `amenity=clinic` will put
// acupuncturists and chiropractors back under "nearest hospital".
//
// Both services are free and keyless:
//  - Overpass (OpenStreetMap) finds the nearest hospital / hotel
//  - OSRM's public demo server computes the driving route + turn-by-turn steps
const OVERPASS = 'https://overpass-api.de/api/interpreter';
const OSRM = 'https://router.project-osrm.org';

const UA = 'gsoc-monitor/1.0 (national-parks dashboard)';

type LegKind = 'hospital' | 'hotel' | 'police' | 'fire_station';

// Generic fallback name + dedup distance per category.
const GENERIC: Record<LegKind, string> = {
  hospital: 'Hospital',
  hotel: 'Hotel',
  police: 'Police Station',
  fire_station: 'Fire Station',
};
const DEDUP_GAP_M: Record<LegKind, number> = { hospital: 250, hotel: 60, police: 200, fire_station: 200 };

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
  hospitals: Leg[];
  hotels: Leg[];
  police: Leg[];
  fireStations: Leg[];
}

// How many alternatives (A/B/C…) to return per category.
const OPTIONS_PER_KIND = 3;

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
  police: [12_000, 45_000, 130_000, 280_000],
  fire_station: [12_000, 45_000, 130_000, 280_000],
};

function overpassFilter(kind: LegKind): string {
  switch (kind) {
    case 'hospital':
      return 'nwr["amenity"~"^(hospital|clinic)$"]';
    case 'hotel':
      return 'nwr["tourism"="hotel"]';
    case 'police':
      return 'nwr["amenity"="police"]';
    case 'fire_station':
      return 'nwr["amenity"="fire_station"]';
  }
}

// Treat two POIs as the same real-world place when they're a named match
// nearby (multiple mapped buildings/entrances) or simply overlap on the map
// (OSM often stores a feature as both a node and a polygon).
function isSamePlace(a: Poi, b: Poi, kind: LegKind): boolean {
  const named = a.name === b.name && a.name !== GENERIC[kind];
  const gap = haversine(a.lat, a.lon, b.lat, b.lon);
  if (named && gap < 1500) return true;
  return gap < DEDUP_GAP_M[kind];
}

// Return up to `limit` distinct closest POIs (nearest first). Expands the
// search radius until it has enough options or runs out of radii.
async function nearestPois(
  lat: number,
  lon: number,
  kind: LegKind,
  limit: number
): Promise<Poi[]> {
  let bestSoFar: Poi[] = [];
  // Overall wall-clock budget across all radius attempts. Each Overpass call had
  // its own 28s timeout, but this function loops over several radii — so a couple
  // of slow calls could stack past Heroku's 30s request wall and trip an H12.
  // Bound the whole loop instead, and size each call's timeout to the time left.
  const deadline = Date.now() + 24_000;
  for (const radius of RADII[kind]) {
    const remaining = deadline - Date.now();
    if (remaining < 3_000) break; // not enough time left for a meaningful attempt
    const q =
      `[out:json][timeout:20];(${overpassFilter(kind)}(around:${radius},${lat},${lon}););out center 200;`;
    let data: { elements?: Array<{ lat?: number; lon?: number; center?: { lat: number; lon: number }; tags?: Record<string, string> }> };
    try {
      const r = await fetch(OVERPASS, {
        method: 'POST',
        body: `data=${encodeURIComponent(q)}`,
        headers: {
          'Content-Type': 'application/x-www-form-urlencoded',
          'User-Agent': UA,
        },
        signal: AbortSignal.timeout(Math.min(14_000, remaining)),
      });
      if (!r.ok) throw new Error(`Overpass HTTP ${r.status}`);
      data = (await r.json()) as typeof data;
    } catch (err) {
      console.error(`[directions] overpass ${kind} r=${radius}:`, err);
      continue; // try a wider radius
    }

    const pois: Poi[] = [];
    for (const el of data.elements ?? []) {
      const elLat = el.lat ?? el.center?.lat;
      const elLon = el.lon ?? el.center?.lon;
      if (elLat == null || elLon == null) continue;
      const d = haversine(lat, lon, elLat, elLon);
      // Skip the pin itself (a hotel pin will match its own building).
      if (kind === 'hotel' && d < 80) continue;
      pois.push({
        name: el.tags?.name ?? GENERIC[kind],
        lat: elLat,
        lon: elLon,
        distanceM: d,
      });
    }

    pois.sort((a, b) => a.distanceM - b.distanceM);

    // Collapse duplicate map entries for the same place.
    const distinct: Poi[] = [];
    for (const p of pois) {
      if (distinct.some((q) => isSamePlace(p, q, kind))) continue;
      distinct.push(p);
    }

    if (distinct.length > bestSoFar.length) bestSoFar = distinct;
    if (distinct.length >= limit) return distinct.slice(0, limit);
  }
  return bestSoFar.slice(0, limit);
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

async function routeLeg(lat: number, lon: number, poi: Poi, kind: LegKind): Promise<Leg> {
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

async function buildLegs(lat: number, lon: number, kind: LegKind, limit: number): Promise<Leg[]> {
  const pois = await nearestPois(lat, lon, kind, limit);
  if (pois.length === 0) return [];

  const legs = await Promise.all(pois.map((poi) => routeLeg(lat, lon, poi, kind)));

  // Order so option A is the closest by road: routed legs first (by drive
  // time), then any straight-line fallbacks (by distance).
  legs.sort((a, b) => {
    if (a.routed !== b.routed) return a.routed ? -1 : 1;
    if (a.routed && b.routed) return a.durationS - b.durationS;
    return a.distanceM - b.distanceM;
  });
  return legs;
}

router.get('/', async (req, res) => {
  const lat = Number(req.query.lat);
  const lon = Number(req.query.lon);
  if (!Number.isFinite(lat) || !Number.isFinite(lon)) {
    res.status(400).json({ error: 'lat and lon query params are required' });
    return;
  }

  // Pins are static, so cache aggressively (per ~11 m grid cell). Key is
  // versioned (v4) since the response shape now also returns fireStations.
  const key = `directions:v4:${lat.toFixed(4)}:${lon.toFixed(4)}`;
  const cached = cache.get<DirectionsResult>(key);
  if (cached) {
    res.json(cached);
    return;
  }

  try {
    const [hospitals, hotels, police, fireStations] = await Promise.all([
      buildLegs(lat, lon, 'hospital', OPTIONS_PER_KIND).catch((e) => {
        console.error('[directions] hospital legs failed:', e);
        return [] as Leg[];
      }),
      buildLegs(lat, lon, 'hotel', OPTIONS_PER_KIND).catch((e) => {
        console.error('[directions] hotel legs failed:', e);
        return [] as Leg[];
      }),
      buildLegs(lat, lon, 'police', OPTIONS_PER_KIND).catch((e) => {
        console.error('[directions] police legs failed:', e);
        return [] as Leg[];
      }),
      buildLegs(lat, lon, 'fire_station', 1).catch((e) => {
        console.error('[directions] fire_station legs failed:', e);
        return [] as Leg[];
      }),
    ]);

    const result: DirectionsResult = { origin: { lat, lon }, hospitals, hotels, police, fireStations };
    // Only cache a useful answer; otherwise let the next click retry.
    if (hospitals.length || hotels.length || police.length || fireStations.length) {
      cache.set(key, result, 24 * 60 * 60_000);
    }
    res.json(result);
  } catch (err) {
    console.error('[directions] failed:', err);
    res.status(502).json({ error: String(err) });
  }
});

export default router;
