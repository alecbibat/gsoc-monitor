// Client-side directions: calls Overpass (POI discovery) and OSRM (routing)
// directly from the browser. This bypasses any server-side network restrictions
// since all traffic originates from the user's own machine.
//
// What each category *counts* as lives in ./poiClassifier — this module only
// runs the queries and the radius sweep.

import type { DirectionsResponse, DirectionsLeg, DriveResult } from '../../types';
import { haversineMeters } from '../../lib/geo';
import {
  classify,
  isSelfMatch,
  overpassTiers,
  type LegKind,
  type OsmTags,
  type QueryTier,
} from './poiClassifier';

const OVERPASS = 'https://overpass-api.de/api/interpreter';
const OSRM = 'https://router.project-osrm.org';

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

// How many good results are worth widening the search for. Each extra radius
// step is another Overpass round trip, and now that only real hospitals count
// as hospitals, insisting on three of them would walk a rural pin out to
// 260 km — several sequential calls — to offer two alternatives an hour
// further away than the answer. For emergency categories the nearest one *is*
// the answer, so stop as soon as there is one. Lodging is the exception:
// alternatives genuinely matter when you are placing displaced guests.
const STOP_AFTER: Record<LegKind, number> = {
  hospital: 1,
  police: 1,
  fire_station: 1,
  hotel: OPTIONS_PER_KIND,
};

// Overall wall-clock budget for one category's tier sweep. The sweep can issue
// several Overpass calls (tiers × radii) and slow ones would otherwise stack up
// behind each other while the panel sits on a spinner.
const SWEEP_BUDGET_MS = 24_000;

interface Poi {
  name: string;
  lat: number;
  lon: number;
  distanceM: number;
  tier: number;
  serviceLabel: string;
}

function isSamePlace(a: Poi, b: Poi, kind: LegKind): boolean {
  const named = a.name === b.name && a.name !== GENERIC[kind];
  const gap = haversineMeters(a.lat, a.lon, b.lat, b.lon);
  if (named && gap < 1500) return true;
  return gap < DEDUP_GAP_M[kind];
}

interface OverpassElement {
  lat?: number;
  lon?: number;
  center?: { lat: number; lon: number };
  tags?: OsmTags;
}

async function overpassFetch(
  clauses: string[],
  radius: number,
  lat: number,
  lon: number,
  timeoutMs: number
): Promise<OverpassElement[]> {
  const around = `(around:${radius},${lat},${lon});`;
  const union = clauses.map((c) => `${c}${around}`).join('');
  const q = `[out:json][timeout:20];(${union});out center 200;`;
  const r = await fetch(OVERPASS, {
    method: 'POST',
    body: `data=${encodeURIComponent(q)}`,
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    signal: AbortSignal.timeout(timeoutMs),
  });
  if (!r.ok) throw new Error(`Overpass HTTP ${r.status}`);
  const data = (await r.json()) as { elements?: OverpassElement[] };
  return data.elements ?? [];
}

/** Widen the radius for one query tier until it has `limit` candidates good
 *  enough to satisfy that tier. Returns them sorted best-first. */
