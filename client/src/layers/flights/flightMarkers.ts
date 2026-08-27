import type { AircraftInfo, FlightGroupId, FlightTrackPoint } from '../../types';

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
    /**
     * Comet taper: vertex alpha ramps from this fraction of the trail's base
     * alpha at the oldest fix up to the full value at the newest, so the
     * bright end is always where the aircraft is heading.
     */
    taperFrom: 0.35,
    /** Direction chevrons along the trail. */
    chevronPx: 13,
    chevronMinSpacingM: 30_000,
    chevronMaxPerTrail: 48,
  },
} as const;

/**
 * Human-readable airframe type: "Cessna Citation Excel" when the registry
 * lookup has landed, degrading to the ICAO type designator (registry's, then
 * the ADS-B feed's own `t` field), and null when nothing is known yet. Some
 * registries bake the manufacturer into the model name — don't say it twice.
 */
export function aircraftTypeText(
  info: Pick<AircraftInfo, 'manufacturer' | 'model' | 'icaoType'> | null | undefined,
  feedType: string | null
): string | null {
  const make = info?.manufacturer?.trim() ?? '';
  const model = info?.model?.trim() ?? '';
  const name =
    make && model
      ? model.toLowerCase().startsWith(make.toLowerCase())
        ? model
        : `${make} ${model}`
      : model || make;
  return name || info?.icaoType || feedType || null;
}

// One silhouette per group, all nose-up so billboard rotation works the same:
//   company           — the original swept business-jet dart.
//   hurricane-hunters — straight-wing four-engine turboprop (P-3 planform).
//   fire-tankers      — fat-fuselage wide-body with broad swept wings.
const SILHOUETTES: Record<FlightGroupId, string> = {
  company:
    '<path d="M32 2 L36 22 L58 40 L58 46 L36 38 L36 50 L46 58 L46 62 L32 58 L18 62 L18 58 L28 50 L28 38 L6 46 L6 40 L28 22 Z"/>',
  'hurricane-hunters':
    '<path d="M32 2 L35 8 L35 22 L60 24 L60 32 L35 32 L35 46 L45 50 L45 56 L34 54 L32 60 L30 54 L19 56 L19 50 L29 46 L29 32 L4 32 L4 24 L29 22 L29 8 Z"/>' +
    '<circle cx="13" cy="24" r="3"/><circle cx="22" cy="23" r="3"/>' +
    '<circle cx="42" cy="23" r="3"/><circle cx="51" cy="24" r="3"/>',
  'fire-tankers':
    '<path d="M32 2 L38 10 L38 24 L62 42 L62 49 L38 40 L38 48 L50 58 L50 63 L32 57 L14 63 L14 58 L26 48 L26 40 L2 49 L2 42 L26 24 L26 10 Z"/>',
};

function planeImage(color: string, variant: FlightGroupId): string {
  const svg =
    '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 64 64">' +
    `<g fill="${color}" stroke="#05222b" stroke-width="2">${SILHOUETTES[variant]}</g></svg>`;
  return `data:image/svg+xml,${encodeURIComponent(svg)}`;
}

// A chevron pointing up (north at rotation 0, same convention as the plane
// icon), colour over a dark underlay so it stays legible on any basemap.
function chevronImage(color: string): string {
  const svg =
    '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 64 64">' +
    '<path d="M14 44 L32 20 L50 44" stroke="#05222b" stroke-width="11" fill="none" ' +
    'stroke-linecap="round" stroke-linejoin="round"/>' +
    `<path d="M14 44 L32 20 L50 44" stroke="${color}" stroke-width="6" fill="none" ` +
    'stroke-linecap="round" stroke-linejoin="round"/></svg>';
  return `data:image/svg+xml,${encodeURIComponent(svg)}`;
}

const uriCache = new Map<string, string>();

export function planeIconUri(color: string, variant: FlightGroupId = 'company'): string {
  const key = `plane|${variant}|${color}`;
  let uri = uriCache.get(key);
  if (uri === undefined) {
    uri = planeImage(color, variant);
    uriCache.set(key, uri);
  }
  return uri;
}

