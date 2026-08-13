import { createHash } from 'node:crypto';
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

// ---------------------------------------------------------------------------
// Stage 0 additions (see docs/radar-motion-engine-plan.md § Stage 0). These
// answer the questions the dev sandbox cannot: its egress proxy blocks
// rainviewer.com, so the facts the Motion Engine's pruning decisions rest on
// have to be measured from a host that can actually reach the CDN.
// ---------------------------------------------------------------------------

type Frame = { time: number; path: string };

// Status + transport metadata for one tile, with the decoded pixels kept
// separately so callers can diff them without re-fetching.
async function probeTile(url: string): Promise<{
  url: string;
  status?: number;
  bytes?: number;
  ms?: number;
  cacheControl?: string | null;
  age?: string | null;
  cfCacheStatus?: string | null;
  contentType?: string | null;
  allowOrigin?: string | null;
  error?: string;
  png?: { width: number; height: number; colorType: number; rgba: Uint8Array };
}> {
  const t0 = Date.now();
  try {
    // Origin is sent so a server that varies CORS by origin reveals that here;
    // a browser probe is still the authority (see the plan's Stage 0.2).
    const res = await fetch(url, {
      signal: AbortSignal.timeout(10_000),
      headers: { Origin: 'https://gsoc-monitor.example' },
    });
    const buf = Buffer.from(await res.arrayBuffer());
    const meta = {
      url,
      status: res.status,
      bytes: buf.length,
      ms: Date.now() - t0,
      cacheControl: res.headers.get('cache-control'),
      age: res.headers.get('age'),
      cfCacheStatus: res.headers.get('cf-cache-status') ?? res.headers.get('x-cache'),
      contentType: res.headers.get('content-type'),
      allowOrigin: res.headers.get('access-control-allow-origin'),
    };
    if (!res.ok) return meta;
    try {
      return { ...meta, png: decodePng(buf) };
    } catch (err) {
      return { ...meta, error: `decode failed: ${String(err)}` };
    }
  } catch (err) {
    return { url, ms: Date.now() - t0, error: String(err) };
  }
}

function visiblePx(png: { rgba: Uint8Array }): number {
  let n = 0;
  for (let i = 3; i < png.rgba.length; i += 4) if (png.rgba[i] !== 0) n++;
  return n;
}

// Walk down the pyramid from a starting tile, always following the child with
// the most echo, so the zoom probes land on a tile that actually has data
// (an empty tile would make every level look identical).
async function descendToEcho(host: string, frame: Frame, z0: number, x0: number, y0: number, toZ: number) {
  let x = x0;
  let y = y0;
  for (let z = z0; z < toZ; z++) {
    let best: { x: number; y: number; visible: number } | null = null;
    for (const [cx, cy] of [
      [x * 2, y * 2],
      [x * 2 + 1, y * 2],
      [x * 2, y * 2 + 1],
      [x * 2 + 1, y * 2 + 1],
    ]) {
      const p = await probeTile(`${host}${frame.path}/512/${z + 1}/${cx}/${cy}/2/1_0.png`);
      const v = p.png ? visiblePx(p.png) : -1;
      if (!best || v > best.visible) best = { x: cx, y: cy, visible: v };
    }
    if (!best || best.visible <= 0) return { z: z + 1, x: best?.x ?? x * 2, y: best?.y ?? y * 2, dead: true };
    x = best.x;
    y = best.y;
  }
  return { z: toZ, x, y, dead: false };
}

