import { Router, type Request } from 'express';
import { cache } from '../cache';
import { config } from '../config';
import { climatologyWindow, resolveReturnPeriods, type ClimateWindow, type ReturnPeriods } from './glofasClimate';

export type { ReturnPeriods } from './glofasClimate';

const router = Router();

// Flood risk report inputs. Three keyless upstreams, each proxied here rather
// than called from the browser: FEMA's NFHL MapServer is slow (5–20 s is
// normal) and returns full-resolution polygons that need bounding; Open-Meteo
// is quota-bound per IP, so nearby reports must share one cached call; and the
// GloFAS return-period thresholds need 20 years of daily reanalysis (~520
// billed Open-Meteo calls), which is far too heavy to pull per page view — it
// is fitted once per model cell and persisted (./glofasClimate). Mounted
// behind requireAuth in index.ts — this is not a public proxy.

// ── Response shapes ───────────────────────────────────────────────────────────
// Mirror client/src/types/index.ts (FemaZoneResponse, FloodPrecipResponse,
// FloodDischargeResponse) exactly — the server cannot import client code, so
// keep the two in sync by hand.

export interface FemaZoneFeature {
  zone: string;
  subtype: string | null;
  sfha: boolean;
}

export interface FemaSiteZone extends FemaZoneFeature {
  bfeFt: number | null;
  depthFt: number | null;
  datum: string | null;
}

export interface FemaZonePolygon extends FemaZoneFeature {
  rings: number[][][];
}

export interface FemaZoneResponse {
  covered: boolean;
  atSite: FemaSiteZone | null;
  polygons: FemaZonePolygon[];
  nearestSfhaMi: number | null;
  /** FEMA's own record cap (exceededTransferLimit): zones, possibly the nearest SFHA, may be missing. */
  truncated: boolean;
  /** This server's vertex cap trimmed the map. The map only — distances used the full shapes. */
  mapTrimmed?: boolean;
  /** The envelope query failed but the point query answered: atSite stands, nothing else was checked. */
  envelopeUnavailable?: boolean;
  updated: number;
}

export interface FloodPrecipResponse {
  timezone: string;
  utcOffsetSeconds: number;
  daily: { time: string[]; precipIn: Array<number | null> };
  hourly: { time: string[]; precipIn: Array<number | null>; probPct: Array<number | null> };
  updated: number;
}

// ReturnPeriods ({ rp2, rp5, rp20, years, fromYear, toYear }) is declared in
// ./glofasClimate, which fits and stores it, and re-exported above.

export interface FloodDischargeResponse {
  lat: number;
  lon: number;
  time: string[];
  discharge: Array<number | null>;
  median: Array<number | null>;
  p25: Array<number | null>;
  p75: Array<number | null>;
  min: Array<number | null>;
  max: Array<number | null>;
  thresholds: ReturnPeriods | null;
  updated: number;
}

// ── Upstream plumbing ─────────────────────────────────────────────────────────

// Same identifying User-Agent as the NWS/NWPS calls. FEMA's ArcGIS front end
// has been seen throttling anonymous clients harder, and Open-Meteo asks
// callers to identify themselves.
const HEADERS = { 'User-Agent': config.nwsUserAgent, Accept: 'application/json' };
const RETRY_DELAY_MS = 400;
// A retry with less time than this left in its budget can't realistically
// succeed — fail now rather than spend the rest of the window.
const MIN_RETRY_MS = 2_000;
// Hard ceiling on one upstream body. An NFHL envelope answer is normally a few
// MB; one past this is a pathological feature set, and the parse would cost
// several times its size in heap on a 512 MB dyno. Open-Meteo answers are
// tens to hundreds of KB, so the same ceiling never bites them.
const MAX_BODY_BYTES = 25 * 1024 * 1024;

// `retryable` separates a blip (timeout, reset, 5xx, 429) from a request the
// upstream will never answer (a 400 for bad parameters) — retrying the latter
// only spends quota and delays the 502.
class UpstreamError extends Error {
  constructor(
    message: string,
    readonly retryable: boolean
  ) {
    super(message);
    this.name = 'UpstreamError';
  }
}

// Pull a human-readable reason out of an upstream error body: Open-Meteo sends
// HTTP 400 + { error: true, reason }, ArcGIS sends { error: { code, message } }.
function upstreamReason(body: unknown): string | null {
  if (!body || typeof body !== 'object') return null;
  const b = body as { reason?: unknown; error?: unknown };
  if (typeof b.reason === 'string' && b.reason.trim()) return b.reason.trim();
  if (b.error && typeof b.error === 'object') {
    const m = (b.error as { message?: unknown }).message;
    if (typeof m === 'string' && m.trim()) return m.trim();
  }
  if (typeof b.error === 'string' && b.error.trim()) return b.error.trim();
  return null;
}

const errText = (err: unknown) => (err instanceof Error ? err.message : String(err));

/**
 * The body as text, refusing past `maxBytes`: a declared Content-Length over
 * the cap fails before any of it is read, and the stream is counted as it
 * arrives (the header can be absent, or be the compressed size). Too large is
 * not retryable — the same query would send the same body again.
 */
async function readBodyCapped(res: Response, label: string, maxBytes: number): Promise<string> {
  const tooLarge = () => new UpstreamError(`${label}: response too large (over ${maxBytes} bytes)`, false);
  const declared = Number(res.headers.get('content-length'));
  if (Number.isFinite(declared) && declared > maxBytes) {
    await res.body?.cancel().catch(() => {});
    throw tooLarge();
  }
  if (!res.body) return '';
  const reader = res.body.getReader();
  const chunks: Uint8Array[] = [];
  let total = 0;
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    total += value.byteLength;
    if (total > maxBytes) {
      await reader.cancel().catch(() => {});
      throw tooLarge();
    }
    chunks.push(value);
  }
  return Buffer.concat(chunks).toString('utf8');
}

