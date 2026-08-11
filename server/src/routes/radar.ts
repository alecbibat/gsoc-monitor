import { Router } from 'express';
import zlib from 'zlib';
import { cache } from '../cache';

const router = Router();

// ---------------------------------------------------------------------------
// TEMPORARY diagnostic (see /diag below): minimal PNG decoder + pixel stats so
// we can inspect what RainViewer's tile endpoints actually serve. The sandbox
// the client work happens in cannot reach rainviewer.com, and the tile
// encoding differs from every public description of it — this endpoint gives
// ground truth. Remove once the client-side palette is calibrated.
// ---------------------------------------------------------------------------

function decodePng(buf: Buffer): { width: number; height: number; colorType: number; rgba: Uint8Array } {
  if (buf.length < 8 || buf.readUInt32BE(0) !== 0x89504e47) throw new Error('not a png');
  let off = 8;
  let width = 0;
  let height = 0;
  let bitDepth = 0;
  let colorType = 0;
  let interlace = 0;
  let palette: Buffer | null = null;
  let trns: Buffer | null = null;
  const idat: Buffer[] = [];
  while (off + 8 <= buf.length) {
    const len = buf.readUInt32BE(off);
    const type = buf.toString('ascii', off + 4, off + 8);
    const data = buf.subarray(off + 8, off + 8 + len);
    if (type === 'IHDR') {
      width = data.readUInt32BE(0);
      height = data.readUInt32BE(4);
      bitDepth = data[8];
      colorType = data[9];
      interlace = data[12];
    } else if (type === 'PLTE') palette = Buffer.from(data);
    else if (type === 'tRNS') trns = Buffer.from(data);
    else if (type === 'IDAT') idat.push(data);
    else if (type === 'IEND') break;
    off += 12 + len;
  }
  if (bitDepth !== 8) throw new Error(`unsupported bit depth ${bitDepth}`);
  if (interlace !== 0) throw new Error('interlaced png unsupported');
  const channels = colorType === 0 ? 1 : colorType === 2 ? 3 : colorType === 3 ? 1 : colorType === 4 ? 2 : 4;
  const raw = zlib.inflateSync(Buffer.concat(idat));
  const stride = width * channels;
  const out = new Uint8Array(stride * height);
  let pos = 0;
  for (let y = 0; y < height; y++) {
    const filter = raw[pos++];
    const prev = y > 0 ? out.subarray((y - 1) * stride, y * stride) : null;
    const cur = out.subarray(y * stride, (y + 1) * stride);
    for (let x = 0; x < stride; x++) {
      const a = x >= channels ? cur[x - channels] : 0;
      const b = prev ? prev[x] : 0;
      const c = x >= channels && prev ? prev[x - channels] : 0;
      let v = raw[pos + x];
      if (filter === 1) v = (v + a) & 255;
      else if (filter === 2) v = (v + b) & 255;
      else if (filter === 3) v = (v + ((a + b) >> 1)) & 255;
      else if (filter === 4) {
        const p = a + b - c;
        const pa = Math.abs(p - a);
        const pb = Math.abs(p - b);
        const pc = Math.abs(p - c);
        v = (v + (pa <= pb && pa <= pc ? a : pb <= pc ? b : c)) & 255;
      } else if (filter !== 0) throw new Error(`bad filter ${filter}`);
      cur[x] = v;
    }
    pos += stride;
  }
  const rgba = new Uint8Array(width * height * 4);
  for (let i = 0; i < width * height; i++) {
    const s = i * channels;
    const o = i * 4;
    if (colorType === 0) {
      rgba[o] = rgba[o + 1] = rgba[o + 2] = out[s];
      rgba[o + 3] = 255;
    } else if (colorType === 2) {
      rgba[o] = out[s];
      rgba[o + 1] = out[s + 1];
      rgba[o + 2] = out[s + 2];
      rgba[o + 3] = 255;
    } else if (colorType === 3) {
      const idx = out[s];
      rgba[o] = palette ? palette[idx * 3] : 0;
      rgba[o + 1] = palette ? palette[idx * 3 + 1] : 0;
      rgba[o + 2] = palette ? palette[idx * 3 + 2] : 0;
      rgba[o + 3] = trns && idx < trns.length ? trns[idx] : 255;
    } else if (colorType === 4) {
      rgba[o] = rgba[o + 1] = rgba[o + 2] = out[s];
      rgba[o + 3] = out[s + 1];
    } else {
      rgba[o] = out[s];
      rgba[o + 1] = out[s + 1];
      rgba[o + 2] = out[s + 2];
      rgba[o + 3] = out[s + 3];
    }
  }
  return { width, height, colorType, rgba };
}

