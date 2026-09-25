import { UB_MIN_DBZ, UB_RAIN_RGBA, UB_SNOW_RGBA } from './rainviewerTable';

// Decodes a RainViewer tile (RGBA painted in the Universal Blue table) back to
// reflectivity, so the layer can smooth the data and paint it in its own
// palette. Opaque pixels map by exact colour — the rain and snow ramps share
// no opaque colour. Translucent pixels (the sub-15 dBZ rain band and the
// faintest snow) are identified by alpha, which is unique per dBZ within each
// ramp and survives any RGB rounding; their colour picks the ramp (tan rain
// or icy snow). Anything else counts as unknown, and a tile that is mostly
// unknown is not a radar tile at all.

export const NO_ECHO = -128;

export interface RadarGrid {
  width: number;
  height: number;
  dbz: Int8Array; // NO_ECHO where there is no echo
  snow: Uint8Array; // 1 where the pixel came from the snow ramp
}

interface DecodeResult extends RadarGrid {
  unknown: number; // visible pixels matching no table entry
  echo: number; // pixels with echo
  placeholder: boolean; // mostly off-table colours: not a radar tile
}

interface Translucent {
  dbz: number;
  r: number;
  g: number;
  b: number;
}

interface Tables {
  opaque: Map<number, number>; // rgb24 → dBZ, snow encoded as dBZ + 1000
  rainAlpha: Array<Translucent | null>; // alpha → table entry
  snowAlpha: Array<Translucent | null>;
  opaqueList: Array<[number, number, number, number]>; // r, g, b, coded dBZ
}

let tables: Tables | null = null;

function buildTables(): Tables {
  const opaque = new Map<number, number>();
  const rainAlpha: Array<Translucent | null> = new Array(256).fill(null);
  const snowAlpha: Array<Translucent | null> = new Array(256).fill(null);
  const opaqueList: Tables['opaqueList'] = [];
  const add = (rgba: Uint8Array, snow: boolean) => {
    const alphaMap = snow ? snowAlpha : rainAlpha;
    for (let i = 0; i < rgba.length / 4; i++) {
      const dbz = UB_MIN_DBZ + i;
      const r = rgba[i * 4];
      const g = rgba[i * 4 + 1];
      const b = rgba[i * 4 + 2];
      const a = rgba[i * 4 + 3];
      if (a === 0) continue;
      if (a === 255) {
        const key = (r << 16) | (g << 8) | b;
        // Several dBZ share the top colours (white 65-74, sentinel green 75+):
        // keep the lowest, the strength the colour first stands for.
        if (!opaque.has(key)) {
          const coded = snow ? dbz + 1000 : dbz;
          opaque.set(key, coded);
          opaqueList.push([r, g, b, coded]);
        }
      } else if (!alphaMap[a]) {
        alphaMap[a] = { dbz, r, g, b };
      }
    }
  };
  add(UB_RAIN_RGBA, false);
  add(UB_SNOW_RGBA, true);
  return { opaque, rainAlpha, snowAlpha, opaqueList };
}

function getTables(): Tables {
  if (!tables) tables = buildTables();
  return tables;
}

// Nearest table colour for an off-table opaque pixel, within a tight
// tolerance — absorbs small encoder drift without reading foreign imagery
// (a grey placeholder, a white error page) as echo.
const NEAR_TOLERANCE_SQ = 10 * 10 * 3;
const nearCache = new Map<number, number | null>();
function nearestOpaque(t: Tables, r: number, g: number, b: number): number | null {
  const key = (r << 16) | (g << 8) | b;
  const hit = nearCache.get(key);
  if (hit !== undefined) return hit;
  let best: number | null = null;
  let bestD = NEAR_TOLERANCE_SQ + 1;
  for (const [tr, tg, tb, coded] of t.opaqueList) {
    const d = (r - tr) ** 2 + (g - tg) ** 2 + (b - tb) ** 2;
    if (d < bestD) {
      bestD = d;
      best = coded;
    }
  }
  if (nearCache.size > 4096) nearCache.clear();
  nearCache.set(key, best);
  return best;
}

// Translucent RGB can drift a lot through premultiplied storage at low alpha
// (the browser-decoder fallback), so only reject colours far from both ramps.
const TRANSLUCENT_TOLERANCE_SQ = 48 * 48 * 3;

function matchTranslucent(t: Tables, r: number, g: number, b: number, a: number): number | null {
  const rain = t.rainAlpha[a];
  const snow = t.snowAlpha[a];
  const dist = (e: Translucent | null) => (e ? (r - e.r) ** 2 + (g - e.g) ** 2 + (b - e.b) ** 2 : Infinity);
  const dr = dist(rain);
  const ds = dist(snow);
  if (Math.min(dr, ds) > TRANSLUCENT_TOLERANCE_SQ) return null;
  return dr <= ds ? rain!.dbz : snow!.dbz + 1000;
}

// Echo stronger than this is either a sentinel or clutter; clamp so the
// palette's top end still applies.
const MAX_DBZ = 75;

export function decodeRadarRgba(rgba: Uint8Array, width: number, height: number): DecodeResult {
  const t = getTables();
  const n = width * height;
  const dbz = new Int8Array(n).fill(NO_ECHO);
  const snow = new Uint8Array(n);
  let unknown = 0;
  let visible = 0;
  let echo = 0;
  // Tiles repeat a few dozen colours; memoise the last lookup.
  let lastKey = -1;
  let lastCoded: number | null = null;
  for (let i = 0; i < n; i++) {
    const o = i * 4;
    const a = rgba[o + 3];
    if (a === 0) continue;
    visible++;
    const r = rgba[o];
    const g = rgba[o + 1];
    const b = rgba[o + 2];
    let coded: number | null;
    if (a === 255) {
      const key = (r << 16) | (g << 8) | b;
      if (key === lastKey) {
        coded = lastCoded;
      } else {
        const exact = t.opaque.get(key);
        coded = exact !== undefined ? exact : nearestOpaque(t, r, g, b);
        lastKey = key;
        lastCoded = coded;
      }
    } else {
      coded = matchTranslucent(t, r, g, b, a);
    }
    if (coded === null) {
      unknown++;
      continue;
    }
    const isSnow = coded >= 500;
    dbz[i] = Math.min(MAX_DBZ, isSnow ? coded - 1000 : coded);
    if (isSnow) snow[i] = 1;
    echo++;
  }
  // RainViewer answers unsupported zoom levels with a grey "not supported"
  // image (HTTP 200): nearly all opaque and nothing like the table.
  const placeholder = visible > n * 0.05 && unknown > visible * 0.2;
  if (placeholder) {
    dbz.fill(NO_ECHO);
    snow.fill(0);
    echo = 0;
  }
  return { width, height, dbz, snow, unknown, echo, placeholder };
}