async function fetchOnce(url: string, label: string, timeoutMs: number, maxBytes: number): Promise<unknown> {
  let res: Response;
  try {
    res = await fetch(url, { headers: HEADERS, signal: AbortSignal.timeout(timeoutMs) });
  } catch (err) {
    throw new UpstreamError(`${label}: ${errText(err)}`, true);
  }
  let text = '';
  try {
    text = await readBodyCapped(res, label, maxBytes);
  } catch (err) {
    // An error body that can't be read only loses its reason — the status
    // below still decides. A 200 whose body can't be read is the failure.
    if (res.ok) throw err instanceof UpstreamError ? err : new UpstreamError(`${label}: ${errText(err)}`, true);
  }
  let body: unknown;
  try {
    body = JSON.parse(text);
  } catch {
    body = undefined;
  }
  if (!res.ok) {
    const reason = upstreamReason(body);
    throw new UpstreamError(
      `${label} HTTP ${res.status}${reason ? `: ${reason}` : ''}`,
      res.status >= 500 || res.status === 429
    );
  }
  // A 200 that isn't JSON is a proxy/maintenance page — worth one more try.
  if (body === undefined) throw new UpstreamError(`${label}: response is not JSON`, true);
  return body;
}

export interface UpstreamOptions {
  /** Tries in all, transient failures only (default 1). */
  attempts?: number;
  /** Wall-clock budget for every try and backoff together (default timeoutMs). */
  budgetMs?: number;
  /** Largest body accepted, in bytes (default MAX_BODY_BYTES). */
  maxBytes?: number;
}

/**
 * GET a JSON upstream with a hard per-try timeout and up to `attempts` tries
 * (transient failures only), all inside `budgetMs`. The budget keeps the worst
 * case under Heroku's 30 s router limit: two full 15 s tries plus the backoff
 * would otherwise trip an H12 even when the retry was about to succeed.
 */
export async function fetchUpstreamJson(
  url: string,
  label: string,
  timeoutMs: number,
  { attempts = 1, budgetMs = timeoutMs, maxBytes = MAX_BODY_BYTES }: UpstreamOptions = {}
): Promise<unknown> {
  const deadline = Date.now() + budgetMs;
  let lastErr: unknown;
  for (let i = 0; i < attempts; i++) {
    const left = deadline - Date.now();
    if (i > 0 && left < MIN_RETRY_MS) break;
    try {
      return await fetchOnce(url, label, Math.max(1, Math.min(timeoutMs, left)), maxBytes);
    } catch (err) {
      lastErr = err;
      if (err instanceof UpstreamError && !err.retryable) break;
      if (i < attempts - 1) await new Promise((r) => setTimeout(r, RETRY_DELAY_MS));
    }
  }
  throw lastErr;
}

const finiteOrNull = (v: unknown): number | null =>
  typeof v === 'number' && Number.isFinite(v) ? v : null;

// Leading run of strings — a malformed entry ends the series rather than
// shifting every later value onto the wrong timestamp.
function stringRun(v: unknown): string[] {
  if (!Array.isArray(v)) return [];
  const out: string[] = [];
  for (const s of v) {
    if (typeof s !== 'string') break;
    out.push(s);
  }
  return out;
}

// ── FEMA flood zone (NFHL layer 28, S_FLD_HAZ_AR) ─────────────────────────────
// The National Flood Hazard Layer is the digital FIRM. Two queries: the exact
// point (what zone is the property in, with its base flood elevation) and a
// ~2 mi envelope (the zone map around it, and how far the nearest Special
// Flood Hazard Area is). f=json (Esri JSON) rather than geojson: the geojson
// output only exists on ArcGIS 10.4+, and FEMA has served older front ends.

const NFHL_ZONES = 'https://hazards.fema.gov/arcgis/rest/services/public/NFHL/MapServer/28/query';
const ZONE_TTL_MS = 7 * 24 * 60 * 60 * 1000; // FIRMs change by LOMR/revision, months apart
// An at-site-only answer (envelope failed) is a blip's result, not the map's:
// hold it just long enough to spare FEMA a retry storm, then ask again.
const PARTIAL_ZONE_TTL_MS = 15 * 60 * 1000;
const FEMA_TIMEOUT_MS = 25_000; // NFHL is routinely slow; 25 s still fits the platform window
const ENVELOPE_MI = 2;
// ~60k vertices ≈ 1.5 MB of JSON — the most a printable report map needs.
const MAX_VERTICES = 60_000;
// Earth radius 3958.7613 mi × π/180 — the radius the server's haversine uses
// (lightning/near.ts). The envelope uses the rounder 69 mi/° from the spec.
const MI_PER_DEG = 69.0934;
// NFHL numeric fields use -9999 (and occasionally -8888) for "not applicable".
const NFHL_SENTINEL_MAX = -8000;

// Legacy FIRM zone codes that are SFHA — only consulted when SFHA_TF itself is
// missing, so a partial attribute set can't read as "outside the floodplain".
const SFHA_ZONE = /^(?:A[EHO]?|AR(?:\/A[EHO]?)?|A99|VE?|[AV]\d{1,2})$/;

export interface Box {
  xmin: number;
  ymin: number;
  xmax: number;
  ymax: number;
}

/** One parsed NFHL feature: display attributes + [lon, lat] rings (empty for point queries). */
export interface NfhlFeature extends FemaSiteZone {
  rings: number[][][];
}

export interface NfhlQueryResult {
  features: NfhlFeature[];
  /** Features the service returned, including ones dropped for a blank FLD_ZONE. */
  rawCount: number;
  exceededTransferLimit: boolean;
}

// Case-insensitive attribute lookup. Some ArcGIS services also qualify field
// names with their table ("S_FLD_HAZ_AR.FLD_ZONE"), so strip any prefix too.
function attrReader(attrs: unknown): (field: string) => unknown {
  const map = new Map<string, unknown>();
  if (attrs && typeof attrs === 'object') {
    for (const [k, v] of Object.entries(attrs as Record<string, unknown>)) {
      const bare = k.slice(k.lastIndexOf('.') + 1).toLowerCase();
      if (!map.has(bare)) map.set(bare, v);
    }
  }
  return (field) => map.get(field.toLowerCase());
}

function attrText(v: unknown): string | null {
  if (typeof v === 'number' && Number.isFinite(v)) return String(v);
  if (typeof v !== 'string') return null;
  const t = v.trim();
  return t ? t : null;
}

function attrNumber(v: unknown): number | null {
  const n = typeof v === 'number' ? v : typeof v === 'string' && v.trim() ? Number(v) : NaN;
  if (!Number.isFinite(n) || n <= NFHL_SENTINEL_MAX) return null;
  return Math.round(n * 100) / 100;
}