function tileStats(png: { colorType: number; rgba: Uint8Array }) {
  const colors = new Map<string, number>();
  let opaque = 0;
  let transparent = 0;
  let semi = 0;
  let gray = 0;
  const rHist = new Array(16).fill(0) as number[];
  const d = png.rgba;
  for (let i = 0; i < d.length; i += 4) {
    const a = d[i + 3];
    if (a === 0) {
      transparent++;
      continue;
    }
    if (a < 255) semi++;
    else opaque++;
    const r = d[i];
    if (r === d[i + 1] && d[i + 1] === d[i + 2]) gray++;
    rHist[r >> 4]++;
    const key = `${r},${d[i + 1]},${d[i + 2]},${a}`;
    colors.set(key, (colors.get(key) ?? 0) + 1);
  }
  const visible = opaque + semi;
  const topColors = [...colors.entries()]
    .sort((x, y) => y[1] - x[1])
    .slice(0, 14)
    .map(([k, n]) => `rgba(${k})×${n}`);
  return {
    pngColorType: png.colorType,
    px: d.length / 4,
    transparent,
    semi,
    opaque,
    grayFrac: visible ? +(gray / visible).toFixed(3) : 0,
    rHist,
    topColors,
  };
}

async function fetchTileStats(url: string) {
  try {
    const res = await fetch(url, { signal: AbortSignal.timeout(10_000) });
    if (!res.ok) return { url, error: `HTTP ${res.status}` };
    const buf = Buffer.from(await res.arrayBuffer());
    return { url, ...tileStats(decodePng(buf)) };
  } catch (err) {
    return { url, error: String(err) };
  }
}

// TEMPORARY: inspect what RainViewer's tile endpoints actually serve. Finds
// the CONUS z5 tile with the most echo in the latest frame, then reports
// pixel statistics for the raw scheme (0/0_1), its smoothed variant, two
// documented color schemes for cross-reference, and the latest IR satellite
// tile. Read-only; remove after the client palette is calibrated.
router.get('/diag', async (_req, res) => {
  try {
    const upstream = await fetch('https://api.rainviewer.com/public/weather-maps.json', {
      signal: AbortSignal.timeout(10_000),
    });
    if (!upstream.ok) throw new Error(`manifest HTTP ${upstream.status}`);
    const manifest = (await upstream.json()) as {
      host: string;
      radar: { past: Array<{ time: number; path: string }> };
      satellite?: { infrared?: Array<{ time: number; path: string }> };
    };
    const frame = manifest.radar.past[manifest.radar.past.length - 1];
    const candidates: Array<[number, number]> = [
      [7, 11],
      [8, 11],
      [9, 11],
      [7, 12],
      [8, 12],
      [9, 12],
    ];
    let best: { x: number; y: number; visible: number; stats: unknown } | null = null;
    for (const [x, y] of candidates) {
      const s = await fetchTileStats(
        `${manifest.host}${frame.path}/512/5/${x}/${y}/0/0_1.png`
      );
      const visible = 'px' in s ? (s.opaque ?? 0) + (s.semi ?? 0) : 0;
      if (!best || visible > best.visible) best = { x, y, visible, stats: s };
    }
    if (!best) throw new Error('no candidate tiles');
    const { x, y } = best;
    const base = `${manifest.host}${frame.path}/512/5/${x}/${y}`;
    const sat = manifest.satellite?.infrared?.slice(-1)[0];
    res.json({
      note: 'temporary radar tile diagnostic — safe to share this whole JSON',
      frameTime: frame.time,
      tile: { z: 5, x, y },
      raw_0_0_1: best.stats,
      rawSmoothed_0_1_1: await fetchTileStats(`${base}/0/1_1.png`),
      universalBlue_2_1_0: await fetchTileStats(`${base}/2/1_0.png`),
      twc_4_1_0: await fetchTileStats(`${base}/4/1_0.png`),
      satellite_0_0_0: sat
        ? await fetchTileStats(`${manifest.host}${sat.path}/512/5/${x}/${y}/0/0_0.png`)
        : 'no satellite frames',
    });
  } catch (err) {
    res.status(502).json({ error: 'diag failed', detail: String(err) });
  }
});

// RainViewer's frame manifest. Tile images are fetched directly by the client
// from RainViewer's CDN (host comes back in this payload) to avoid proxying
// large amounts of image traffic through our single dyno.
router.get('/', async (_req, res) => {
  try {
    const data = await cache.getOrFetch('radar:manifest', 2 * 60_000, async () => {
      const upstream = await fetch('https://api.rainviewer.com/public/weather-maps.json', {
        signal: AbortSignal.timeout(10_000),
      });
      if (!upstream.ok) throw new Error(`RainViewer error: ${upstream.status}`);
      return upstream.json();
    }, { staleOnError: true });
    res.set('Cache-Control', 'public, max-age=60');
    res.json(data);
  } catch (err) {
    res.status(502).json({ error: 'Failed to fetch radar manifest', detail: String(err) });
  }
});

export default router;
