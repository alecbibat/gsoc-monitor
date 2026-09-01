// The two tile sources behind the rebuilt radar layer, and everything known
// about them that the renderer must respect. Ground truth researched Sep 2026:
//
// US HD — NEXRAD N0Q composite via the Iowa Environmental Mesonet tile cache.
//   · CONUS + Alaska + Hawaii + Puerto Rico + Guam in ONE layer group.
//   · New composite every 5 minutes (valid times at minute % 5), ~1 km data.
//   · Immutable timestamped frames on the /c/ endpoint (14-day cache):
//     /c/tile.py/1.0.0/ridge::USCOMP-N0Q-YYYYMMDDHHMI/{z}/{x}/{y}.png
//     Despite the TMS-looking "1.0.0" path the {y} is standard XYZ (the
//     server is configured tms_type=google and flips internally) — do NOT
//     reverse y.
//   · 256 px tiles, CORS `*`. Colors follow pyIEM's composite_n0q ramp:
//     color index i ⇒ dBZ = (i − 65) / 2, so index = magnitude byte + 1 on
//     this pipeline's 2·(dBZ+32) scale — a lossless, documented mapping.
//
// Global — RainViewer's free composite. Since 2026-01-01 the free tier is:
//   max zoom 7 (512 px tiles), Universal Blue palette only, PAST radar only
//   (nowcast + IR satellite discontinued), hash-based frame paths that must
//   be re-read from the manifest every cycle. Above zoom 7 the CDN serves
//   tiles with "Zoom level is not supported" burned into the image — the bug
//   the old implementation shipped by requesting up to level 9. Cap hard at 7
//   and let Cesium magnify bilinearly beyond (their own example does the
//   same via Leaflet maxNativeZoom).

import type { RadarFrame } from '../../types';

export type RadarCoverage = 'auto' | 'us' | 'global';

// Dev/test harness: `?radarsim=1` swaps both sources (and the manifest) for
// the local synthetic-tile server so the full pipeline can run — and be
// screenshotted — in sandboxes with no egress to the real weather hosts.
export const SIM =
  typeof location !== 'undefined' && new URLSearchParams(location.search).has('radarsim');

// ---------------------------------------------------------------------------
// US HD (IEM NEXRAD N0Q)

export const US_TILE_SIZE = 256;
// Native data is ~1 km ≈ z12; beyond that the cache just upscales, so stop
// requesting and let the GPU magnify our smoothed tiles instead.
export const US_MAX_LEVEL = 12;
export const US_INTERVAL_SEC = 300;
export const US_CREDIT = 'NEXRAD · Iowa Environmental Mesonet';

// UTC YYYYMMDDHHMI for a frame epoch (already snapped to minute % 5).
export function usFrameStamp(timeSec: number): string {
  const d = new Date(timeSec * 1000);
  const p = (n: number, w = 2) => String(n).padStart(w, '0');
  return (
    `${d.getUTCFullYear()}${p(d.getUTCMonth() + 1)}${p(d.getUTCDate())}` +
    `${p(d.getUTCHours())}${p(d.getUTCMinutes())}`
  );
}

export function usTileTemplate(timeSec: number): string {
  const stamp = usFrameStamp(timeSec);
  return SIM
    ? `/api/radar-sim/iem/${stamp}/{z}/{x}/{y}.png`
    : `https://mesonet.agron.iastate.edu/c/tile.py/1.0.0/ridge::USCOMP-N0Q-${stamp}/{z}/{x}/{y}.png`;
}

// Where the HD product actually has radar coverage, as lon/lat boxes. In
// `auto` mode the global source is masked out inside these so the two
// products never double-paint the same storm (they are different composites
// on different clocks — overlaying both reads as ghosting).
export const US_COVERAGE_BOXES: Array<[west: number, south: number, east: number, north: number]> = [
  [-127.5, 21.5, -66.0, 50.5], // CONUS
  [-170.0, 52.0, -129.5, 71.5], // Alaska
  [-160.8, 18.4, -154.5, 22.6], // Hawaii
  [-67.5, 17.5, -64.2, 18.9], // Puerto Rico / USVI
];

// ---------------------------------------------------------------------------
// Global (RainViewer)

export const GLOBAL_TILE_SIZE = 512;
// The free tier's hard ceiling — above this the CDN serves error-text tiles.
export const GLOBAL_MAX_LEVEL = 7;
export const GLOBAL_INTERVAL_SEC = 600;
export const GLOBAL_CREDIT = 'RainViewer.com';

// {host}{path}/{size}/{z}/{x}/{y}/{color}/{options}.png — color 2 (Universal
// Blue, the only one still served) with smoothing+snow options 1_1, exactly
// as RainViewer's current reference client requests it.
export function globalTileTemplate(host: string, frame: RadarFrame): string {
  return `${host}${frame.path}/${GLOBAL_TILE_SIZE}/{z}/{x}/{y}/2/1_1.png`;
}

// ---------------------------------------------------------------------------
// Palette inversion anchors (served color → dBZ)