function attrSfha(v: unknown, zone: string): boolean {
  if (typeof v === 'boolean') return v;
  const t = attrText(v);
  if (t) return t.toUpperCase() === 'T';
  return SFHA_ZONE.test(zone);
}

function parseRings(geometry: unknown): number[][][] {
  const rings = geometry && typeof geometry === 'object' ? (geometry as { rings?: unknown }).rings : undefined;
  if (!Array.isArray(rings)) return [];
  const out: number[][][] = [];
  for (const ring of rings) {
    if (!Array.isArray(ring)) continue;
    const pts: number[][] = [];
    for (const p of ring) {
      // Keep x/y only — a z or m value would break the client's [lon, lat] reads.
      if (Array.isArray(p) && Number.isFinite(p[0]) && Number.isFinite(p[1])) pts.push([p[0], p[1]]);
    }
    if (pts.length >= 3) out.push(pts);
  }
  return out;
}

/**
 * Parse an NFHL layer-28 query answer (f=json). ArcGIS reports failures as
 * HTTP 200 + { error: { code, message } }; that throws, so an error body is
 * never cached for a week as "no flood zones here".
 */
export function parseNfhlQuery(json: unknown): NfhlQueryResult {
  if (!json || typeof json !== 'object') throw new Error('FEMA NFHL: response is not an object');
  const j = json as { features?: unknown; exceededTransferLimit?: unknown; error?: unknown };
  if (j.error) {
    const e = j.error as { code?: unknown; message?: unknown; details?: unknown };
    const details = Array.isArray(e.details) ? e.details.filter((d) => typeof d === 'string') : [];
    const msg = [typeof e.message === 'string' ? e.message : 'ArcGIS error', ...details].join(' — ');
    throw new Error(`FEMA NFHL error${typeof e.code === 'number' ? ` ${e.code}` : ''}: ${msg}`);
  }
  // No features array at all is a malformed answer, not an empty map.
  if (!Array.isArray(j.features)) throw new Error('FEMA NFHL: response has no features array');

  const features: NfhlFeature[] = [];
  for (const f of j.features) {
    if (!f || typeof f !== 'object') continue;
    const read = attrReader((f as { attributes?: unknown }).attributes);
    const zone = attrText(read('FLD_ZONE'))?.toUpperCase();
    if (!zone) continue; // unclassifiable — still counts toward coverage via rawCount
    features.push({
      zone,
      subtype: attrText(read('ZONE_SUBTY')),
      sfha: attrSfha(read('SFHA_TF'), zone),
      bfeFt: attrNumber(read('STATIC_BFE')),
      depthFt: attrNumber(read('DEPTH')),
      datum: attrText(read('V_DATUM')),
      rings: parseRings((f as { geometry?: unknown }).geometry),
    });
  }
  return {
    features,
    rawCount: j.features.length,
    exceededTransferLimit: j.exceededTransferLimit === true,
  };
}

// Higher = more hazardous. Floodway first: it is the channel that must stay
// open to pass the base flood, where encroachment is barred and velocities are
// highest. V zones next (coastal high hazard — wave action), then the rest of
// the SFHA, then the 0.2%-annual-chance "shaded X" band.
function zoneHazardRank(f: FemaZoneFeature): number {
  const sub = (f.subtype ?? '').toUpperCase();
  if (sub.includes('FLOODWAY')) return 5;
  if (f.zone.startsWith('V')) return 4;
  if (f.sfha) return 3;
  if (sub.includes('0.2 PCT') || f.zone === 'B' || f.zone === 'X500') return 2;
  return 1;
}

/**
 * The zone at the property. Several NFHL polygons can overlap one point (a
 * floodway inside its AE, a panel seam); report the most hazardous so an
 * overlap never understates the exposure. Ties keep FEMA's order.
 */
export function pickSiteZone(features: FemaSiteZone[]): FemaSiteZone | null {
  let best: FemaSiteZone | null = null;
  let bestRank = -1;
  for (const f of features) {
    const rank = zoneHazardRank(f);
    if (rank > bestRank) {
      best = f;
      bestRank = rank;
    }
  }
  return best
    ? {
        zone: best.zone,
        subtype: best.subtype,
        sfha: best.sfha,
        bfeFt: best.bfeFt,
        depthFt: best.depthFt,
        datum: best.datum,
      }
    : null;
}

/** Envelope of ±`mi` miles around the site, in degrees (dLon widens with latitude). */
export function envelopeAround(lat: number, lon: number, mi = ENVELOPE_MI): Box {
  const dLat = mi / 69;
  const dLon = dLat / Math.max(0.01, Math.cos((lat * Math.PI) / 180));
  return {
    xmin: Math.max(-180, lon - dLon),
    ymin: Math.max(-90, lat - dLat),
    xmax: Math.min(180, lon + dLon),
    ymax: Math.min(90, lat + dLat),
  };
}

// Local equirectangular projection centred on the site, in miles. Within a few
// miles its error is far below the NFHL's own generalization.
function projector(lat0: number, lon0: number): (p: number[]) => [number, number] {
  const kx = Math.cos((lat0 * Math.PI) / 180) * MI_PER_DEG;
  return (p) => {
    let dLon = p[0] - lon0;
    if (dLon > 180) dLon -= 360;
    else if (dLon < -180) dLon += 360;
    return [dLon * kx, (p[1] - lat0) * MI_PER_DEG];
  };
}

function segmentDistance(ax: number, ay: number, bx: number, by: number): number {
  // Distance from the origin (the site) to segment AB.
  const dx = bx - ax;
  const dy = by - ay;
  const len2 = dx * dx + dy * dy;
  let t = len2 > 0 ? -(ax * dx + ay * dy) / len2 : 0;
  t = Math.max(0, Math.min(1, t));
  return Math.hypot(ax + t * dx, ay + t * dy);
}

/**
 * Miles from the site to a polygon: 0 when the site is inside it (even-odd
 * over all rings, so a site in a hole is outside), otherwise the distance to
 * the nearest edge. null when the polygon has no usable ring.
 */
