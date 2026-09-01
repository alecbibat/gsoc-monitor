import { Router } from 'express';
import { cache } from '../cache';

// Merged manifest for the rebuilt radar layer. Two sources:
//
// · US HD — IEM's NEXRAD N0Q composite. There is no upstream manifest: frames
//   exist every 5 minutes (minute % 5, UTC) at immutable timestamped tile
//   URLs, so the server just publishes the frame schedule from its own clock,
//   lagged enough that the newest advertised frame has actually been
//   generated (composites run ~3–8 minutes behind wall clock).
//
// · Global — RainViewer's free composite. Since 2026-01-01 the free tier is
//   past-radar-only with hash-based frame paths that must be re-read from
//   their manifest every cycle (stale paths 410). Nowcast and satellite IR
//   entries are officially discontinued, so they are dropped here even if the
//   upstream manifest still carries them.
//
// Tile images are fetched directly by the client from both providers' CDNs —
// never proxied through this single dyno.

const router = Router();

const US_INTERVAL_SEC = 300;
// Newest frame the client should ask for: enough lag that IEM has generated
// and cached it (composites run ~3–8 minutes behind wall clock — the lag must
// cover the slow end or the newest advertised frame's tiles don't exist yet).
const US_LAG_SEC = 480;
// IEM keeps timestamped frames for ~14 days; publish 2 hours — N frames span
// (N−1) intervals, so 120 min of 5-min frames needs 25.
const US_FRAME_COUNT = 25;

function usFrames(nowSec: number): number[] {
  const latest = Math.floor((nowSec - US_LAG_SEC) / US_INTERVAL_SEC) * US_INTERVAL_SEC;
  const frames: number[] = [];
  for (let i = US_FRAME_COUNT - 1; i >= 0; i--) frames.push(latest - i * US_INTERVAL_SEC);
  return frames;
}

interface RainViewerManifest {
  host: string;
  radar?: { past?: Array<{ time: number; path: string }> };
}

router.get('/', async (_req, res) => {
  let global: { host: string; frames: Array<{ time: number; path: string }> } | null = null;
  try {
    const rv = await cache.getOrFetch<RainViewerManifest>(
      'radar:rv-manifest',
      2 * 60_000,
      async () => {
        const upstream = await fetch('https://api.rainviewer.com/public/weather-maps.json', {
          signal: AbortSignal.timeout(10_000),
        });
        if (!upstream.ok) throw new Error(`RainViewer error: ${upstream.status}`);
        return (await upstream.json()) as RainViewerManifest;
      },
      { staleOnError: true }
    );
    if (rv?.host && rv.radar?.past?.length) {
      global = { host: rv.host, frames: rv.radar.past };
    }
  } catch (err) {
    // The US schedule needs no upstream, so a RainViewer outage degrades the
    // layer to HD-only instead of failing the endpoint.
    console.error('[radar] RainViewer manifest unavailable:', err);
  }

  // Health-probe IEM (a tiny z0 tile of the mutable "latest" layer) so the
  // client can degrade auto coverage honestly: when the HD source is down,
  // the global layer stops being masked over the US instead of leaving a
  // radar-shaped hole. Cached alongside the manifest cadence; a probe error
  // reports unavailable rather than failing the endpoint.
  const usAvailable = await cache
    .getOrFetch(
      'radar:iem-health',
      2 * 60_000,
      async () => {
        const res = await fetch(
          'https://mesonet.agron.iastate.edu/c/tile.py/1.0.0/ridge::USCOMP-N0Q-0/0/0/0.png',
          { signal: AbortSignal.timeout(6_000) }
        );
        return res.ok;
      },
      { staleOnError: true }
    )
    .catch(() => false);

  const nowSec = Math.floor(Date.now() / 1000);
  res.set('Cache-Control', 'public, max-age=60');
  res.json({
    global,
    us: { frames: usFrames(nowSec), intervalSec: US_INTERVAL_SEC, available: usAvailable },
    generated: nowSec,
  });
});

export default router;
