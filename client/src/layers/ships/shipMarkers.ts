import * as Cesium from 'cesium';

/**
 * Ship map-marker styles.
 *
 * The original marker was a 22 px hull silhouette with a dark outline. Seven of
 * those scattered across open ocean at globe zoom are easy to miss entirely, so
 * each style below rebuilds the marker out of three cooperating pieces:
 *
 *   base — a static billboard under the hull (halo plate / reticle / stem).
 *          Never rotated, so reticles and stems stay upright while the ship turns.
 *   icon — the hull silhouette, rotated to the ship's heading (as before).
 *   ping — N rings that expand and fade on a loop, anchored on the ship position.
 *
 * Three styles are drafted; SHIP_MARKER_STYLE picks the one the globe uses, and
 * `?shipMarker=halo|sonar|beacon` overrides it at runtime so the alternatives can
 * be compared on the live globe without a rebuild.
 */

export type ShipMarkerStyleName = 'halo' | 'sonar' | 'beacon';

/** The style the globe ships with. */
const DEFAULT_STYLE: ShipMarkerStyleName = 'sonar';

export interface ShipPingSpec {
  /** Ring texture, coloured to match the ship. */
  image: (color: string) => string;
  /** Ring billboard size at scale 1, in screen px. */
  sizePx: number;
  /** Rings in flight at once; each is offset by periodMs / count. */
  count: number;
  periodMs: number;
  /** Billboard scale at the start and end of a ring's life. */
  from: number;
  to: number;
  /** Ring alpha at birth; it fades to zero over the ring's life. */
  peakAlpha: number;
  /** Fade shape — higher holds the ring bright for longer before dropping off. */
  fadePower: number;
}

export interface ShipMarkerStyle {
  name: ShipMarkerStyleName;
  /** One-line description, for the layer legend and code readers. */
  blurb: string;
  /** Hull billboard, rotated to heading. */
  icon: {
    image: (color: string, favorite: boolean) => string;
    sizePx: number;
    favoriteSizePx: number;
    /** Screen-space lift above the anchor — non-zero only when a stem holds it up. */
    offsetY: number;
  };
  /** Static furniture drawn beneath the hull. */
  base?: {
    image: (color: string, favorite: boolean) => string;
    widthPx: number;
    heightPx: number;
    verticalOrigin: Cesium.VerticalOrigin;
  };
  /** Draw the ship's name beside the marker at all zooms. */
  showLabel: boolean;
  ping: ShipPingSpec;
  /** Keeps markers legible when zoomed out instead of shrinking them to specks. */
  scaleByDistance: Cesium.NearFarScalar;
}

// --- SVG building blocks -----------------------------------------------------

// The hull glyph is authored in a 64-unit box (unchanged from the original
// marker) and transplanted into each style's larger box, leaving room around it
// for that style's furniture.
const HULL_PATH = 'M32 4 L46 20 L46 58 L18 58 L18 20 Z';
const HULL_BRIDGE = '<rect x="24" y="28" width="16" height="12" fill="#04181f" fill-opacity="0.5" rx="2"/>';

/**
 * The hull glyph, scaled by `scale` and centred in a `box`-unit viewBox.
 * `strokeW` is in final box units — it's divided back out through the transform
 * so the outline reads the same weight whatever the scale.
 */
function hullGlyph(box: number, scale: number, fill: string, stroke: string, strokeW: number): string {
  const off = (box - 64 * scale) / 2;
  return (
    `<g transform="translate(${off} ${off}) scale(${scale})">` +
    `<path d="${HULL_PATH}" fill="${fill}" stroke="${stroke}" ` +
    `stroke-width="${(strokeW / scale).toFixed(2)}" stroke-linejoin="round"/>` +
    HULL_BRIDGE +
    '</g>'
  );
}

function svgUri(w: number, h: number, body: string): string {
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${w} ${h}">${body}</svg>`;
  return `data:image/svg+xml,${encodeURIComponent(svg)}`;
}

/** Amber accent that already marks a favourited ship elsewhere in the layer. */
const FAVORITE_ACCENT = '#ffb84d';
/** The dark plate colour — the globe's own deep-ocean tone, so plates read as depth. */
const PLATE = '#04181f';