export function featureDistanceMi(lat: number, lon: number, rings: number[][][]): number | null {
  const proj = projector(lat, lon);
  let inside = false;
  let best = Infinity;
  for (const ring of rings) {
    const n = ring.length;
    if (n < 2) continue;
    // Rings from ArcGIS are closed (last = first); treating every ring as
    // closed also covers an unclosed one, at the cost of one zero-length edge.
    let [px, py] = proj(ring[n - 1]);
    for (let i = 0; i < n; i++) {
      const [x, y] = proj(ring[i]);
      if (y > 0 !== py > 0 && 0 < ((px - x) * (0 - y)) / (py - y) + x) inside = !inside;
      const d = segmentDistance(px, py, x, y);
      if (d < best) best = d;
      px = x;
      py = y;
    }
  }
  if (inside) return 0;
  return Number.isFinite(best) ? best : null;
}

/**
 * Distance to the nearest SFHA polygon in the envelope (0 = at site, null =
 * none found). The point query is the precise at-site answer; the envelope
 * polygons are generalized (~5 m), so they only decide inside/outside when the
 * point query found no zone at all.
 */
export function nearestSfhaMi(
  lat: number,
  lon: number,
  polygons: Array<FemaZoneFeature & { rings: number[][][] }>,
  atSite: FemaZoneFeature | null
): number | null {
  if (atSite?.sfha) return 0;
  let best = Infinity;
  for (const p of polygons) {
    if (!p.sfha) continue;
    const d = featureDistanceMi(lat, lon, p.rings);
    if (d !== null && d < best) best = d;
  }
  if (!Number.isFinite(best)) return null;
  // 0 is reserved for "inside the SFHA", so an outside distance never rounds
  // down to it: a site 20 ft from the line reads 0.01 mi. And when the point
  // query says "not SFHA" but a generalized SFHA edge still covers the site,
  // report it as right at the edge — 0 would contradict the at-site zone.
  if (best === 0) return atSite ? 0.01 : 0;
  return Math.max(0.01, Math.round(best * 100) / 100);
}

// ── Polygon bounding ──────────────────────────────────────────────────────────
// An ArcGIS envelope query returns every intersecting feature WHOLE: one
// riverine AE polygon can run 100 miles upstream, and an area-of-minimal-hazard
// X polygon is often a county-wide shape holed by every floodplain in it. The
// report only draws the envelope, so each ring is clipped to it first; the
// vertex cap then drops whole polygons, farthest first, and thins the nearest
// one if it alone is over the cap.

const round6 = (v: number) => Math.round(v * 1e6) / 1e6;

function clipAgainst(
  pts: number[][],
  inside: (p: number[]) => boolean,
  cross: (a: number[], b: number[]) => number[]
): number[][] {
  const out: number[][] = [];
  for (let i = 0; i < pts.length; i++) {
    const cur = pts[i];
    const prev = pts[(i + pts.length - 1) % pts.length];
    const curIn = inside(cur);
    if (curIn !== inside(prev)) out.push(cross(prev, cur));
    if (curIn) out.push(cur);
  }
  return out;
}

function ringArea(ring: number[][]): number {
  let a = 0;
  for (let i = 0, j = ring.length - 1; i < ring.length; j = i++) {
    a += (ring[j][0] - ring[i][0]) * (ring[j][1] + ring[i][1]);
  }
  return Math.abs(a) / 2;
}

/**
 * Sutherland–Hodgman clip of one ring to the box. Clipping each ring on its
 * own preserves even-odd fill inside the box (every ring's inside/outside is
 * unchanged there), so holes survive. Returns a closed ring, or null when
 * nothing with area is left.
 */
export function clipRingToBox(ring: number[][], box: Box): number[][] | null {
  let minX = Infinity;
  let minY = Infinity;
  let maxX = -Infinity;
  let maxY = -Infinity;
  for (const [x, y] of ring) {
    if (x < minX) minX = x;
    if (x > maxX) maxX = x;
    if (y < minY) minY = y;
    if (y > maxY) maxY = y;
  }
  if (maxX < box.xmin || minX > box.xmax || maxY < box.ymin || minY > box.ymax) return null;

  // Open the ring for clipping (the closing vertex would be clipped twice).
  let pts = ring;
  const first = ring[0];
  const last = ring[ring.length - 1];
  if (first[0] === last[0] && first[1] === last[1]) pts = ring.slice(0, -1);

  const fullyInside = minX >= box.xmin && maxX <= box.xmax && minY >= box.ymin && maxY <= box.ymax;
  if (!fullyInside) {
    const atX = (X: number) => (a: number[], b: number[]) => [X, a[1] + ((X - a[0]) / (b[0] - a[0])) * (b[1] - a[1])];
    const atY = (Y: number) => (a: number[], b: number[]) => [a[0] + ((Y - a[1]) / (b[1] - a[1])) * (b[0] - a[0]), Y];
    pts = clipAgainst(pts, (p) => p[0] >= box.xmin, atX(box.xmin));
    pts = clipAgainst(pts, (p) => p[0] <= box.xmax, atX(box.xmax));
    pts = clipAgainst(pts, (p) => p[1] >= box.ymin, atY(box.ymin));
    pts = clipAgainst(pts, (p) => p[1] <= box.ymax, atY(box.ymax));
  }

  // Back to geometryPrecision=6, without the repeats rounding can create.
  const out: number[][] = [];
  for (const p of pts) {
    const q = [round6(p[0]), round6(p[1])];
    const prev = out[out.length - 1];
    if (!prev || prev[0] !== q[0] || prev[1] !== q[1]) out.push(q);
  }
  while (out.length > 1 && out[0][0] === out[out.length - 1][0] && out[0][1] === out[out.length - 1][1]) out.pop();
  if (out.length < 3 || ringArea(out) < 1e-12) return null;
  out.push([out[0][0], out[0][1]]);
  return out;
}

const vertexCount = (rings: number[][][]) => rings.reduce((s, r) => s + r.length, 0);

// Every stride-th vertex of a closed ring, re-closed; null below a triangle.
function thinRing(ring: number[][], stride: number): number[][] | null {
  const pts: number[][] = [];
  for (let i = 0; i < ring.length - 1; i += stride) pts.push(ring[i]);
  return pts.length >= 3 ? [...pts, [pts[0][0], pts[0][1]]] : null;
}

