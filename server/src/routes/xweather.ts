import { Router } from 'express';
import { config } from '../config';

const router = Router();

// Proxy for Xweather (Vaisala) Raster Maps lightning tiles — the NLDN-quality
// strike map (what Dataminr renders). Tiles are fetched with the server-side
// client_id/client_secret so keys never reach the browser, and cached briefly
// because icon layers bill at a 10x multiplier per tile: a user panning the
// globe should hit our cache, not Xweather's meter, for repeated tiles.
//
// Docs: https://www.xweather.com/docs/maps/getting-started/map-tiles
//   https://maps{1-4}.api.xweather.com/{id}_{secret}/{layer}/{z}/{x}/{y}/{time}.png
// Every lightning layer carries a -7 day history window addressable by time
// offset (-3hours) or exact valid time (YYYYMMDDhhiiss).

// Only the lightning layers we surface — an open proxy over every Xweather
// layer would let any signed-out visitor spend the account's map units.
const LAYERS = new Set([
  'lightning-strikes-5m', // CG strikes, 5-minute window (dots)
  'lightning-strikes-15m', // CG strikes, 15-minute window (dots)
  'lightning-strikes-5m-icons', // CG strikes, balloon markers (the Dataminr look)
  'lightning-strikes-15m-icons',
  'lightning-all-5m', // CG + intracloud pulses (icon markers)
  'lightning-all-15m',
  'lightning-flash', // aggregated flashes (1x multiplier variant)
  'lightning-strike-density', // NOAA 8km heat map (US/Central America)
]);

// current | -30minutes / -3hours / -2days | 14-digit UTC valid time
const TIME_RE = /^(current|-\d{1,4}(minutes?|hours?|days?)|\d{14})$/;
const MAX_ZOOM = 10; // icon tiles are legible well below native max; caps unit burn

// Tiny TTL+LRU tile cache. ~600 PNGs × ~15 KB ≈ 9 MB ceiling. Historical
// valid-time tiles are immutable so they cache long; "current"/offset tiles
// roll over with the layer's 5-minute update cadence.
interface TileEntry {
  body: Buffer;
  contentType: string;
  expiresAt: number;
}
const tileCache = new Map<string, TileEntry>();
const TILE_CACHE_MAX = 600;

function cacheGet(key: string): TileEntry | null {
  const hit = tileCache.get(key);
  if (!hit) return null;
  if (Date.now() > hit.expiresAt) {
    tileCache.delete(key);
    return null;
  }
  // Refresh recency for LRU eviction.
  tileCache.delete(key);
  tileCache.set(key, hit);
  return hit;
}
function cacheSet(key: string, entry: TileEntry): void {
  tileCache.set(key, entry);
  if (tileCache.size > TILE_CACHE_MAX) {
    const oldest = tileCache.keys().next().value;
    if (oldest !== undefined) tileCache.delete(oldest);
  }
}

const configured = () => Boolean(config.xweatherClientId && config.xweatherClientSecret);

// Lets the sidebar show a "set keys" hint instead of a dead toggle.
router.get('/status', (_req, res) => {
  res.json({ configured: configured() });
});

router.get('/tiles/:layer/:z/:x/:y/:time.png', async (req, res) => {
  if (!configured()) {
    res.status(501).json({ error: 'Xweather is not configured — set XWEATHER_CLIENT_ID and XWEATHER_CLIENT_SECRET' });
    return;
  }
  const { layer, time } = req.params;
  const z = Number(req.params.z);
  const x = Number(req.params.x);
  const y = Number(req.params.y);
  if (!LAYERS.has(layer)) {
    res.status(400).json({ error: 'Unsupported layer' });
    return;
  }
  if (!Number.isInteger(z) || !Number.isInteger(x) || !Number.isInteger(y) || z < 0 || z > MAX_ZOOM || x < 0 || y < 0) {
    res.status(400).json({ error: 'Bad tile coordinates' });
    return;
  }
  if (!TIME_RE.test(time)) {
    res.status(400).json({ error: 'Bad time — use current, -3hours, or YYYYMMDDhhiiss' });
    return;
  }

  const key = `${layer}/${z}/${x}/${y}/${time}`;
  const cached = cacheGet(key);
  if (cached) {
    res.set('Content-Type', cached.contentType);
    res.set('Cache-Control', 'public, max-age=240');
    res.send(cached.body);
    return;
  }

  // Spread requests across Xweather's 4 tile hosts.
  const server = ((x + y) % 4) + 1;
  const url =
    `https://maps${server}.api.xweather.com/` +
    `${config.xweatherClientId}_${config.xweatherClientSecret}/${layer}/${z}/${x}/${y}/${time}.png`;
  try {
    const upstream = await fetch(url, { signal: AbortSignal.timeout(12_000) });
    if (!upstream.ok) {
      // Don't leak the keyed URL in errors.
      res.status(upstream.status === 401 || upstream.status === 403 ? 502 : upstream.status).json({
        error: `Xweather tile error (HTTP ${upstream.status})`,
      });
      return;
    }
    const body = Buffer.from(await upstream.arrayBuffer());
    const contentType = upstream.headers.get('content-type') ?? 'image/png';
    // Fixed valid times are immutable → cache 1h; rolling times ride the
    // 5-minute layer update cadence.
    const ttl = /^\d{14}$/.test(time) ? 60 * 60_000 : 4 * 60_000;
    cacheSet(key, { body, contentType, expiresAt: Date.now() + ttl });
    res.set('Content-Type', contentType);
    res.set('Cache-Control', 'public, max-age=240');
    res.send(body);
  } catch (err) {
    res.status(502).json({ error: 'Xweather tile fetch failed', detail: err instanceof Error ? err.message : String(err) });
  }
});

export default router;