// --- Style 1: Halo ----------------------------------------------------------
// A bigger hull on a dark plate, sitting in a soft radial glow, with two slow
// soft-edged rings breathing outward. Quiet and atmospheric — adds mass without
// adding hard shapes to a map that is already full of them.

const HALO_BOX = 96;

function haloIcon(color: string, favorite: boolean): string {
  const outline = favorite ? FAVORITE_ACCENT : '#ffffff';
  return svgUri(
    HALO_BOX,
    HALO_BOX,
    '<defs><radialGradient id="h">' +
      `<stop offset="0.28" stop-color="${color}" stop-opacity="0.36"/>` +
      `<stop offset="0.60" stop-color="${color}" stop-opacity="0.14"/>` +
      `<stop offset="1" stop-color="${color}" stop-opacity="0"/>` +
      '</radialGradient></defs>' +
      '<circle cx="48" cy="48" r="48" fill="url(#h)"/>' +
      `<circle cx="48" cy="48" r="29" fill="${PLATE}" fill-opacity="0.68" ` +
      `stroke="${color}" stroke-opacity="0.45" stroke-width="1.5"/>` +
      hullGlyph(HALO_BOX, 0.85, color, outline, favorite ? 3 : 2.2)
  );
}

function haloRing(color: string): string {
  return svgUri(
    128,
    128,
    '<defs><radialGradient id="r">' +
      `<stop offset="0.48" stop-color="${color}" stop-opacity="0"/>` +
      `<stop offset="0.79" stop-color="${color}" stop-opacity="0.85"/>` +
      `<stop offset="0.93" stop-color="${color}" stop-opacity="0.28"/>` +
      `<stop offset="1" stop-color="${color}" stop-opacity="0"/>` +
      '</radialGradient></defs>' +
      '<circle cx="64" cy="64" r="64" fill="url(#r)"/>'
  );
}

const HALO_STYLE: ShipMarkerStyle = {
  name: 'halo',
  blurb: 'Glowing plate under an enlarged hull, with two slow soft rings.',
  icon: { image: haloIcon, sizePx: 54, favoriteSizePx: 66, offsetY: 0 },
  showLabel: false,
  ping: {
    image: haloRing,
    sizePx: 46,
    count: 2,
    periodMs: 2_800,
    from: 0.55,
    to: 2.5,
    peakAlpha: 0.6,
    fadePower: 1.35,
  },
  scaleByDistance: new Cesium.NearFarScalar(1.5e6, 1.0, 3.0e7, 0.75),
};

// --- Style 2: Sonar ---------------------------------------------------------
// The hull sits inside a fixed reticle — corner brackets and a thin range ring —
// with three fast, hard-edged rings sweeping out of it. Reads as a tracked
// contact on an ops console, and the straight bracket edges separate cleanly
// from coastlines and weather, which are all curves.

const SONAR_BOX = 96;

function sonarReticle(color: string, favorite: boolean): string {
  const ink = favorite ? FAVORITE_ACCENT : color;
  // One L-shaped bracket per corner of the ring's bounding box.
  const bracket = (x: number, y: number, dx: number, dy: number) =>
    `<path d="M${x} ${y + dy} L${x} ${y} L${x + dx} ${y}"/>`;
  return svgUri(
    SONAR_BOX,
    SONAR_BOX,
    `<circle cx="48" cy="48" r="36" fill="${PLATE}" fill-opacity="0.34" ` +
      `stroke="${ink}" stroke-opacity="0.5" stroke-width="1.4"/>` +
      `<g fill="none" stroke="${ink}" stroke-opacity="0.95" ` +
      `stroke-width="${favorite ? 3.2 : 2.6}" stroke-linecap="square">` +
      bracket(10, 10, 11, 11) +
      bracket(86, 10, -11, 11) +
      bracket(10, 86, 11, -11) +
      bracket(86, 86, -11, -11) +
      '</g>'
  );
}

function sonarHull(color: string, favorite: boolean): string {
  return svgUri(64, 64, hullGlyph(64, 1, color, favorite ? FAVORITE_ACCENT : '#eaf7ff', favorite ? 3 : 2.2));
}