/**
 * Thin a polygon's closed rings to at most `maxVertices` by keeping every
 * stride-th vertex. The stride starts at the even share (total / budget) and
 * grows only until the largest ring fits, which is always kept; the other
 * rings are then kept largest-first while they fit. Each thinned ring rounds
 * up by a vertex or two, so with many rings the budget runs out before the
 * last of them — and it is the specks (small holes and islands, invisible at
 * the report map's scale) that go, not the shape. [] only when even the
 * largest ring can't fit as a triangle. Survivors keep their order.
 */
export function thinRings(rings: number[][][], maxVertices: number): number[][][] {
  const total = vertexCount(rings);
  if (total <= maxVertices) return rings;
  const bySize = rings.map((ring, i) => ({ ring, i })).sort((a, b) => b.ring.length - a.ring.length);
  let stride = Math.ceil(total / maxVertices);
  // Terminates: a large enough stride thins any ring below a triangle (null).
  let largest = thinRing(bySize[0].ring, stride);
  while (largest && largest.length > maxVertices) largest = thinRing(bySize[0].ring, ++stride);
  if (!largest) return [];
  const keep = new Map<number, number[][]>([[bySize[0].i, largest]]);
  let used = largest.length;
  for (const { ring, i } of bySize.slice(1)) {
    const t = thinRing(ring, stride);
    if (t && used + t.length <= maxVertices) {
      keep.set(i, t);
      used += t.length;
    }
  }
  return rings.map((_, i) => keep.get(i)).filter((r): r is number[][] => r !== undefined);
}

/**
 * Keep polygons nearest-first until the vertex budget is spent; everything
 * farther is dropped, so what remains is complete out to some distance rather
 * than patchy. The nearest polygon (normally the site's own zone) is always
 * kept — if it alone is over the budget it is thinned to fit (`thinned`)
 * rather than dropped, since a map without the site's own zone would read as
 * "no zone here". It is dropped only if nothing of it survives thinning.
 * Survivors keep their original order.
 */
export function capPolygonVertices<T extends { rings: number[][][]; distMi: number }>(
  items: T[],
  maxVertices = MAX_VERTICES
): { kept: T[]; dropped: number; thinned: boolean } {
  const byDist = items.map((item, i) => ({ item, i })).sort((a, b) => a.item.distMi - b.item.distMi);
  const keep = new Map<number, T>();
  let thinned = false;
  let total = 0;
  for (const { item, i } of byDist) {
    const v = vertexCount(item.rings);
    if (total + v > maxVertices) {
      if (keep.size > 0) break;
      const rings = thinRings(item.rings, maxVertices);
      thinned = true;
      if (!rings.length) break;
      keep.set(i, { ...item, rings });
      total += vertexCount(rings);
      continue;
    }
    keep.set(i, item);
    total += v;
  }
  return {
    kept: items.map((_, i) => keep.get(i)).filter((item): item is T => item !== undefined),
    dropped: items.length - keep.size,
    thinned,
  };
}

/** Combine the point and envelope answers into the client's shape (minus `updated`). */
export function assembleFemaZone(
  lat: number,
  lon: number,
  point: NfhlQueryResult,
  envelope: NfhlQueryResult,
  box: Box = envelopeAround(lat, lon),
  maxVertices = MAX_VERTICES
): Omit<FemaZoneResponse, 'updated'> {
  const atSite = pickSiteZone(point.features);
  // Distances on the unclipped shapes: an SFHA just past the box edge is still
  // the true nearest, and clipping must not move it.
  const nearest = nearestSfhaMi(lat, lon, envelope.features, atSite);

  const clipped: Array<FemaZonePolygon & { distMi: number }> = [];
  for (const f of envelope.features) {
    const rings = f.rings.map((r) => clipRingToBox(r, box)).filter((r): r is number[][] => r !== null);
    if (!rings.length) continue;
    clipped.push({
      zone: f.zone,
      subtype: f.subtype,
      sfha: f.sfha,
      rings,
      distMi: featureDistanceMi(lat, lon, f.rings) ?? Infinity,
    });
  }
  const { kept, dropped, thinned } = capPolygonVertices(clipped, maxVertices);

  return {
    // Any polygon in the envelope means the area has a digital FIRM. No polygon
    // at all is NOT "minimal hazard" — it is "no digital flood map here".
    covered: envelope.rawCount > 0 || atSite !== null,
    atSite,
    polygons: kept.map(({ zone, subtype, sfha, rings }) => ({ zone, subtype, sfha, rings })),
    nearestSfhaMi: nearest,
    // Two different gaps, kept apart because they mean different things.
    // truncated: FEMA stopped at its record cap, so zones — possibly the
    // nearest SFHA — never reached us and nearestSfhaMi may be too far.
    // mapTrimmed: we dropped or thinned polygons to bound the payload; the
    // distance above was measured on every shape FEMA sent, so only the
    // drawing is affected.
    truncated: envelope.exceededTransferLimit,
    ...(dropped > 0 || thinned ? { mapTrimmed: true } : {}),
  };
}

function nfhlUrl(params: Record<string, string>): string {
  const url = new URL(NFHL_ZONES);
  // where=1=1 is redundant with a geometry filter but some ArcGIS versions
  // reject a query without one. No resultRecordCount: pre-10.3 servers 400 on
  // it; truncation is read from exceededTransferLimit instead.
  url.searchParams.set('where', '1=1');
  for (const [k, v] of Object.entries(params)) url.searchParams.set(k, v);
  url.searchParams.set('f', 'json');
  return url.toString();
}