// Is a child tile genuine new detail, or just its parent's quadrant blown up?
// If the CDN synthesizes deep zooms by upscaling, the child matches a
// nearest-neighbour 2x of the parent quadrant almost exactly — which is the
// signal that requesting that level buys nothing but bandwidth.
function compareToUpscaledParent(
  child: { width: number; height: number; rgba: Uint8Array },
  parent: { width: number; height: number; rgba: Uint8Array },
  childX: number,
  childY: number
) {
  const w = child.width;
  const h = child.height;
  if (parent.width !== w || parent.height !== h) return { error: 'size mismatch' };
  // Which quadrant of the parent this child covers.
  const ox = (childX & 1) * (w / 2);
  const oy = (childY & 1) * (h / 2);
  let identical = 0;
  let sumAbs = 0;
  let compared = 0;
  let alphaDiff = 0;
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      const ci = (y * w + x) * 4;
      const pi = ((oy + (y >> 1)) * w + (ox + (x >> 1))) * 4;
      const same =
        child.rgba[ci] === parent.rgba[pi] &&
        child.rgba[ci + 1] === parent.rgba[pi + 1] &&
        child.rgba[ci + 2] === parent.rgba[pi + 2] &&
        child.rgba[ci + 3] === parent.rgba[pi + 3];
      if (same) identical++;
      if (child.rgba[ci + 3] !== parent.rgba[pi + 3]) alphaDiff++;
      if (child.rgba[ci + 3] > 0 || parent.rgba[pi + 3] > 0) {
        sumAbs +=
          Math.abs(child.rgba[ci] - parent.rgba[pi]) +
          Math.abs(child.rgba[ci + 1] - parent.rgba[pi + 1]) +
          Math.abs(child.rgba[ci + 2] - parent.rgba[pi + 2]);
        compared++;
      }
    }
  }
  const px = w * h;
  return {
    identicalFrac: +(identical / px).toFixed(4),
    alphaDiffFrac: +(alphaDiff / px).toFixed(4),
    meanAbsRgbDiff: compared ? +(sumAbs / (compared * 3)).toFixed(2) : 0,
    // The call the pruning decision actually needs.
    verdict:
      identical / px > 0.98
        ? 'UPSCALE — no real detail at this level'
        : identical / px > 0.85
          ? 'mostly upscale — marginal detail'
          : 'genuine new detail',
  };
}

// Can IEM supply HISTORY, or only "now"?
//
// This is the gate on Stage C's PR 9. IEM is only worth adding as a second
// source because it is 5-minute CONUS data against RainViewer's 10-minute
// global, and a radar timeline needs past frames — a source that can only
// answer "what is falling right now" cannot fill a scrubber.
//
// Stage 0 probed `-0`, `-m05m` and `-m50m` on one tile and got byte-identical
// payloads, which has two very different explanations that the sample could not
// separate: the time slugs do not work, or that tile was EMPTY and all three
// agreed on a picture of nothing. This settles it by hashing the payloads,
// reporting the visible-pixel count beside every hash, and doing it on a tile
// chosen because it has echo — plus the full slug ladder rather than three
// points of it, so a partial failure is visible as a partial failure.
function md5(buf: Buffer): string {
  return createHash('md5').update(buf).digest('hex').slice(0, 12);
}

const IEM_SLUGS = ['0', 'm05m', 'm10m', 'm15m', 'm20m', 'm30m', 'm45m', 'm50m'];

async function iemHistoryReport(z5x: number, z5y: number) {
  const base = 'https://mesonet.agron.iastate.edu/cache/tile.py/1.0.0';

  // Find a tile that actually contains weather. A slug ladder compared on empty
  // sky agrees perfectly and proves nothing, which is exactly the trap the
  // Stage 0 sample fell into. Scan a band of CONUS z5 tiles and take the one
  // with the most echo; fall back to the caller's tile if the whole country is
  // dry, and SAY SO in the verdict rather than reporting a false negative.
  let pick = { x: z5x, y: z5y, visible: -1 };
  const scanned: Array<{ x: number; y: number; visible: number }> = [];
  for (let x = 5; x <= 9; x++) {
    for (let y = 11; y <= 13; y++) {
      const p = await probeTile(`${base}/ridge::USCOMP-N0Q-0/5/${x}/${y}.png`);
      const v = p.png ? visiblePx(p.png) : -1;
      scanned.push({ x, y, visible: v });
      if (v > pick.visible) pick = { x, y, visible: v };
    }
  }

  const ladder: Array<Record<string, unknown>> = [];
  for (const slug of IEM_SLUGS) {
    const url = `${base}/ridge::USCOMP-N0Q-${slug}/5/${pick.x}/${pick.y}.png`;
    const t0 = Date.now();
    try {
      const res = await fetch(url, {
        signal: AbortSignal.timeout(10_000),
        headers: { Origin: 'https://gsoc-monitor.example' },
      });
      const buf = Buffer.from(await res.arrayBuffer());
      let px: number | undefined;
      try {
        px = visiblePx(decodePng(buf));
      } catch {
        px = undefined;
      }
      ladder.push({
        slug,
        status: res.status,
        bytes: buf.length,
        md5: md5(buf),
        visiblePx: px,
        ms: Date.now() - t0,
        age: res.headers.get('age'),
        lastModified: res.headers.get('last-modified'),
        cacheControl: res.headers.get('cache-control'),
      });
    } catch (err) {
      ladder.push({ slug, error: String(err), ms: Date.now() - t0 });
    }
  }

  const hashes = ladder.map((l) => l.md5).filter(Boolean) as string[];
  const distinct = new Set(hashes).size;
  const echo = pick.visible > 0;

  return {
    tile: { z: 5, ...pick },
    scanned,
    ladder,
    distinctPayloads: distinct,
    ladderLength: hashes.length,
    // The single line the Stage C decision turns on.
    verdict: !echo
      ? 'INCONCLUSIVE — no echo anywhere in the scanned CONUS band; every slug ' +
        'agrees on an empty picture, which says nothing about whether they work. ' +
        'Re-run when there is weather over the United States.'
      : distinct <= 1
        ? 'NO HISTORY — every time slug returned byte-identical bytes on a tile ' +
          'that HAS echo, so the slugs do not select past imagery. IEM can supply ' +
          '"now" only, and cannot back a timeline.'
        : distinct < hashes.length
          ? `PARTIAL — ${distinct} distinct payloads across ${hashes.length} slugs. ` +
            'Some slugs work; the timeline could only use those, at whatever ' +
            'spacing they actually provide.'
          : 'HISTORY WORKS — every slug returned distinct bytes, so IEM can back ' +
            'a 5-minute CONUS timeline.',
  };
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
      stage0: await stage0Report(manifest, frame, x, y),
    });
  } catch (err) {
    res.status(502).json({ error: 'diag failed', detail: String(err) });
  }
});