function sonarRing(color: string): string {
  return svgUri(
    128,
    128,
    `<g fill="none" stroke="${color}">` +
      '<circle cx="64" cy="64" r="56" stroke-width="12" stroke-opacity="0.16"/>' +
      '<circle cx="64" cy="64" r="56" stroke-width="3.2" stroke-opacity="0.95"/>' +
      '</g>'
  );
}

const SONAR_STYLE: ShipMarkerStyle = {
  name: 'sonar',
  blurb: 'Hull inside a fixed targeting reticle, with three fast sonar rings.',
  icon: { image: sonarHull, sizePx: 26, favoriteSizePx: 32, offsetY: 0 },
  base: {
    image: sonarReticle,
    widthPx: 60,
    heightPx: 60,
    verticalOrigin: Cesium.VerticalOrigin.CENTER,
  },
  showLabel: false,
  ping: {
    image: sonarRing,
    sizePx: 52,
    count: 3,
    periodMs: 2_000,
    from: 0.5,
    to: 2.6,
    peakAlpha: 0.9,
    fadePower: 1.7,
  },
  scaleByDistance: new Cesium.NearFarScalar(1.5e6, 1.0, 3.0e7, 0.78),
};

// --- Style 3: Beacon --------------------------------------------------------
// The hull is lifted off the water on a stem, with a ring marking the true
// position at the waterline and the ship's name always on. The tallest
// silhouette of the three and the only one you can read without hovering — at
// the cost of the most screen real estate per ship.

const BEACON_BOX = 80;
// The stem's viewBox is 64 wide x 96 tall; it draws upward from the anchor.
const BEACON_STEM_W = 26;
const BEACON_STEM_H = 39;
// Stem top sits at y=26 of 96, so the hull rides (96-26)/96 of the stem height up.
const BEACON_ICON_OFFSET = -Math.round(((96 - 26) / 96) * BEACON_STEM_H);

function beaconStem(color: string, favorite: boolean): string {
  const ink = favorite ? FAVORITE_ACCENT : color;
  return svgUri(
    64,
    96,
    // Dark under-stroke first so the stem holds up over bright coastlines.
    `<g fill="none" stroke="${PLATE}" stroke-opacity="0.75" stroke-linecap="round">` +
      '<path d="M32 88 L32 24" stroke-width="6"/>' +
      '<ellipse cx="32" cy="88" rx="11" ry="4.5" stroke-width="6"/>' +
      '</g>' +
      `<g fill="none" stroke="${ink}" stroke-linecap="round">` +
      '<path d="M32 88 L32 24" stroke-width="2.2" stroke-opacity="0.8"/>' +
      '<ellipse cx="32" cy="88" rx="11" ry="4.5" stroke-width="2.4" stroke-opacity="0.9"/>' +
      '</g>' +
      `<circle cx="32" cy="88" r="2.6" fill="${ink}"/>`
  );
}

function beaconIcon(color: string, favorite: boolean): string {
  const outline = favorite ? FAVORITE_ACCENT : '#ffffff';
  return svgUri(
    BEACON_BOX,
    BEACON_BOX,
    `<circle cx="40" cy="40" r="31" fill="${PLATE}" fill-opacity="0.8" ` +
      `stroke="${color}" stroke-width="2.4"/>` +
      hullGlyph(BEACON_BOX, 0.86, color, outline, favorite ? 2.8 : 2)
  );
}

function beaconBloom(color: string): string {
  return svgUri(
    128,
    128,
    '<defs><radialGradient id="b">' +
      `<stop offset="0" stop-color="${color}" stop-opacity="0.3"/>` +
      `<stop offset="0.72" stop-color="${color}" stop-opacity="0.1"/>` +
      `<stop offset="1" stop-color="${color}" stop-opacity="0"/>` +
      '</radialGradient></defs>' +
      '<circle cx="64" cy="64" r="60" fill="url(#b)"/>' +
      `<circle cx="64" cy="64" r="56" fill="none" stroke="${color}" ` +
      'stroke-opacity="0.9" stroke-width="4"/>'
  );
}