export async function fetchFemaZone(lat: number, lon: number): Promise<FemaZoneResponse> {
  const box = envelopeAround(lat, lon);
  const common = { inSR: '4326', spatialRel: 'esriSpatialRelIntersects' };
  // Parsed inside each settled promise, so an Esri error body (HTTP 200 +
  // { error }) fails its own query like a timeout or an oversized answer does.
  const [pointR, envR] = await Promise.allSettled([
    fetchUpstreamJson(
      nfhlUrl({
        ...common,
        geometry: `${lon},${lat}`,
        geometryType: 'esriGeometryPoint',
        outFields: 'FLD_ZONE,ZONE_SUBTY,SFHA_TF,STATIC_BFE,DEPTH,V_DATUM',
        returnGeometry: 'false',
      }),
      'FEMA NFHL point',
      FEMA_TIMEOUT_MS
    ).then(parseNfhlQuery),
    fetchUpstreamJson(
      nfhlUrl({
        ...common,
        geometry: [box.xmin, box.ymin, box.xmax, box.ymax].map((v) => v.toFixed(6)).join(','),
        geometryType: 'esriGeometryEnvelope',
        outFields: 'FLD_ZONE,ZONE_SUBTY,SFHA_TF',
        returnGeometry: 'true',
        outSR: '4326',
        maxAllowableOffset: '0.00005',
        geometryPrecision: '6',
      }),
      'FEMA NFHL envelope',
      FEMA_TIMEOUT_MS
    ).then(parseNfhlQuery),
  ]);
  // No point answer, no report: atSite would falsely read "no mapped zone".
  if (pointR.status === 'rejected') throw pointR.reason;
  if (envR.status === 'fulfilled') {
    return { ...assembleFemaZone(lat, lon, pointR.value, envR.value, box), updated: Date.now() };
  }
  // The envelope is the slow, heavy query and the one that times out. The
  // point answer is still the report's headline, so serve it alone and say
  // the rest was not checked — an empty map must not read as "no SFHA
  // nearby". Only a zone at the point proves the area is mapped, though:
  // with neither a zone nor an envelope, coverage itself is unknown.
  const atSite = pickSiteZone(pointR.value.features);
  if (atSite === null) throw envR.reason;
  console.warn(`[flood] NFHL envelope failed for ${lat},${lon}; serving the at-site zone only:`, errText(envR.reason));
  return {
    covered: true,
    atSite,
    polygons: [],
    nearestSfhaMi: null,
    truncated: false,
    envelopeUnavailable: true,
    updated: Date.now(),
  };
}

// ── Precipitation at the site (Open-Meteo) ────────────────────────────────────
// Modelled, not gauged: past_days=7 gives the antecedent-rain signal (wet
// ground floods faster) and forecast_days=6 (today + 5 days) the timing of
// what's coming — the client sums the hourly series into next-24/48/72 h and
// 5-day totals. 7 past + 6 forecast days stays inside Open-Meteo's two weeks
// per call; past that, one request is billed as several. The report labels it
// as model output.

const PRECIP_TTL_MS = 30 * 60 * 1000;
const PRECIP_TIMEOUT_MS = 15_000;
// Both tries together — the retry gets whatever the first one left.
const PRECIP_BUDGET_MS = 25_000;

/** Map an Open-Meteo forecast answer to the client's shape (minus `updated`). */
export function normalizePrecip(json: unknown): Omit<FloodPrecipResponse, 'updated'> {
  if (!json || typeof json !== 'object') throw new Error('Open-Meteo precip: response is not an object');
  const j = json as {
    error?: unknown;
    reason?: unknown;
    timezone?: unknown;
    utc_offset_seconds?: unknown;
    daily?: { time?: unknown; precipitation_sum?: unknown };
    hourly?: { time?: unknown; precipitation?: unknown; precipitation_probability?: unknown };
  };
  if (j.error === true) throw new Error(`Open-Meteo precip: ${upstreamReason(j) ?? 'error'}`);

  const dTime = stringRun(j.daily?.time);
  const dSum = Array.isArray(j.daily?.precipitation_sum) ? (j.daily.precipitation_sum as unknown[]) : [];
  const dLen = Math.min(dTime.length, dSum.length);

  const hTime = stringRun(j.hourly?.time);
  const hSum = Array.isArray(j.hourly?.precipitation) ? (j.hourly.precipitation as unknown[]) : [];
  const hProbRaw = j.hourly?.precipitation_probability;
  // Probability is optional (some models don't carry it): absent → all null,
  // rather than truncating the rain series to nothing.
  const hProb = Array.isArray(hProbRaw) ? (hProbRaw as unknown[]) : null;
  const hLen = Math.min(hTime.length, hSum.length, hProb ? hProb.length : Infinity);

  if (dLen === 0 || hLen === 0) throw new Error('Open-Meteo precip: empty series');

  return {
    timezone: typeof j.timezone === 'string' && j.timezone ? j.timezone : 'UTC',
    utcOffsetSeconds: finiteOrNull(j.utc_offset_seconds) ?? 0,
    // A missing hour/day is a model gap and stays null: a hole is not a dry
    // hour, and a 0 here would quietly shrink every total that spans it. The
    // client declines any window with a gap in it rather than under-report
    // the rain. Past-hour probability is null for the same reason — "no
    // forecast was made" must not read as a 0% chance.
    daily: {
      time: dTime.slice(0, dLen),
      precipIn: dSum.slice(0, dLen).map(finiteOrNull),
    },
    hourly: {
      time: hTime.slice(0, hLen),
      precipIn: hSum.slice(0, hLen).map(finiteOrNull),
      probPct: hProb ? hProb.slice(0, hLen).map(finiteOrNull) : new Array<number | null>(hLen).fill(null),
    },
  };
}

export async function fetchFloodPrecip(lat: number, lon: number): Promise<FloodPrecipResponse> {
  const url =
    'https://api.open-meteo.com/v1/forecast' +
    `?latitude=${lat}&longitude=${lon}` +
    '&hourly=precipitation,precipitation_probability&daily=precipitation_sum' +
    '&past_days=7&forecast_days=6&precipitation_unit=inch&timezone=auto';
  // One quick retry: Open-Meteo blips are usually single requests, and the
  // report fans out many calls at once.
  const json = await fetchUpstreamJson(url, 'Open-Meteo precip', PRECIP_TIMEOUT_MS, {
    attempts: 2,
    budgetMs: PRECIP_BUDGET_MS,
  });
  return { ...normalizePrecip(json), updated: Date.now() };
}

// ── River discharge (GloFAS v4 via Open-Meteo Flood API) ──────────────────────
// Modelled flow at the nearest ~5 km river cell — useful where NWPS has no
// gauge, and the ensemble spread says how sure the model is. Thresholds are
// return-period flows from the model's own reanalysis, so forecast and
// threshold share the model's bias (comparing GloFAS flow against a gauge's
// rating would not). The 2/5/20-year flows are a Gumbel fit to the annual
// maxima of the last 20 complete reanalysis years — the matrix rule — done
// and persisted per cell by ./glofasClimate; this file only pulls the series.

