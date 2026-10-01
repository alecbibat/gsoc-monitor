// Pure parsing and aggregation for NGFS (NOAA/CIMSS Next Generation Fire
// System) detections. No I/O here, so it is unit-testable; realearth.ts does
// the fetching and service.ts the caching.

export type NgfsSlot = 'east' | 'west';

/** One hot ABI pixel in one scan frame, as parsed from the upstream GeoJSON. */
export interface NgfsObservation {
  lat: number;
  lon: number;
  t: number; // acquisition time, epoch ms
  frp: number | null; // this pixel's fire radiative power, MW
  featureFrp: number | null; // the whole tracked fire object's FRP, MW
  trackId: string | null; // NGFS fire-object id, stable across frames
  type: string; // NGFS classification, e.g. "Possible Wildland Fire"
  confidence: string | null;
  state: string | null;
  county: string | null;
  incident: string | null; // IRWIN incident NGFS matched the object to
  incidentType: string | null; // IRWIN type: WF (wildfire), RX (prescribed)…
  fuel: string | null; // LANDFIRE fuel-model mix, "FBFM8:49,FBFM5:30,…"
  landCover: string | null; // "Trees:76,Shrubs:21,…"
}

/**
 * One pixel as served to the client: the latest observation of that pixel in
 * the requested window, plus how persistently it has been hot.
 */
export interface NgfsPixel extends Omit<NgfsObservation, 't'> {
  slot: NgfsSlot;
  sat: string; // e.g. "GOES-19"
  first: number; // first detection in the window, epoch ms
  last: number; // latest detection, epoch ms
  frames: number; // scan frames in the window that had this pixel hot
  maxFrp: number | null; // peak pixel FRP in the window
  wildland: boolean; // false for NGFS's industrial / gas flare / urban / volcano classes
}

// Upstream uses the literal string "NULL" (and sometimes "Unknown") for an
// absent attribute.
function str(v: unknown): string | null {
  if (v == null) return null;
  const s = String(v).trim();
  if (s === '' || s.toUpperCase() === 'NULL' || s.toLowerCase() === 'unknown') return null;
  return s;
}

function num(v: unknown): number | null {
  if (v == null || v === '' || v === 'NULL') return null;
  const n = typeof v === 'number' ? v : Number(v);
  return Number.isFinite(n) ? n : null;
}

/**
 * True for NGFS's wildland-fire classes ("Possible Wildland Fire", "Known
 * Wildland Fire Incident" and the "… Near a Solar Farm / Persistent Emitter"
 * variants). The rest (Industrial, Oil/Gas, Likely an Urban Source, Volcano)
 * are real heat but not vegetation fire.
 */
export function isWildlandType(type: string): boolean {
  return /wildland\s+fire/i.test(type);
}

/** RealEarth frame stamp "20261001.200117" → epoch ms (UTC), or null. */
export function frameTimeMs(stamp: string): number | null {
  const m = /^(\d{4})(\d{2})(\d{2})\.(\d{2})(\d{2})(\d{2})$/.exec(stamp);
  if (!m) return null;
  const t = Date.UTC(+m[1], +m[2] - 1, +m[3], +m[4], +m[5], +m[6]);
  return Number.isFinite(t) ? t : null;
}

/**
 * Parse one RealEarth `/api/shapes` FeatureCollection. Features that aren't a
 * finite point are dropped; a missing or unparseable ACQ_DATE_TIME falls back
 * to the frame's own time.
 */
export function parseFrame(body: unknown, frameT: number): NgfsObservation[] {
  const features = (body as { features?: unknown } | null)?.features;
  if (!Array.isArray(features)) throw new Error('NGFS frame is not a FeatureCollection');
  const out: NgfsObservation[] = [];
  for (const f of features as Array<{ geometry?: unknown; properties?: unknown }>) {
    const g = f?.geometry as { type?: string; coordinates?: unknown } | undefined;
    if (g?.type !== 'Point' || !Array.isArray(g.coordinates)) continue;
    const lon = Number(g.coordinates[0]);
    const lat = Number(g.coordinates[1]);
    if (!Number.isFinite(lat) || !Number.isFinite(lon) || Math.abs(lat) > 90 || Math.abs(lon) > 180) continue;
    const p = (f.properties ?? {}) as Record<string, unknown>;
    const acq = Date.parse(String(p.ACQ_DATE_TIME ?? ''));
    out.push({
      lat,
      lon,
      t: Number.isFinite(acq) ? acq : frameT,
      frp: num(p.FRP),
      featureFrp: num(p.FEATURE_FRP),
      trackId: str(p.FEATURE_TRACKING_ID),
      type: str(p.TYPE_DESCRIPTION) ?? 'Unclassified',
      confidence: str(p.CONFIDENCE),
      state: str(p.STATE),
      county: str(p.COUNTY),
      incident: str(p.KNOWN_INCIDENT_NAME),
      incidentType: str(p.KNOWN_INCIDENT_TYPE),
      fuel: str(p.FUEL),
      landCover: str(p.LAND_COVER),
    });
  }
  return out;
}

export interface NgfsFrame {
  slot: NgfsSlot;
  sat: string;
  t: number; // frame time, epoch ms
  observations: NgfsObservation[];
}

// A pixel is detected at the same navigated position in every frame (the ABI
// fixed grid plus a static terrain correction), so ~10 m rounding identifies
// it across frames without merging neighbours 2 km apart.
function pixelKey(slot: NgfsSlot, lat: number, lon: number): string {
  return `${slot}:${lat.toFixed(4)},${lon.toFixed(4)}`;
}

/**
 * Fold every frame at or after `sinceT` into one record per hot pixel per
 * satellite: the latest observation's attributes, the first/last time it was
 * hot, how many frames it was hot in, and its peak FRP. The two satellites see
 * the central US with different pixel footprints, so their detections are
 * kept apart rather than merged. Sorted newest first.
 */
export function aggregatePixels(frames: Iterable<NgfsFrame>, sinceT: number): NgfsPixel[] {
  const byKey = new Map<string, NgfsPixel>();
  for (const frame of frames) {
    if (frame.t < sinceT) continue;
    for (const o of frame.observations) {
      const key = pixelKey(frame.slot, o.lat, o.lon);
      const prev = byKey.get(key);
      const maxFrp =
        prev == null ? o.frp : o.frp == null ? prev.maxFrp : Math.max(o.frp, prev.maxFrp ?? -Infinity);
      if (prev == null) {
        const { t, ...attrs } = o;
        byKey.set(key, {
          ...attrs,
          slot: frame.slot,
          sat: frame.sat,
          first: t,
          last: t,
          frames: 1,
          maxFrp,
          wildland: isWildlandType(o.type),
        });
        continue;
      }
      prev.frames += 1;
      prev.maxFrp = maxFrp;
      prev.first = Math.min(prev.first, o.t);
      if (o.t >= prev.last) {
        const { t, ...attrs } = o;
        Object.assign(prev, attrs, { last: t, sat: frame.sat, wildland: isWildlandType(o.type) });
      }
    }
  }
  return [...byKey.values()].sort((a, b) => b.last - a.last || (b.frp ?? -1) - (a.frp ?? -1));
}
