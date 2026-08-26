import type { FlightTrackPoint } from '../../types';

/**
 * The aircraft map marker and trail palette.
 *
 * The marker is the ship layer's "sonar contact" treatment applied to planes:
 * the same reticle, the same three expanding ping rings on the same shared
 * clock (shipMarkers/shipPing are reused directly, so ships and planes pulse
 * in step), and the same nametag — with a plane silhouette turning inside the
 * reticle instead of a hull.
 *
 * Colour works like ADS-B trackers rather than like AIS ship types: everything
 * — silhouette, reticle, rings and the breadcrumb trail — is tinted by the
 * aircraft's altitude on tar1090's rainbow scale, so a climbing jet walks the
 * spectrum and its trail records the whole climb. Grounded/parked aircraft go
 * slate grey.
 */

/** tar1090's default altitude→hue stops: orange low, green mid, magenta high. */
const HUE_STOPS: ReadonlyArray<readonly [number, number]> = [
  [2_000, 20],
  [10_000, 140],
  [40_000, 300],
];
/** Saturation/lightness the whole rainbow renders at (fractions of 1). */
export const TRAIL_SAT = 0.85;
export const TRAIL_LIGHT = 0.55;

/** Grounded/parked aircraft — same slate the old flight layer used. */
export const FLIGHT_GROUND_COLOR = '#9fb4c4';

/** Hue (degrees) for an altitude, clamped to the scale's ends. */
export function altitudeHue(altFt: number): number {
  if (altFt <= HUE_STOPS[0][0]) return HUE_STOPS[0][1];
  for (let i = 1; i < HUE_STOPS.length; i++) {
    const [alt, hue] = HUE_STOPS[i];
    if (altFt <= alt) {
      const [prevAlt, prevHue] = HUE_STOPS[i - 1];
      return prevHue + ((altFt - prevAlt) / (alt - prevAlt)) * (hue - prevHue);
    }
  }
  return HUE_STOPS[HUE_STOPS.length - 1][1];
}

/** CSS colour for an altitude (SVG artwork, nametags). */
export function altitudeCssColor(altFt: number | null, ground: boolean): string {
  if (ground || altFt == null) return FLIGHT_GROUND_COLOR;
  return `hsl(${Math.round(altitudeHue(altFt))}, ${TRAIL_SAT * 100}%, ${TRAIL_LIGHT * 100}%)`;
}

/**
 * Marker tint for an aircraft. Quantised to 1,000 ft so the (colour, favourite)
 * SVG texture cache stays a few dozen entries instead of minting a new data
 * URI every time the altitude ticks.
 */
export function flightMarkerColor(altFt: number | null, ground: boolean): string {
  return altitudeCssColor(altFt == null ? null : Math.round(altFt / 1_000) * 1_000, ground);
}

// Beyond this many seconds since the last ADS-B report the aircraft is treated
// as parked/offline: drawn on the ground, dimmed, with a "last seen" note.
export const LIVE_WINDOW_SEC = 180;

export function lastSeenText(sec: number): string {
  if (sec < LIVE_WINDOW_SEC) return 'live';
  const m = Math.round(sec / 60);
  if (m < 60) return `last seen ${m}m ago`;
  const h = Math.round(m / 60);
  if (h < 48) return `last seen ${h}h ago`;
  return `last seen ${Math.round(h / 24)}d ago`;
}

/**
 * Staleness fade for the whole marker — rings, reticle, silhouette, nametag
 * and trail — mirroring shipAlpha's tiers but on ADS-B timescales.
 */
export function flightAlpha(lastSeenSec: number, onGround: boolean): number {
  if (lastSeenSec >= LIVE_WINDOW_SEC) return lastSeenSec >= 24 * 3600 ? 0.4 : 0.55;
  return onGround ? 0.85 : 1;
}

/** Billboard sizes in screen px; ring/reticle geometry comes from SHIP_MARKER. */
export const FLIGHT_MARKER = {
  iconPx: 30,
  favoriteIconPx: 36,
  trail: {
    widthPx: 3,
    alpha: 0.85,
    /** A reporting gap longer than this splits the trail instead of drawing a chord. */
    gapSplitMs: 15 * 60_000,
  },
} as const;

function planeImage(color: string): string {
  const svg =
    '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 64 64">' +
    '<path d="M32 2 L36 22 L58 40 L58 46 L36 38 L36 50 L46 58 L46 62 L32 58 L18 62 L18 58 L28 50 L28 38 L6 46 L6 40 L28 22 Z" ' +
    `fill="${color}" stroke="#05222b" stroke-width="2"/></svg>`;
  return `data:image/svg+xml,${encodeURIComponent(svg)}`;
}

const uriCache = new Map<string, string>();

export function planeIconUri(color: string): string {
  let uri = uriCache.get(color);
  if (uri === undefined) {
    uri = planeImage(color);
    uriCache.set(color, uri);
  }
  return uri;
}

/**
 * Split a trail into contiguous runs: a long reporting gap (out of receiver
 * coverage, transponder off) becomes a break instead of a misleading straight
 * chord across it. Consecutive near-identical fixes are dropped so the
 * polyline geometry never sees a zero-length segment.
 */
export function splitTrail(
  points: FlightTrackPoint[],
  gapMs: number = FLIGHT_MARKER.trail.gapSplitMs
): FlightTrackPoint[][] {
  const segments: FlightTrackPoint[][] = [];
  let current: FlightTrackPoint[] = [];
  for (const p of points) {
    const last = current[current.length - 1];
    if (last && p.t - last.t > gapMs) {
      if (current.length > 1) segments.push(current);
      current = [];
    }
    const tail = current[current.length - 1];
    if (tail && Math.abs(tail.lat - p.lat) < 1e-6 && Math.abs(tail.lon - p.lon) < 1e-6) continue;
    current.push(p);
  }
  if (current.length > 1) segments.push(current);
  return segments;
}
