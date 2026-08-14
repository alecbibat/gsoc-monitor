import * as Cesium from 'cesium';

/**
 * The ship map marker: a "sonar contact".
 *
 * The old marker was a 22 px hull silhouette with a near-black outline — the
 * same value as the water behind it — so at globe zoom a ship read as a speck.
 * This one is built from three billboards stacked on the ship's position:
 *
 *   reticle — four corner brackets and a thin range ring. Never rotated, so it
 *             stays a stable target while the hull turns inside it. Straight
 *             lines and right angles are the one geometry a map of coastlines
 *             and storm cones doesn't produce, which is what makes it findable.
 *   hull    — the silhouette, rotated to the ship's heading (as before).
 *   ping    — three rings expanding out of the marker on a shared 2 s loop.
 *
 * Artwork is authored as inline SVG data URIs and memoised per (colour,
 * favourite), so the whole fleet shares a handful of textures.
 */

/** Amber accent that already marks a favourited ship elsewhere in the layer. */
const FAVORITE_ACCENT = '#ffb84d';
/** The globe's own deep-ocean tone, so the reticle's fill reads as depth. */
const PLATE = '#04181f';

function svgUri(box: number, body: string): string {
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${box} ${box}">${body}</svg>`;
  return `data:image/svg+xml,${encodeURIComponent(svg)}`;
}

function hullImage(color: string, favorite: boolean): string {
  return svgUri(
    64,
    '<path d="M32 4 L46 20 L46 58 L18 58 L18 20 Z" ' +
      `fill="${color}" stroke="${favorite ? FAVORITE_ACCENT : '#eaf7ff'}" ` +
      `stroke-width="${favorite ? 3 : 2.2}" stroke-linejoin="round"/>` +
      `<rect x="24" y="28" width="16" height="12" fill="${PLATE}" fill-opacity="0.5" rx="2"/>`
  );
}

function reticleImage(color: string, favorite: boolean): string {
  const ink = favorite ? FAVORITE_ACCENT : color;
  // One L-shaped bracket per corner of the range ring's bounding box.
  const bracket = (x: number, y: number, dx: number, dy: number) =>
    `<path d="M${x} ${y + dy} L${x} ${y} L${x + dx} ${y}"/>`;
  return svgUri(
    96,
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

function ringImage(color: string): string {
  return svgUri(
    128,
    `<g fill="none" stroke="${color}">` +
      '<circle cx="64" cy="64" r="56" stroke-width="12" stroke-opacity="0.16"/>' +
      '<circle cx="64" cy="64" r="56" stroke-width="3.2" stroke-opacity="0.95"/>' +
      '</g>'
  );
}

/** Billboard sizes in screen px, and how the rings travel. */
export const SHIP_MARKER = {
  hullPx: 26,
  favoriteHullPx: 32,
  reticlePx: 60,
  ping: {
    /** Ring billboard size at scale 1. */
    sizePx: 52,
    /** Rings in flight at once; each is offset by periodMs / count. */
    count: 3,
    periodMs: 2_000,
    /** Billboard scale at the start and end of a ring's life. */
    from: 0.5,
    to: 2.6,
    /** Ring alpha at birth; it fades to zero over the ring's life. */
    peakAlpha: 0.9,
    /** Fade shape — higher holds the ring bright for longer before dropping off. */
    fadePower: 1.7,
  },
  /** Keeps the marker legible when zoomed out instead of shrinking it to a speck. */
  scaleByDistance: new Cesium.NearFarScalar(1.5e6, 1.0, 3.0e7, 0.78),
} as const;

// Textures are shared across the fleet — seven ships resolve to a handful of
// (colour, favourite) combinations, so build each one once.
const uriCache = new Map<string, string>();
function cached(key: string, build: () => string): string {
  let uri = uriCache.get(key);
  if (uri === undefined) {
    uri = build();
    uriCache.set(key, uri);
  }
  return uri;
}

export const shipHullUri = (color: string, favorite: boolean): string =>
  cached(`hull|${color}|${favorite}`, () => hullImage(color, favorite));

export const shipReticleUri = (color: string, favorite: boolean): string =>
  cached(`reticle|${color}|${favorite}`, () => reticleImage(color, favorite));

export const shipPingUri = (color: string): string =>
  cached(`ping|${color}`, () => ringImage(color));

// --- Ping animation ----------------------------------------------------------

/**
 * Shared epoch, so every ship in the fleet pulses in step. Independent phases
 * read as noise; a fleet-wide beat reads as the console sweeping its contacts.
 */
const PING_EPOCH = performance.now();

/** Position of ring `index` in its cycle, 0 (just born) to 1 (faded out). */
function ringPhase(index: number): number {
  const { count, periodMs } = SHIP_MARKER.ping;
  const elapsed = performance.now() - PING_EPOCH - (index * periodMs) / count;
  return (((elapsed % periodMs) + periodMs) % periodMs) / periodMs;
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
  const { from, to } = SHIP_MARKER.ping;
  const p = prefersReducedMotion() ? REST_PHASE : ringPhase(index);
  const eased = 1 - (1 - p) * (1 - p);
  return from + (to - from) * eased;
}

/** Ring alpha right now, scaled by the ship's own staleness fade. */
export function pingAlpha(index: number, shipAlpha: number): number {
  const { peakAlpha, fadePower } = SHIP_MARKER.ping;
  const p = prefersReducedMotion() ? REST_PHASE : ringPhase(index);
  return peakAlpha * Math.pow(1 - p, fadePower) * shipAlpha;
}