// Stage 0 of the Motion Engine plan: the five load-bearing facts about what
// RainViewer's free tier actually serves in Aug 2026. Reported under the
// existing /diag payload so one URL answers everything.
async function stage0Report(
  manifest: {
    host: string;
    version?: string;
    generated?: number;
    radar: { past: Frame[]; nowcast?: Frame[] };
    satellite?: { infrared?: Frame[] };
  },
  frame: Frame,
  z5x: number,
  z5y: number
) {
  const out: Record<string, unknown> = {};

  // --- 0.1a Manifest shape: is nowcast / IR still published? --------------
  const past = manifest.radar.past ?? [];
  const gaps: number[] = [];
  for (let i = 1; i < past.length; i++) gaps.push(Math.round((past[i].time - past[i - 1].time) / 60));
  out.manifest = {
    topLevelKeys: Object.keys(manifest),
    radarKeys: Object.keys(manifest.radar ?? {}),
    version: manifest.version,
    generated: manifest.generated,
    pastCount: past.length,
    pastCadenceMinutes: [...new Set(gaps)].sort((a, b) => a - b),
    pastHistoryMinutes: past.length > 1 ? Math.round((past[past.length - 1].time - past[0].time) / 60) : 0,
    newestFrameAgeMinutes: past.length
      ? Math.round((Date.now() / 1000 - past[past.length - 1].time) / 60)
      : null,
    nowcastPresent: Array.isArray(manifest.radar?.nowcast) && manifest.radar.nowcast.length > 0,
    nowcastCount: manifest.radar?.nowcast?.length ?? 0,
    nowcastLeadMinutes:
      manifest.radar?.nowcast?.length && past.length
        ? Math.round(
            (manifest.radar.nowcast[manifest.radar.nowcast.length - 1].time -
              past[past.length - 1].time) /
              60
          )
        : 0,
    satelliteInfraredPresent: (manifest.satellite?.infrared?.length ?? 0) > 0,
    satelliteInfraredCount: manifest.satellite?.infrared?.length ?? 0,
  };

  // --- 0.1b Max useful zoom: status per level, plus a real-detail test ----
  // Follow the echo down the pyramid so the deep-zoom tiles aren't empty.
  const deep = await descendToEcho(manifest.host, frame, 5, z5x, z5y, 9);
  out.echoDescent = deep;

  const tileUrl = (z: number, tx: number, ty: number) =>
    `${manifest.host}${frame.path}/512/${z}/${tx}/${ty}/2/1_0.png`;

  // Tile coords at any level, derived from wherever the descent stopped:
  // halve going up, take the NW child going down (the descent bails early if a
  // level serves nothing, so the deeper coords may be extrapolated).
  const at = (z: number) => {
    const d = deep.z - z;
    return d >= 0
      ? { z, x: deep.x >> d, y: deep.y >> d }
      : { z, x: deep.x << -d, y: deep.y << -d };
  };
  const levels = [6, 7, 8, 9, 10, 11].map(at);
  const probes = await Promise.all(
    levels.map(({ z, x: tx, y: ty }) => probeTile(tileUrl(z, tx, ty)))
  );
  out.zoomLevels = probes.map((p, i) => ({
    z: levels[i].z,
    x: levels[i].x,
    y: levels[i].y,
    status: p.status,
    bytes: p.bytes,
    ms: p.ms,
    visiblePx: p.png ? visiblePx(p.png) : undefined,
    error: p.error,
  }));

  // Is z8 real detail over z7, and z9 over z8? This is what sets RADAR_MAX_LEVEL.
  const byZ = new Map(levels.map((l, i) => [l.z, { level: l, probe: probes[i] }]));
  const detail: Record<string, unknown> = {};
  for (const [child, parent] of [
    [8, 7],
    [9, 8],
    [7, 6],
  ] as const) {
    const c = byZ.get(child);
    const p = byZ.get(parent);
    if (c?.probe.png && p?.probe.png) {
      detail[`z${child}_vs_z${parent}`] = compareToUpscaledParent(
        c.probe.png,
        p.probe.png,
        c.level.x,
        c.level.y
      );
    } else {
      detail[`z${child}_vs_z${parent}`] = {
        error: `missing tile (z${child}: ${c?.probe.status ?? 'n/a'}, z${parent}: ${p?.probe.status ?? 'n/a'})`,
      };
    }
  }
  out.realDetailAboveParent = detail;

  // --- 0.1c Rate limits + cache headers under a 30-tile burst -------------
  // Distinct tiles fired concurrently, the way a frame rebuild hits the CDN.
  const burstTiles: Array<[number, number]> = [];
  for (let bx = 12; bx < 22; bx++) for (let by = 22; by < 25; by++) burstTiles.push([bx, by]);
  const t0 = Date.now();
  const burst = await Promise.all(burstTiles.slice(0, 30).map(([bx, by]) => probeTile(tileUrl(6, bx, by))));
  const statusCounts: Record<string, number> = {};
  for (const b of burst) {
    const k = b.error ? `error:${b.error.slice(0, 40)}` : String(b.status);
    statusCounts[k] = (statusCounts[k] ?? 0) + 1;
  }
  const times = burst.map((b) => b.ms ?? 0).sort((a, b) => a - b);
  out.burst30 = {
    wallMs: Date.now() - t0,
    statusCounts,
    rateLimited: burst.some((b) => b.status === 429),
    medianTileMs: times[Math.floor(times.length / 2)],
    maxTileMs: times[times.length - 1],
    totalBytes: burst.reduce((n, b) => n + (b.bytes ?? 0), 0),
    sampleHeaders: burst.slice(0, 3).map((b) => ({
      url: b.url,
      status: b.status,
      cacheControl: b.cacheControl,
      age: b.age,
      cfCacheStatus: b.cfCacheStatus,
      contentType: b.contentType,
      allowOrigin: b.allowOrigin,
    })),
  };

  // --- 0.2 IEM CONUS tiles: reachable from a server, and how fast? --------
  // NB: this only proves server-side reachability. The CORS check the plan
  // needs must come from a real browser — see the browser probe in the plan.
  const iemBase = 'https://mesonet.agron.iastate.edu/cache/tile.py/1.0.0';
  const iemProbes = await Promise.all([
    probeTile(`${iemBase}/ridge::USCOMP-N0Q-0/5/${z5x}/${z5y}.png`),
    probeTile(`${iemBase}/ridge::USCOMP-N0Q-m05m/5/${z5x}/${z5y}.png`),
    probeTile(`${iemBase}/ridge::USCOMP-N0Q-m50m/5/${z5x}/${z5y}.png`),
    probeTile(`${iemBase}/q2-hsr-900913/5/${z5x}/${z5y}.png`),
  ]);
  out.iem = iemProbes.map((p) => ({
    url: p.url,
    status: p.status,
    bytes: p.bytes,
    ms: p.ms,
    visiblePx: p.png ? visiblePx(p.png) : undefined,
    cacheControl: p.cacheControl,
    allowOrigin: p.allowOrigin,
    error: p.error,
  }));

  out.iemHistory = await iemHistoryReport(z5x, z5y);

  return out;
}

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