export function chevronIconUri(color: string): string {
  let uri = uriCache.get(`chevron|${color}`);
  if (uri === undefined) {
    uri = chevronImage(color);
    uriCache.set(`chevron|${color}`, uri);
  }
  return uri;
}

/**
 * An airborne fix can arrive with no altitude (MLAT/TIS-B, baro dropout); a
 * vertex at the raw `altFt ?? 0` would spike the trail from cruise down to the
 * surface and back. Carry the last known altitude forward instead (a ground
 * fix resets the reference to 0), and drop airborne fixes seen before any
 * altitude reference exists.
 */
export function resolveTrailAltitudes(points: FlightTrackPoint[]): FlightTrackPoint[] {
  let lastAlt: number | null = null;
  const out: FlightTrackPoint[] = [];
  for (const p of points) {
    if (p.ground) {
      lastAlt = 0;
      out.push(p);
    } else if (p.altFt != null) {
      lastAlt = p.altFt;
      out.push(p);
    } else if (lastAlt != null) {
      out.push({ ...p, altFt: lastAlt });
    }
  }
  return out;
}

function haversineM(aLat: number, aLon: number, bLat: number, bLon: number): number {
  const R = 6_371_000;
  const dLat = ((bLat - aLat) * Math.PI) / 180;
  const dLon = ((bLon - aLon) * Math.PI) / 180;
  const s =
    Math.sin(dLat / 2) ** 2 +
    Math.cos((aLat * Math.PI) / 180) * Math.cos((bLat * Math.PI) / 180) * Math.sin(dLon / 2) ** 2;
  return 2 * R * Math.asin(Math.sqrt(s));
}

/** Initial great-circle bearing from point 1 to point 2, degrees [0, 360). */
export function trailBearing(aLat: number, aLon: number, bLat: number, bLon: number): number {
  const p1 = (aLat * Math.PI) / 180;
  const p2 = (bLat * Math.PI) / 180;
  const dLon = ((bLon - aLon) * Math.PI) / 180;
  const y = Math.sin(dLon) * Math.cos(p2);
  const x = Math.cos(p1) * Math.sin(p2) - Math.sin(p1) * Math.cos(p2) * Math.cos(dLon);
  return ((Math.atan2(y, x) * 180) / Math.PI + 360) % 360;
}

/** A direction chevron to draw on the trail: where, how high, which way. */
export interface ChevronPlacement {
  lat: number;
  lon: number;
  altFt: number | null;
  ground: boolean;
  t: number;
  bearingDeg: number;
}

/**
 * Walk one contiguous trail segment and pick the fixes to carry a direction
 * chevron: one every `minSpacingM` of travel, widened so a long trail never
 * exceeds `maxCount` chevrons. Fixes arrive every few seconds, so snapping to
 * the nearest fix (rather than interpolating between them) is invisible at any
 * real zoom. The bearing looks across the chevron's neighbours to smooth
 * fix-to-fix jitter. The segment's endpoints never get a chevron — the plane
 * icon itself marks the head.
 */
export function chevronPlacements(
  seg: FlightTrackPoint[],
  minSpacingM: number = FLIGHT_MARKER.trail.chevronMinSpacingM,
  maxCount: number = FLIGHT_MARKER.trail.chevronMaxPerTrail
): ChevronPlacement[] {
  if (seg.length < 3) return [];
  let total = 0;
  for (let i = 1; i < seg.length; i++) {
    total += haversineM(seg[i - 1].lat, seg[i - 1].lon, seg[i].lat, seg[i].lon);
  }
  const spacing = Math.max(minSpacingM, total / maxCount);
  const out: ChevronPlacement[] = [];
  let sinceLast = 0;
  for (let i = 1; i < seg.length - 1; i++) {
    sinceLast += haversineM(seg[i - 1].lat, seg[i - 1].lon, seg[i].lat, seg[i].lon);
    if (sinceLast < spacing) continue;
    sinceLast = 0;
    const p = seg[i];
    out.push({
      lat: p.lat,
      lon: p.lon,
      altFt: p.altFt,
      ground: p.ground,
      t: p.t,
      bearingDeg: trailBearing(seg[i - 1].lat, seg[i - 1].lon, seg[i + 1].lat, seg[i + 1].lon),
    });
  }
  return out;
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