async function sweepTier(
  lat: number,
  lon: number,
  kind: LegKind,
  qt: QueryTier,
  limit: number,
  selfName: string | undefined,
  deadline: number
): Promise<Poi[]> {
  let bestSoFar: Poi[] = [];

  for (const radius of RADII[kind]) {
    const remaining = deadline - Date.now();
    if (remaining < 3_000) break; // not enough time left for a meaningful attempt

    let elements: OverpassElement[];
    try {
      elements = await overpassFetch(qt.clauses, radius, lat, lon, Math.min(14_000, remaining));
    } catch {
      continue; // try a wider radius
    }

    const pois: Poi[] = [];
    for (const el of elements) {
      const elLat = el.lat ?? el.center?.lat;
      const elLon = el.lon ?? el.center?.lon;
      if (elLat == null || elLon == null) continue;

      const tags = el.tags ?? {};
      const verdict = classify(tags, kind);
      if (!verdict) continue; // not actually one of these — see poiClassifier

      const name = tags.name ?? GENERIC[kind];
      const d = haversineMeters(lat, lon, elLat, elLon);
      if (kind === 'hotel' && isSelfMatch(name, selfName, d)) continue;

      pois.push({
        name,
        lat: elLat,
        lon: elLon,
        distanceM: d,
        tier: verdict.tier,
        serviceLabel: verdict.label,
      });
    }

    // Tier first, distance within a tier. A tier only ever fills when every
    // tier above it is empty, so this never puts a far result above a near one
    // of equal standing — see the TIER doc comment.
    pois.sort((a, b) => (a.tier !== b.tier ? a.tier - b.tier : a.distanceM - b.distanceM));

    // Collapse duplicate map entries for the same place (OSM often stores a
    // feature as both a node and a polygon). Sorted best-first, so the entry
    // that survives is the better-classified one.
    const distinct: Poi[] = [];
    for (const p of pois) {
      if (distinct.some((q) => isSamePlace(p, q, kind))) continue;
      distinct.push(p);
    }

    if (distinct.length > bestSoFar.length) bestSoFar = distinct;

    // Only results this tier actually asked for count toward stopping. Three
    // psychiatric hospitals nearby must not end the search for a general one
    // further out. A wider radius is a superset, so returning at the first
    // ring that satisfies never costs us a nearer result — only extra options.
    const satisfying = distinct.filter((p) => p.tier <= qt.satisfies).length;
    if (satisfying >= Math.min(limit, STOP_AFTER[kind])) {
      return distinct.slice(0, limit);
    }
  }
  return bestSoFar.slice(0, limit);
}

async function nearestPois(
  lat: number,
  lon: number,
  kind: LegKind,
  limit: number,
  selfName?: string
): Promise<Poi[]> {
  const deadline = Date.now() + SWEEP_BUDGET_MS;
  let best: Poi[] = [];

  for (const qt of overpassTiers(kind)) {
    const found = await sweepTier(lat, lon, kind, qt, limit, selfName, deadline);
    if (found.length && (best.length === 0 || found[0].tier < best[0].tier)) best = found;
    // Got what this tier was looking for — a wider net can only do worse.
    if (best.some((p) => p.tier <= qt.satisfies)) break;
    if (Date.now() >= deadline) break;
  }
  return best.slice(0, limit);
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
  const base = {
    name: poi.name,
    category: kind,
    lat: poi.lat,
    lon: poi.lon,
    tier: poi.tier,
    serviceLabel: poi.serviceLabel,
  };
  const r = await driveRoute(lat, lon, poi.lat, poi.lon);
  if (r) {
    return {
      ...base,
      distanceM: r.distanceM,
      durationS: r.durationS,
      geometry: r.geometry,
      steps: r.steps,
      routed: true,
    };
  }
  return {
    ...base,
    distanceM: poi.distanceM,
    durationS: 0,
    geometry: [[lon, lat], [poi.lon, poi.lat]],
    steps: [],
    routed: false,
  };
}

async function buildLegs(
  lat: number,
  lon: number,
  kind: LegKind,
  limit: number,
  selfName?: string
): Promise<DirectionsLeg[]> {
  const pois = await nearestPois(lat, lon, kind, limit, selfName);
  if (pois.length === 0) return [];
  const legs = await Promise.all(pois.map((poi) => routeLeg(lat, lon, poi, kind)));

  // Order so option A is the best answer: tier outranks everything, since a
  // routed clinic is still not a hospital. Then routed legs by drive time,
  // then straight-line fallbacks by distance.
  legs.sort((a, b) => {
    if ((a.tier ?? 0) !== (b.tier ?? 0)) return (a.tier ?? 0) - (b.tier ?? 0);
    if (a.routed !== b.routed) return a.routed ? -1 : 1;
    if (a.routed && b.routed) return a.durationS - b.durationS;
    return a.distanceM - b.distanceM;
  });
  return legs;
}

export async function fetchDirections(
  lat: number,
  lon: number,
  /** The pin's own name, so a hotel pin isn't offered directions to itself. */
  selfName?: string
): Promise<DirectionsResponse> {
  const [hospitals, hotels, police, fireStations] = await Promise.all([
    buildLegs(lat, lon, 'hospital', OPTIONS_PER_KIND).catch(() => [] as DirectionsLeg[]),
    buildLegs(lat, lon, 'hotel',    OPTIONS_PER_KIND, selfName).catch(() => [] as DirectionsLeg[]),
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