const BEACON_STYLE: ShipMarkerStyle = {
  name: 'beacon',
  blurb: 'Hull raised on a stem over a waterline ring, name always visible.',
  icon: { image: beaconIcon, sizePx: 46, favoriteSizePx: 56, offsetY: BEACON_ICON_OFFSET },
  base: {
    image: beaconStem,
    widthPx: BEACON_STEM_W,
    heightPx: BEACON_STEM_H,
    verticalOrigin: Cesium.VerticalOrigin.BOTTOM,
  },
  showLabel: true,
  ping: {
    image: beaconBloom,
    sizePx: 44,
    count: 1,
    periodMs: 3_000,
    from: 0.45,
    to: 2.9,
    peakAlpha: 0.85,
    fadePower: 1.2,
  },
  scaleByDistance: new Cesium.NearFarScalar(1.5e6, 1.0, 3.0e7, 0.8),
};

// --- Selection ---------------------------------------------------------------

const STYLES: Record<ShipMarkerStyleName, ShipMarkerStyle> = {
  halo: HALO_STYLE,
  sonar: SONAR_STYLE,
  beacon: BEACON_STYLE,
};

function selectedStyleName(): ShipMarkerStyleName {
  const q = new URLSearchParams(window.location.search).get('shipMarker');
  return q && q in STYLES ? (q as ShipMarkerStyleName) : DEFAULT_STYLE;
}

export const SHIP_MARKER_STYLE: ShipMarkerStyle = STYLES[selectedStyleName()];

// Textures are shared across the fleet — seven ships resolve to a handful of
// (style, colour, favourite) combinations, so build each one once.
const uriCache = new Map<string, string>();
function cached(key: string, build: () => string): string {
  let uri = uriCache.get(key);
  if (uri === undefined) {
    uri = build();
    uriCache.set(key, uri);
  }
  return uri;
}

export function shipIconUri(color: string, favorite: boolean): string {
  const s = SHIP_MARKER_STYLE;
  return cached(`${s.name}|icon|${color}|${favorite}`, () => s.icon.image(color, favorite));
}

export function shipBaseUri(color: string, favorite: boolean): string | null {
  const s = SHIP_MARKER_STYLE;
  if (!s.base) return null;
  const base = s.base;
  return cached(`${s.name}|base|${color}|${favorite}`, () => base.image(color, favorite));
}

export function shipPingUri(color: string): string {
  const s = SHIP_MARKER_STYLE;
  return cached(`${s.name}|ping|${color}`, () => s.ping.image(color));
}

// --- Ping animation ----------------------------------------------------------

/**
 * Shared epoch, so every ship in the fleet pulses in step. Independent phases
 * read as noise; a fleet-wide beat reads as the console sweeping its contacts.
 */
const PING_EPOCH = performance.now();

/** Position of ring `index` in its cycle, 0 (just born) to 1 (faded out). */
function ringPhase(spec: ShipPingSpec, index: number): number {
  const offset = (index * spec.periodMs) / spec.count;
  const elapsed = performance.now() - PING_EPOCH - offset;
  return (((elapsed % spec.periodMs) + spec.periodMs) % spec.periodMs) / spec.periodMs;
}

/**
 * Some viewers ask for less motion, and a globe of throbbing rings is exactly
 * what that setting is about. Honour it by freezing the rings mid-expansion —
 * the marker keeps its extra presence, it just stops moving.
 */
export const prefersReducedMotion = (): boolean =>
  typeof window !== 'undefined' && window.matchMedia('(prefers-reduced-motion: reduce)').matches;

const REST_PHASE = 0.45;

/** Billboard scale for ring `index` right now. Eases out, so it leaps then drifts. */
export function pingScale(index: number): number {
  const spec = SHIP_MARKER_STYLE.ping;
  const p = prefersReducedMotion() ? REST_PHASE : ringPhase(spec, index);
  const eased = 1 - (1 - p) * (1 - p);
  return spec.from + (spec.to - spec.from) * eased;
}

/** Ring alpha right now, scaled by the ship's own staleness fade. */
export function pingAlpha(index: number, shipAlpha: number): number {
  const spec = SHIP_MARKER_STYLE.ping;
  const p = prefersReducedMotion() ? REST_PHASE : ringPhase(spec, index);
  return spec.peakAlpha * Math.pow(1 - p, spec.fadePower) * shipAlpha;
}