// IEM's composite_n0q ramp, verbatim from pyIEM (src/pyiem/data/ramps/
// composite_n0q.txt): 255 RGB triples for color indices 1..255, base64 of
// [r,g,b]×255. dBZ = (index − 65)/2; on the magnitude scale m = 2·(dBZ+32)
// that is simply m = index − 1.
const N0Q_RAMP_B64 =
  'hXGPhXKPhnONh3WLh3aLiHeJiXmHiXqHinuFi32Ei36EjH+CjYGAjYKAjoN+j4R8j4V8kId7kYh5kYl5kot3k411lpFTmJRXm5dbnZpgoJ1ko6BopaNtqKZxqql2rax6sK9+srKDt7iMuruQvb6Uv8GZwsSdxMeix8qmys2qzNCv0tS0z9K0ycy0xsm0w8e0wMS0vcG0ub60tru0s7m0sLa0rbO0qrC0pKu0oKi0naW0mqK0l6C0lJ20kZq0lJu1kJi0jJWziJKygIywfImveIaudIOscICrbH2qZ3mpY3aoX3OnW3CmV22kT2eiS2ShR2GgQ16fQVueQ2GiRWimSG+qSnauTX2yT4S2UYu7VpnDWZ/HW6bLXq3PYLTUYrvYZcLcZ8ngatDkb9boaNbXWdazUtaiS9aQQ9Z+PNZtNdZbEdUYEdEXEM0XEMgWEMQWD7wVD7cUDrMUDq8TDqsTDaYSDaISDZ4RDJkRDJUQDJEQC4gPC4QOCoAOCnwNCncNCXMMCW8MCWsLCGYLCGIKCV4JMnMIRn0IW4gHb5IHhJ0GmKgGrbIFwb0F1scE6tIE/+IA/9gA/9MA/84A/8kA/8QA/8AA/7sA/7YA/7EA/6wA/6cA/6IA/5kA/5QA/48A/4oA/4UA/4AA/wAA+AAA8QAA6gAA4wAA1QAAzQAAxgAAvwAAuAAAsQAAqgAAowAAmwAAlAAAjQAAfwAAeAAAcQAA//////X//+r//9///9T//8n//77//7P//53//5L//3X//Gv9+WD69lb380v08EDx7Tbv6ivs5yDp4QvjsgD/rAD8pAD3mwD0kwDviADqgwDoeQDicgDdaQDbBezwBevwBerwBd3gBdzgBdvgBc3QBczQBL3ABLzABLvABK6wBK2wBJ6gBJ2gBJygA46QA42QA4yQA36AA32AA29wA25wA21wAl9gAl5gAk9QAk5QAk1QAj9AAj5AAj1AATAwAS8wASAgAR8gAR4gOme1Oma1OmW1OmS1OmO1OmK1';

export interface InversionAnchor {
  r: number;
  g: number;
  b: number;
  magnitude: number; // 2·(dBZ + 32), clamped 0..255
}

let n0qAnchors: InversionAnchor[] | null = null;
export function getUsAnchors(): InversionAnchor[] {
  if (n0qAnchors) return n0qAnchors;
  const bin = atob(N0Q_RAMP_B64);
  const anchors: InversionAnchor[] = [];
  for (let i = 0; i < 255; i++) {
    anchors.push({
      r: bin.charCodeAt(i * 3),
      g: bin.charCodeAt(i * 3 + 1),
      b: bin.charCodeAt(i * 3 + 2),
      magnitude: i, // index (i+1) − 1
    });
  }
  n0qAnchors = anchors;
  return anchors;
}

// RainViewer's served Universal Blue ramp, calibrated against real tiles via
// the old /api/radar/diag probe (Aug 2026): a blue ramp for light→moderate
// rain stepping to yellow/orange/red for heavy. Anchors beyond the observed
// colors extend the ramp so extreme cores keep grading; colors that drift off
// the ramp (if RainViewer repaints) degrade to the nearest anchor — never to
// noise.
const RV_ANCHOR_TABLE: Array<[number, number, number, number]> = [
  // [r, g, b, dBZ]
  [0, 60, 92, 3],
  [0, 71, 104, 6],
  [0, 78, 120, 10],
  [0, 85, 136, 14],
  [0, 98, 149, 19],
  [0, 112, 163, 24],
  [0, 127, 180, 29],
  [255, 238, 0, 33],
  [255, 210, 0, 38],
  [255, 180, 0, 43],
  [255, 150, 0, 47],
  [255, 110, 0, 51],
  [255, 60, 0, 55],
  [230, 0, 0, 60],
  [180, 0, 40, 64],
  [255, 0, 255, 68],
  [255, 255, 255, 70],
];

let rvAnchors: InversionAnchor[] | null = null;
export function getGlobalAnchors(): InversionAnchor[] {
  if (rvAnchors) return rvAnchors;
  rvAnchors = RV_ANCHOR_TABLE.map(([r, g, b, dbz]) => ({
    r,
    g,
    b,
    magnitude: Math.max(0, Math.min(255, Math.round(2 * (dbz + 32)))),
  }));
  return rvAnchors;
}
