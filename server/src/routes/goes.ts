import { Router } from 'express';
import { cache } from '../cache';

const router = Router();

// Live geostationary GeoColor imagery time index.
//
// The tiles themselves are NASA GIBS WMTS tiles fetched directly by the client
// (public, keyless, CORS-enabled — same no-proxy policy as RainViewer). What
// the client can't do cheaply is discover WHICH timestamps exist: GIBS only
// serves imagery for exact 10-minute scan times, and each satellite publishes
// with its own ~20-60 min processing latency. This route asks GIBS for each
// layer's time domain (the OGC DescribeDomains extension), takes the newest
// timestamp available on EVERY covered satellite, and hands back a shared
// 10-minute frame timeline so the client's three imagery slices always animate
// in lockstep.
const GIBS_WMTS = 'https://gibs.earthdata.nasa.gov/wmts/epsg3857/best/wmts.cgi';
const TILE_MATRIX_SET = 'GoogleMapsCompatible_Level8';
const GIBS_LAYERS = [
  'GOES-East_ABI_GeoColor',
  'GOES-West_ABI_GeoColor',
  'Himawari_AHI_GeoColor',
];

const STEP_SEC = 600; // GeoColor scan cadence: one frame every 10 minutes
const TIMELINE_SEC = 3 * 3600; // serve the last 3h; the client windows it down
// A satellite lagging more than this behind the freshest one is treated as
// down (ground-segment outages happen) and excluded from the common-latest
// calculation instead of freezing the whole loop hours in the past.
const STALE_LAG_SEC = 2 * 3600;
// Fallback latency assumption when DescribeDomains is unreachable: GIBS
// geostationary ingest normally runs ~20-60 min behind real time, so an hour
// back is the newest frame we can assume exists without asking.
const FALLBACK_LATENCY_SEC = 3600;

const floorToStep = (sec: number) => Math.floor(sec / STEP_SEC) * STEP_SEC;

// 'YYYY-MM-DDTHH:MM:SSZ' — GIBS subdaily time values carry no milliseconds.
const isoNoMs = (sec: number) => new Date(sec * 1000).toISOString().replace('.000Z', 'Z');

// Newest timestamp (epoch seconds) in one layer's DescribeDomains response.
// The time domain arrives as comma-separated entries inside <Domain>…</Domain>,
// each either a single ISO time or a 'start/end/period' range — the newest
// instant is the largest single time or range end across every entry.
function parseLatest(xml: string): number | null {
  let latest: number | null = null;
  for (const [, content] of xml.matchAll(/<Domain>([^<]*)<\/Domain>/g)) {
    for (const entry of content.split(',')) {
      const parts = entry.trim().split('/');
      const endIso = parts.length > 1 ? parts[1] : parts[0];
      const t = Date.parse(endIso);
      if (Number.isFinite(t) && (latest == null || t / 1000 > latest)) latest = t / 1000;
    }
  }
  return latest;
}

async function fetchLayerLatest(layer: string, nowSec: number): Promise<number | null> {
  // Bound the query to the last day — the full domain spans a rolling 90 days
  // of 10-minute ranges and this keeps the response to a few hundred bytes.
  const url =
    `${GIBS_WMTS}?SERVICE=WMTS&REQUEST=DescribeDomains&VERSION=1.0.0` +
    `&LAYER=${layer}&TILEMATRIXSET=${TILE_MATRIX_SET}` +
    `&TIME=${isoNoMs(nowSec - 24 * 3600)}/${isoNoMs(nowSec + 3600)}`;
  const res = await fetch(url, { signal: AbortSignal.timeout(10_000) });
  if (!res.ok) throw new Error(`GIBS DescribeDomains ${layer}: HTTP ${res.status}`);
  const latest = parseLatest(await res.text());
  if (latest == null) return null;
  const floored = floorToStep(latest);
  // Discard nonsense (clock skew, malformed domain): the newest frame can't be
  // in the future or older than the bounded query window itself.
  if (floored > nowSec + STEP_SEC || floored < nowSec - 24 * 3600) return null;
  return floored;
}

function buildFrames(latest: number): number[] {
  const frames: number[] = [];
  for (let t = latest - TIMELINE_SEC + STEP_SEC; t <= latest; t += STEP_SEC) frames.push(t);
  return frames;
}

router.get('/', async (_req, res) => {
  res.set('Cache-Control', 'public, max-age=60');
  try {
    // Throwing on total DescribeDomains failure (rather than estimating inside
    // the fetcher) lets staleOnError serve the last real GIBS timeline —
    // old-but-true frame times beat arithmetic guesses, and an estimate must
    // never be cached as the "last good" value.
    const data = await cache.getOrFetch(
      'goes:times',
      2 * 60_000,
      async () => {
        const nowSec = Math.floor(Date.now() / 1000);
        const results = await Promise.allSettled(
          GIBS_LAYERS.map((l) => fetchLayerLatest(l, nowSec))
        );
        const latests = results
          .map((r) => (r.status === 'fulfilled' ? r.value : null))
          .filter((v): v is number => v != null);
        if (latests.length === 0) throw new Error('GIBS DescribeDomains unavailable');

        const freshest = Math.max(...latests);
        const fresh = latests.filter((t) => t >= freshest - STALE_LAG_SEC);
        const latest = Math.min(...fresh);
        return {
          frames: buildFrames(latest),
          latest,
          source: 'gibs' as const,
          updated: Date.now(),
        };
      },
      { staleOnError: true }
    );
    res.json(data);
  } catch {
    // Cold start during a GIBS outage (no last-good timeline to fall back on):
    // estimate from the usual ingest latency rather than 502. Tiles for a
    // not-yet-published frame just render empty, so worst case the newest
    // frame or two stay transparent until the next poll.
    const latest = floorToStep(Math.floor(Date.now() / 1000) - FALLBACK_LATENCY_SEC);
    res.json({
      frames: buildFrames(latest),
      latest,
      source: 'estimated' as const,
      updated: Date.now(),
    });
  }
});

export default router;
