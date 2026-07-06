import { Router } from 'express';
import { cache } from '../cache';

const router = Router();

const TTL_MS = 2 * 60 * 60 * 1000; // 2 hours — HMS updates once or twice a day

// --- KML URL helpers ---

function padTwo(n: number): string {
  return String(n).padStart(2, '0');
}

function kmlUrl(date: Date): string {
  // UTC getters — the fallback walk and labels below are UTC, and a local-time
  // file name would fetch the wrong (or a not-yet-existing) day's product on
  // any server whose TZ isn't UTC.
  const y = date.getUTCFullYear();
  const m = padTwo(date.getUTCMonth() + 1);
  const d = padTwo(date.getUTCDate());
  return (
    `https://satepsanone.nesdis.noaa.gov/pub/FIRE/web/HMS/Smoke_Polygons/KML/${y}/${m}/hms_smoke${y}${m}${d}.kml`
  );
}

// --- KML parser ---

interface SmokePolygon {
  id: string;
  density: 'Light' | 'Medium' | 'Heavy';
  coords: number[][];
  satellite?: string;
  startTime?: string;
  endTime?: string;
}

function parseKml(kml: string, dateLabel: string): SmokePolygon[] {
  const polygons: SmokePolygon[] = [];
  let idx = 0;

  // Match each <Placemark>…</Placemark> block
  const placemarkRe = /<Placemark>([\s\S]*?)<\/Placemark>/g;
  let pm: RegExpExecArray | null;

  while ((pm = placemarkRe.exec(kml)) !== null) {
    const block = pm[1];

    // Density from styleUrl
    const styleMatch = block.match(/#Smoke_(Light|Medium|Heavy)_style/);
    if (!styleMatch) continue;
    const density = styleMatch[1] as 'Light' | 'Medium' | 'Heavy';

    // Coordinates
    const coordMatch = block.match(/<coordinates>([\s\S]*?)<\/coordinates>/);
    if (!coordMatch) continue;
    const coords = coordMatch[1]
      .trim()
      .split(/\s+/)
      .map((triple) => triple.split(',').map(Number).slice(0, 2) as [number, number])
      .filter(([lon, lat]) => Number.isFinite(lon) && Number.isFinite(lat));
    if (coords.length < 3) continue;

    // Optional metadata from description CDATA
    const startMatch = block.match(/Start Time:\s*([\d\s]+UTC)/);
    const endMatch = block.match(/End Time:\s*([\d\s]+UTC)/);
    const satMatch = block.match(/Satellite:\s*([^<\r\n]+)/);

    polygons.push({
      id: `smoke-${dateLabel}-${idx++}`,
      density,
      coords,
      satellite: satMatch?.[1]?.trim(),
      startTime: startMatch?.[1]?.trim(),
      endTime: endMatch?.[1]?.trim(),
    });
  }

  return polygons;
}

// --- Fetch with fallback ---

interface SmokePayload {
  polygons: SmokePolygon[];
  date: string;
  updated: number;
  source: string;
  error?: string;
}

async function fetchSmokeData(): Promise<SmokePayload> {
  const now = new Date();
  // Try today, yesterday, day-before; HMS often posts late in the day so the
  // previous day's file is the most recent complete product until ~midday ET.
  for (let back = 0; back <= 2; back++) {
    const d = new Date(now);
    d.setUTCDate(d.getUTCDate() - back);
    const label = `${d.getUTCFullYear()}${padTwo(d.getUTCMonth() + 1)}${padTwo(d.getUTCDate())}`;
    const url = kmlUrl(d);

    let text: string;
    try {
      const res = await fetch(url, { signal: AbortSignal.timeout(10_000) });
      if (!res.ok) continue;
      text = await res.text();
    } catch {
      continue;
    }

    const polygons = parseKml(text, label);
    if (polygons.length === 0) continue; // empty file — try previous day

    return {
      polygons,
      date: label,
      updated: Date.now(),
      source: `NOAA HMS ${d.toISOString().slice(0, 10)}`,
    };
  }

  return {
    polygons: [],
    date: '',
    updated: Date.now(),
    source: 'NOAA HMS',
    error: 'No HMS smoke data available for the past 3 days',
  };
}

// --- Route ---

router.get('/', async (_req, res) => {
  try {
    const data = await cache.getOrFetch<SmokePayload>('smoke', TTL_MS, fetchSmokeData, {
      staleOnError: true,
    });
    res.json(data);
  } catch (err) {
    console.error('Smoke route error', err);
    res.status(502).json({ error: 'HMS smoke feed unavailable' });
  }
});

export default router;
