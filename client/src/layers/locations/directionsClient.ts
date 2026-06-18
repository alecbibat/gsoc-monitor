// Client-side directions: calls Overpass (POI discovery) and OSRM (routing)
// directly from the browser. This bypasses any server-side network restrictions
// since all traffic originates from the user's own machine.

import type { DirectionsResponse, DirectionsLeg, DriveResult } from '../../types';

const OVERPASS = 'https://overpass-api.de/api/interpreter';
const OSRM = 'https://router.project-osrm.org';

type LegKind = 'hospital' | 'hotel' | 'police' | 'fire_station';

const GENERIC: Record<LegKind, string> = {
  hospital: 'Hospital',
  hotel: 'Hotel',
  police: 'Police Station',
  fire_station: 'Fire Station',
};

const DEDUP_GAP_M: Record<LegKind, number> = {
  hospital: 250,
  hotel: 60,
  police: 200,
  fire_station: 200,
};

const RADII: Record<LegKind, number[]> = {
  hospital: [12_000, 45_000, 120_000, 260_000],
  hotel:    [5_000,  15_000, 45_000,  90_000],
  police:   [12_000, 45_000, 130_000, 280_000],
  fire_station: [12_000, 45_000, 130_000, 280_000],
};

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

function overpassFilter(kind: LegKind): string {
  switch (kind) {
    case 'hospital':   return 'nwr["amenity"~"^(hospital|clinic)$"]';
    case 'hotel':      return 'nwr["tourism"="hotel"]';
    case 'police':     return 'nwr["amenity"="police"]';
    case 'fire_station': return 'nwr["amenity"="fire_station"]';
  }
}

interface Poi {
  name: string;
  lat: number;
  lon: number;
  distanceM: number;
}

function isSamePlace(a: Poi, b: Poi, kind: LegKind): boolean {
  const named = a.name === b.name && a.name !== GENERIC[kind];
  const gap = haversine(a.lat, a.lon, b.lat, b.lon);
  if (named && gap < 1500) return true;
  return gap < DEDUP_GAP_M[kind];
}