const GLOFAS = 'https://flood-api.open-meteo.com/v1/flood';
const DISCHARGE_TTL_MS = 3 * 60 * 60 * 1000; // GloFAS runs once a day
// In-memory layer over the Postgres snapshot, so repeat reports for a cell
// don't even pay the database read.
const CLIMATE_TTL_MS = 30 * 24 * 60 * 60 * 1000;
const DISCHARGE_TIMEOUT_MS = 15_000;
const CLIMATE_TIMEOUT_MS = 30_000;
// The route stops waiting for thresholds after this and answers without them;
// the pull carries on and fills the cache and the snapshot for the next report.
// A cold cell's 30 s pull (plus the snapshot read) would otherwise ride past
// Heroku's 30 s router limit and turn an optional extra into an H12 for the
// whole discharge feed.
const CLIMATE_ROUTE_WAIT_MS = 20_000;
// Open-Meteo bills long ranges as many calls (~520 for 20 years against a
// 600/min free tier), so a failing climatology pull is not retried on every
// report for that cell.
const CLIMATE_BACKOFF_MS = 15 * 60 * 1000;

// GloFAS v4 on Open-Meteo is a 0.05° grid whose cell CENTRES sit at odd
// multiples of 0.025° (rows -59.975…89.975; 7200 columns from -180.025).
// Rounding to a multiple of 0.05 lands on a cell CORNER, where Open-Meteo's
// nearest-cell lookup is a float tie-break between four cells — most of the
// time a neighbour of the one holding the site. Snapping to the centre of the
// containing cell makes the lookup unambiguous, and nearby sites still share
// one cached call (and one stored threshold fit).
const GLOFAS_LAT_MIN = -59.975;
const GLOFAS_LAT_MAX = 89.975;

const glofasCellCentre = (v: number): number => Number((Math.floor(v * 20) / 20 + 0.025).toFixed(3));

/** Centre latitude of the GloFAS cell holding `lat`, clamped to the grid's rows. */
export const snapToGlofasLat = (lat: number): number =>
  Math.min(GLOFAS_LAT_MAX, Math.max(GLOFAS_LAT_MIN, glofasCellCentre(lat)));

/**
 * Centre longitude of the GloFAS cell holding `lon`. The grid's first column
 * is centred at -180.025, i.e. it spans 179.95…180; that cell comes back as
 * 179.975 — the same column (Open-Meteo wraps the column index on a global
 * grid) but inside the API's ±180 range, which would reject -180.025. ±180 is
 * one meridian and, like every cell edge, belongs to the cell east of it.
 */
export function snapToGlofasLon(lon: number): number {
  // Wrap only when needed: the modulo arithmetic can nudge an in-range value
  // across a cell edge.
  const w = lon >= -180 && lon < 180 ? lon : ((((lon + 180) % 360) + 360) % 360) - 180;
  return glofasCellCentre(w);
}

type DischargeDaily = Record<string, unknown> & { time?: unknown };

function readFloodApi(json: unknown, label: string): { latitude?: unknown; longitude?: unknown; daily?: DischargeDaily } {
  if (!json || typeof json !== 'object') throw new Error(`${label}: response is not an object`);
  const j = json as { error?: unknown; latitude?: unknown; longitude?: unknown; daily?: DischargeDaily };
  if (j.error === true) throw new Error(`${label}: ${upstreamReason(j) ?? 'error'}`);
  return j;
}

/** Map a GloFAS forecast answer to the client's parallel arrays (minus thresholds/updated). */
export function normalizeDischarge(
  json: unknown,
  fallbackLat: number,
  fallbackLon: number
): Omit<FloodDischargeResponse, 'thresholds' | 'updated'> {
  const j = readFloodApi(json, 'GloFAS forecast');
  const d = j.daily ?? {};
  const time = stringRun(d.time);
  if (!time.length) throw new Error('GloFAS forecast: empty series');
  // Every array is laid against `time`: short arrays pad with null and a
  // missing variable is all null, so no value ever shifts onto another day.
  const col = (name: string): Array<number | null> => {
    const a = d[name];
    return time.map((_, i) => (Array.isArray(a) ? finiteOrNull(a[i]) : null));
  };
  return {
    lat: finiteOrNull(j.latitude) ?? fallbackLat,
    lon: finiteOrNull(j.longitude) ?? fallbackLon,
    time,
    discharge: col('river_discharge'),
    median: col('river_discharge_median'),
    p25: col('river_discharge_p25'),
    p75: col('river_discharge_p75'),
    min: col('river_discharge_min'),
    max: col('river_discharge_max'),
  };
}

export async function fetchDischargeForecast(
  lat: number,
  lon: number
): Promise<Omit<FloodDischargeResponse, 'thresholds'>> {
  const url =
    `${GLOFAS}?latitude=${lat}&longitude=${lon}` +
    '&daily=river_discharge,river_discharge_median,river_discharge_p25,river_discharge_p75,river_discharge_min,river_discharge_max' +
    '&past_days=14&forecast_days=30';
  const json = await fetchUpstreamJson(url, 'GloFAS forecast', DISCHARGE_TIMEOUT_MS);
  return { ...normalizeDischarge(json, lat, lon), updated: Date.now() };
}

/** One cell's daily reanalysis flow over `window`, laid against its dates (the Gumbel fit's input). */
export async function fetchClimateSeries(
  lat: number,
  lon: number,
  window: ClimateWindow
): Promise<{ time: string[]; q: Array<number | null> }> {
  const url =
    `${GLOFAS}?latitude=${lat}&longitude=${lon}` +
    `&daily=river_discharge&start_date=${window.start}&end_date=${window.end}`;
  const json = await fetchUpstreamJson(url, 'GloFAS climatology', CLIMATE_TIMEOUT_MS);
  const d = readFloodApi(json, 'GloFAS climatology').daily ?? {};
  const time = stringRun(d.time);
  // Empty is a failed pull (thrown, so nothing is stored); an all-null series
  // is a real answer — too short to fit — and is stored as such.
  if (!time.length) throw new Error('GloFAS climatology: empty series');
  const raw = d.river_discharge;
  return { time, q: time.map((_, i) => (Array.isArray(raw) ? finiteOrNull(raw[i]) : null)) };
}

