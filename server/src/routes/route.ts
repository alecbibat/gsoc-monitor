import { Router } from 'express';
import { cache } from '../cache';

const router = Router();
const OSRM = 'https://router.project-osrm.org';
const UA = 'gsoc-monitor/1.0 (national-parks dashboard)';

export interface DriveResult {
  distanceM: number;
  durationS: number;
  geometry: Array<[number, number]>; // [lon, lat] pairs
  steps: Array<{ instruction: string; distanceM: number }>;
  routed: boolean;
}

function formatStep(step: {
  maneuver?: { type?: string; modifier?: string };
  name?: string;
}): string {
  const type = step.maneuver?.type;
  const mod = step.maneuver?.modifier;
  const road = step.name && step.name.trim() ? step.name : 'the road';
  switch (type) {
    case 'depart': return `Head out on ${road}`;
    case 'arrive': return 'Arrive at your destination';
    case 'turn': return `Turn ${mod ?? ''} onto ${road}`.replace(/\s+/g, ' ').trim();
    case 'end of road': return `At the end of the road, turn ${mod ?? ''} onto ${road}`.replace(/\s+/g, ' ').trim();
    case 'continue': return `Continue on ${road}`;
    case 'new name': return `Continue onto ${road}`;
    case 'merge': return `Merge onto ${road}`;
    case 'on ramp': return `Take the ramp onto ${road}`;
    case 'off ramp': return `Take the exit toward ${road}`;
    case 'fork': return `Keep ${mod ?? 'straight'} at the fork onto ${road}`.replace(/\s+/g, ' ').trim();
    case 'roundabout':
    case 'rotary': return `Enter the roundabout and exit onto ${road}`;
    default: return `Continue onto ${road}`;
  }
}

// GET /api/drive?fromLat=…&fromLon=…&toLat=…&toLon=…
router.get('/', async (req, res) => {
  const fromLat = Number(req.query.fromLat);
  const fromLon = Number(req.query.fromLon);
  const toLat = Number(req.query.toLat);
  const toLon = Number(req.query.toLon);

  if (
    !Number.isFinite(fromLat) || !Number.isFinite(fromLon) ||
    !Number.isFinite(toLat) || !Number.isFinite(toLon)
  ) {
    res.status(400).json({ error: 'fromLat, fromLon, toLat, toLon are required' });
    return;
  }

  const key = `route:v1:${fromLat.toFixed(4)}:${fromLon.toFixed(4)}:${toLat.toFixed(4)}:${toLon.toFixed(4)}`;
  const cached = cache.get<DriveResult>(key);
  if (cached) { res.json(cached); return; }

  const fallback: DriveResult = {
    distanceM: 0, durationS: 0,
    geometry: [[fromLon, fromLat], [toLon, toLat]],
    steps: [], routed: false,
  };

  try {
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
        legs?: Array<{
          steps?: Array<{ distance: number; name?: string; maneuver?: { type?: string; modifier?: string } }>;
        }>;
      }>;
    };
    const route = data.routes?.[0];
    if (data.code !== 'Ok' || !route) { res.json(fallback); return; }

    const steps = (route.legs?.[0]?.steps ?? [])
      .map((s) => ({ instruction: formatStep(s), distanceM: s.distance }))
      .filter((s) => s.instruction.length > 0);

    const result: DriveResult = {
      distanceM: route.distance,
      durationS: route.duration,
      geometry: route.geometry.coordinates,
      steps,
      routed: true,
    };
    cache.set(key, result, 24 * 60 * 60_000);
    res.json(result);
  } catch (err) {
    console.error('[drive] OSRM failed:', err);
    res.json(fallback);
  }
});

export default router;
