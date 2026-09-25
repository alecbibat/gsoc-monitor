import { UB_MIN_DBZ, UB_RAIN_RGBA, UB_SNOW_RGBA } from './rainviewerTable';

// Decodes a RainViewer tile (RGBA painted in the Universal Blue table) back to
// reflectivity, so the layer can smooth the data and paint it in its own
// palette. Opaque pixels map by exact colour — the rain and snow ramps share
// no opaque colour. Translucent pixels (the sub-15 dBZ rain band and the
// faintest snow) are identified by alpha, which is unique per dBZ within each
// ramp and survives any RGB rounding; hue tells the ramps apart (rain is tan,
// R > B; snow is icy, B > R).

export const NO_ECHO = -128;

export interface RadarGrid {
  width: number;
  height: number;
  dbz: Int8Array; // NO_ECHO where there is no echo
  snow: Uint8Array; // 1 where the pixel came from the snow ramp
}

export interface DecodeResult extends RadarGrid {
  unknown: number; // opaque pixels matching no table colour
  echo: number; // pixels with echo
  placeholder: boolean; // mostly off-table colours: not a radar tile
}

interface Tables {
  opaque: Map<number, number>; // rgb24 → dBZ, snow encoded as dBZ + 1000
  rainAlpha: Int16Array; // alpha → dBZ, or NO_ECHO
  snowAlpha: Int16Array;
  opaqueList: Array<[number, number, number, number]>; // r, g, b, coded dBZ
}

let tables: Tables | null = null;

function buildTables(): Tables {
  const opaque = new Map<number, number>();
  const rainAlpha = new Int16Array(256).fill(NO_ECHO);
  const snowAlpha = new Int16Array(256).fill(NO_ECHO);
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
      } else if (alphaMap[a] === NO_ECHO) {
        alphaMap[a] = dbz;
      }
    }
  };
  add(UB_RAIN_RGBA, false);
  add(UB_SNOW_RGBA, true);
  // Fill alpha gaps with the nearest defined alpha so a rounded or slightly
  // re-encoded tile still decodes to the neighbouring step.
  for (const map of [rainAlpha, snowAlpha]) {
    const known: number[] = [];
    for (let a = 1; a < 255; a++) if (map[a] !== NO_ECHO) known.push(a);
    for (let a = 1; a < 255; a++) {
      if (map[a] !== NO_ECHO || known.length === 0) continue;
      let best = known[0];
      for (const k of known) if (Math.abs(k - a) < Math.abs(best - a)) best = k;
      map[a] = map[best];
    }
  }
  return { opaque, rainAlpha, snowAlpha, opaqueList };
}

function getTables(): Tables {
  if (!tables) tables = buildTables();
  return tables;
}

// Nearest table colour for an off-table opaque pixel, within a tolerance —
// absorbs small encoder drift without inventing echo from foreign imagery.
const NEAR_TOLERANCE_SQ = 24 * 24 * 3;
const nearCache = new Map<number, number | null>();
function nearestOpaque(t: Tables, r: number, g: number, b: number): number | null {
  const key = (r << 16) | (g << 8) | b;
  const hit = nearCache.get(key);
  if (hit !== undefined) return hit;
  let best: number | null = null;
  let bestD = NEAR_TOLERANCE_SQ;
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

// Echo stronger than this is either a sentinel or clutter; clamp so the
// palette's top end still applies.
const MAX_DBZ = 75;

export function decodeRadarRgba(rgba: Uint8Array, width: number, height: number): DecodeResult {
  const t = getTables();
  const n = width * height;
  const dbz = new Int8Array(n).fill(NO_ECHO);
  const snow = new Uint8Array(n);
  let unknown = 0;
  let opaqueCount = 0;
  let echo = 0;
  // Tiles repeat a few dozen colours; memoise the last lookup per run.
  let lastKey = -1;
  let lastCoded: number | null = null;
  for (let i = 0; i < n; i++) {
    const o = i * 4;
    const a = rgba[o + 3];
    if (a === 0) continue;
    const r = rgba[o];
    const g = rgba[o + 1];
    const b = rgba[o + 2];
    let coded: number | null;
    if (a === 255) {
      opaqueCount++;
      const key = (r << 16) | (g << 8) | b;
      if (key === lastKey) {
        coded = lastCoded;
      } else {
        const exact = t.opaque.get(key);
        coded = exact !== undefined ? exact : nearestOpaque(t, r, g, b);
        lastKey = key;
        lastCoded = coded;
      }
      if (coded === null) {
        unknown++;
        continue;
      }
    } else {
      const isSnow = b > r;
      const v = (isSnow ? t.snowAlpha : t.rainAlpha)[a];
      if (v === NO_ECHO) continue;
      coded = isSnow ? v + 1000 : v;
    }
    const isSnow = coded >= 500;
    const value = isSnow ? coded - 1000 : coded;
    dbz[i] = Math.min(MAX_DBZ, value);
    if (isSnow) snow[i] = 1;
    echo++;
  }
  // RainViewer answers unsupported zoom levels with a grey "not supported"
  // image (HTTP 200): nearly all opaque and nothing like the table.
  const placeholder = opaqueCount > n * 0.05 && unknown > opaqueCount * 0.2;
  if (placeholder) {
    dbz.fill(NO_ECHO);
    snow.fill(0);
    echo = 0;
  }
  return { width, height, dbz, snow, unknown, echo, placeholder };
}