/** This year's stored fit for the cell, else pull the window, fit it and store it. */
export function fetchDischargeClimatology(lat: number, lon: number, now = new Date()): Promise<ReturnPeriods | null> {
  return resolveReturnPeriods(lat, lon, (window) => fetchClimateSeries(lat, lon, window), now);
}

const climateFailedAt = new Map<string, number>();

async function climatologyGuarded(key: string, lat: number, lon: number): Promise<ReturnPeriods | null> {
  const now = Date.now();
  for (const [k, t] of climateFailedAt) if (now - t >= CLIMATE_BACKOFF_MS) climateFailedAt.delete(k);
  if (climateFailedAt.has(key)) throw new Error('GloFAS climatology failed recently; backing off');
  try {
    return await fetchDischargeClimatology(lat, lon);
  } catch (err) {
    climateFailedAt.set(key, Date.now());
    throw err;
  }
}

// Resolve with `p`, or with null once `ms` has passed. `p` itself keeps
// running, so a late answer still lands in the cache for the next report.
function nullAfter<T>(p: Promise<T | null>, ms: number, onLate: () => void): Promise<T | null> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  const late = new Promise<null>((resolve) => {
    timer = setTimeout(() => {
      onLate();
      resolve(null);
    }, ms);
  });
  return Promise.race([p, late]).finally(() => clearTimeout(timer));
}

/**
 * Forecast + thresholds for one grid cell. The climatology is optional: when
 * it fails or is still being pulled the chart still renders and the client
 * marks the section "thresholds unavailable" — never a silent Low. The
 * forecast is not optional.
 */
export async function getFloodDischarge(
  lat: number,
  lon: number,
  climateWaitMs = CLIMATE_ROUTE_WAIT_MS
): Promise<FloodDischargeResponse> {
  // Keyed by the fit's window so a new year's fit replaces last year's on
  // 1 January, not whenever the 30-day entry happens to lapse.
  const climateKey = `flood-q-clim:${climatologyWindow().end}:${lat},${lon}`;
  const thresholds = cache
    .getOrFetch(climateKey, CLIMATE_TTL_MS, () => climatologyGuarded(climateKey, lat, lon), {
      staleOnError: true,
    })
    .catch((err: unknown) => {
      console.warn(
        `[flood] climatology unavailable for ${lat},${lon} (thresholds omitted):`,
        err instanceof Error ? err.message : err
      );
      return null;
    });
  const [forecast, rp] = await Promise.all([
    cache.getOrFetch(`flood-q:${lat},${lon}`, DISCHARGE_TTL_MS, () => fetchDischargeForecast(lat, lon), {
      staleOnError: true,
    }),
    nullAfter(thresholds, climateWaitMs, () => {
      console.warn(`[flood] climatology for ${lat},${lon} still pulling; answering without thresholds`);
    }),
  ]);
  return { ...forecast, thresholds: rp };
}

// ── Routes ────────────────────────────────────────────────────────────────────

function readLatLon(req: Request): { lat: number; lon: number } | null {
  const rawLat = req.query.lat;
  const rawLon = req.query.lon;
  // Number('') is 0 — an empty param must not silently become Null Island.
  if (typeof rawLat !== 'string' || typeof rawLon !== 'string' || !rawLat.trim() || !rawLon.trim()) return null;
  const lat = Number(rawLat);
  const lon = Number(rawLon);
  if (!Number.isFinite(lat) || !Number.isFinite(lon) || lat < -90 || lat > 90 || lon < -180 || lon > 180) return null;
  return { lat, lon };
}

const BAD_COORDS = { error: 'valid lat and lon query params required' };

router.get('/zone', async (req, res) => {
  const p = readLatLon(req);
  if (!p) {
    res.status(400).json(BAD_COORDS);
    return;
  }
  // 4 decimals (~11 m): the at-point zone must be precise — a floodway can be
  // a few dozen metres wide — so only near-identical pins share a cache entry.
  const lat = Math.round(p.lat * 1e4) / 1e4;
  const lon = Math.round(p.lon * 1e4) / 1e4;
  const key = `flood-zone:${lat},${lon}`;
  try {
    // Cached as the serialized answer, not the object: up to MAX_VERTICES
    // coordinates as nested arrays hold ~3× their JSON size in heap, and a
    // week of entries sits on a 512 MB dyno. Serializing once also spares
    // every repeat report a multi-MB JSON.stringify (same as ./alerts).
    let partial = false;
    const body = await cache.getOrFetch<Buffer>(
      key,
      ZONE_TTL_MS,
      async () => {
        const zone = await fetchFemaZone(lat, lon);
        partial = zone.envelopeUnavailable === true;
        return Buffer.from(JSON.stringify(zone));
      },
      { staleOnError: true }
    );
    // getOrFetch stored it for the full week; re-store a partial answer with
    // the short TTL so the next report retries the envelope.
    if (partial) cache.set(key, body, PARTIAL_ZONE_TTL_MS);
    res.type('application/json').send(body);
  } catch (err) {
    console.error('FEMA flood zone route error', err);
    res.status(502).json({ error: 'FEMA flood zone unavailable' });
  }
});

router.get('/precip', async (req, res) => {
  const p = readLatLon(req);
  if (!p) {
    res.status(400).json(BAD_COORDS);
    return;
  }
  // ~0.1° (~11 km), like /api/wind/daily — well inside the model's own grid.
  const lat = Math.round(p.lat * 10) / 10;
  const lon = Math.round(p.lon * 10) / 10;
  try {
    const data = await cache.getOrFetch<FloodPrecipResponse>(
      `flood-precip:${lat},${lon}`,
      PRECIP_TTL_MS,
      () => fetchFloodPrecip(lat, lon),
      { staleOnError: true }
    );
    res.json(data);
  } catch (err) {
    console.error('Flood precipitation route error', err);
    res.status(502).json({ error: 'Precipitation forecast unavailable' });
  }
});

router.get('/discharge', async (req, res) => {
  const p = readLatLon(req);
  if (!p) {
    res.status(400).json(BAD_COORDS);
    return;
  }
  try {
    res.json(await getFloodDischarge(snapToGlofasLat(p.lat), snapToGlofasLon(p.lon)));
  } catch (err) {
    console.error('River discharge route error', err);
    res.status(502).json({ error: 'River discharge forecast unavailable' });
  }
});

export default router;