async function nearestPois(lat: number, lon: number, kind: LegKind, limit: number): Promise<Poi[]> {
  let bestSoFar: Poi[] = [];
  for (const radius of RADII[kind]) {
    const q = `[out:json][timeout:25];(${overpassFilter(kind)}(around:${radius},${lat},${lon}););out center 200;`;
    let data: { elements?: Array<{ lat?: number; lon?: number; center?: { lat: number; lon: number }; tags?: Record<string, string> }> };
    try {
      const r = await fetch(OVERPASS, {
        method: 'POST',
        body: `data=${encodeURIComponent(q)}`,
        headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
        signal: AbortSignal.timeout(28_000),
      });
      if (!r.ok) throw new Error(`Overpass HTTP ${r.status}`);
      data = (await r.json()) as typeof data;
    } catch {
      continue;
    }

    const pois: Poi[] = [];
    for (const el of data.elements ?? []) {
      const elLat = el.lat ?? el.center?.lat;
      const elLon = el.lon ?? el.center?.lon;
      if (elLat == null || elLon == null) continue;
      const d = haversine(lat, lon, elLat, elLon);
      if (kind === 'hotel' && d < 80) continue;
      pois.push({ name: el.tags?.name ?? GENERIC[kind], lat: elLat, lon: elLon, distanceM: d });
    }
    pois.sort((a, b) => a.distanceM - b.distanceM);

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

function formatStep(step: { maneuver?: { type?: string; modifier?: string }; name?: string }): string {
  const type = step.maneuver?.type;
  const mod = step.maneuver?.modifier;
  const road = step.name?.trim() ? step.name : 'the road';
  switch (type) {
    case 'depart':      return `Head out on ${road}`;
    case 'arrive':      return 'Arrive at your destination';
    case 'turn':        return `Turn ${mod ?? ''} onto ${road}`.replace(/\s+/g, ' ').trim();
    case 'end of road': return `At the end of the road, turn ${mod ?? ''} onto ${road}`.replace(/\s+/g, ' ').trim();
    case 'continue':    return `Continue on ${road}`;
    case 'new name':    return `Continue onto ${road}`;
    case 'merge':       return `Merge onto ${road}`;
    case 'on ramp':     return `Take the ramp onto ${road}`;
    case 'off ramp':    return `Take the exit toward ${road}`;
    case 'fork':        return `Keep ${mod ?? 'straight'} at the fork onto ${road}`.replace(/\s+/g, ' ').trim();
    case 'roundabout':
    case 'rotary':      return `Enter the roundabout and exit onto ${road}`;
    default:            return `Continue onto ${road}`;
  }
}

async function driveRoute(
  fromLat: number,
  fromLon: number,
  toLat: number,
  toLon: number
): Promise<{ distanceM: number; durationS: number; geometry: Array<[number, number]>; steps: Array<{ instruction: string; distanceM: number }> } | null> {
  const url =
    `${OSRM}/route/v1/driving/${fromLon},${fromLat};${toLon},${toLat}` +
    `?overview=full&geometries=geojson&steps=true`;
  try {
    const r = await fetch(url, { signal: AbortSignal.timeout(15_000) });
    if (!r.ok) return null;
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
    const steps = (route.legs?.[0]?.steps ?? [])
      .map((s) => ({ instruction: formatStep(s), distanceM: s.distance }))
      .filter((s) => s.instruction.length > 0);
    return {
      distanceM: route.distance,
      durationS: route.duration,
      geometry: route.geometry.coordinates,
      steps,
    };
  } catch {
    return null;
  }
}

async function routeLeg(lat: number, lon: number, poi: Poi, kind: LegKind): Promise<DirectionsLeg> {
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
  return {
    name: poi.name,
    category: kind,
    lat: poi.lat,
    lon: poi.lon,
    distanceM: poi.distanceM,
    durationS: 0,
    geometry: [[lon, lat], [poi.lon, poi.lat]],
    steps: [],
    routed: false,
  };
}

async function buildLegs(lat: number, lon: number, kind: LegKind, limit: number): Promise<DirectionsLeg[]> {
  const pois = await nearestPois(lat, lon, kind, limit);
  if (pois.length === 0) return [];
  const legs = await Promise.all(pois.map((poi) => routeLeg(lat, lon, poi, kind)));
  legs.sort((a, b) => {
    if (a.routed !== b.routed) return a.routed ? -1 : 1;
    if (a.routed && b.routed) return a.durationS - b.durationS;
    return a.distanceM - b.distanceM;
  });
  return legs;
}

export async function fetchDirections(lat: number, lon: number): Promise<DirectionsResponse> {
  const [hospitals, hotels, police, fireStations] = await Promise.all([
    buildLegs(lat, lon, 'hospital', OPTIONS_PER_KIND).catch(() => [] as DirectionsLeg[]),
    buildLegs(lat, lon, 'hotel',    OPTIONS_PER_KIND).catch(() => [] as DirectionsLeg[]),
    buildLegs(lat, lon, 'police',   OPTIONS_PER_KIND).catch(() => [] as DirectionsLeg[]),
    buildLegs(lat, lon, 'fire_station', 1).catch(() => [] as DirectionsLeg[]),
  ]);
  return { origin: { lat, lon }, hospitals, hotels, police, fireStations };
}

export async function fetchDriveRoute(
  fromLat: number,
  fromLon: number,
  toLat: number,
  toLon: number
): Promise<DriveResult> {
  const fallback: DriveResult = {
    distanceM: 0,
    durationS: 0,
    geometry: [[fromLon, fromLat], [toLon, toLat]],
    steps: [],
    routed: false,
  };
  const r = await driveRoute(fromLat, fromLon, toLat, toLon);
  if (!r) return fallback;
  return { ...r, routed: true };
}
