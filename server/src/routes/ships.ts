import { Router } from 'express';
import WebSocket from 'ws';
import fs from 'fs';
import path from 'path';
import { config } from '../config';
import { pool } from '../db';

const router = Router();

// The tracked passenger fleet (Windstar Cruises). AIS identifies vessels only by
// MMSI, so we subscribe to these MMSIs directly rather than fishing them out of
// the global firehose by waiting for each ship's periodic static-data (IMO)
// broadcast — the latter almost never catches a specific ship at the free tier's
// volume. IMO + name are seeded so a position report can be labelled before any
// static-data message arrives. MMSIs verified against VesselFinder/MarineTraffic.
interface FleetShip {
  mmsi: string;
  imo: number;
  name: string;
}
const FLEET: FleetShip[] = [
  { mmsi: '311083000', imo: 8807997, name: 'Star Breeze' },
  { mmsi: '311085000', imo: 9008598, name: 'Star Legend' },
  { mmsi: '311084000', imo: 8707343, name: 'Star Pride' },
  { mmsi: '311001759', imo: 9904819, name: 'Star Seeker' },
  { mmsi: '309056000', imo: 8603509, name: 'Wind Spirit' },
  { mmsi: '309163000', imo: 8420878, name: 'Wind Star' },
  { mmsi: '309242000', imo: 8700785, name: 'Wind Surf' },
];
const ALLOWED_IMOS = new Set(FLEET.map((s) => s.imo));
const FLEET_MMSIS = FLEET.map((s) => s.mmsi);

// aisstream subscription mode. The firehose streams every ship aisstream sees
// worldwide — useful once as a diagnostic (it proved none of the fleet are in
// the community receiver network: 150k+ messages, 0 fleet matches), but that's
// ~5 GB/day of inbound data for zero benefit now that CruiseMapper is the
// reliable position source. So we default to the narrow FiltersShipMMSI: it
// sips almost no data and still delivers a live update the moment one of the
// fleet sails into a receiver's range, supplementing the 2-hourly scrape. Set
// AIS_MMSI_FILTER=0 to fall back to the firehose (e.g. if scraping ever breaks).
const USE_MMSI_FILTER = process.env.AIS_MMSI_FILTER !== '0';

interface VesselData {
  mmsi: string;
  imo: number | null;
  name: string | null;
  callsign: string | null;
  shipType: number | null;
  latitude: number;
  longitude: number;
  speedKt: number | null;
  heading: number | null;   // TrueHeading (511 = not available in AIS)
  course: number | null;    // COG
  navStatus: number | null; // AIS navigation status 0-15
  destination: string | null;
  etaUtc: number | null;    // parsed ETA, epoch ms UTC
  etaText: string | null;   // provider's raw ETA string (kept when unparseable)
  etaAt: number | null;     // when the ETA was last actually reported by a source
  updatedAt: number;        // FIX time: when the ship reported this position (see applyFix)
  receivedAt: number;       // when this server ingested the fix
  source: FixSource;        // which feed the position came from
  reception: Reception;     // how the ship's transmission reached that feed
}

// Which feed a position came from. 'snapshot' marks a fix restored from a
// persisted snapshot that was written before sources were recorded.
export type FixSource =
  | 'aisstream'
  | 'cruisemapper'
  | 'vesselfinder'
  | 'myshiptracking'
  | 'marinetraffic'
  | 'snapshot';

// How a position reached the feed that reported it. This is the distinction
// that decides whether a ship mid-ocean can be seen at all:
//   terrestrial — a shore station heard it; coastal waters only.
//   satellite   — a low-earth-orbit receiver heard it; global, higher latency.
//   roaming     — another vessel in a partner fleet relayed it; fills the gaps
//                 satellites and shore stations leave.
// Free aisstream is terrestrial only, so a ship in mid-Pacific is invisible to
// it however healthy the connection looks. null means the feed did not say.
export type Reception = 'terrestrial' | 'satellite' | 'roaming' | null;

// Side-cache for static data that may arrive before a position report.
interface StaticInfo {
  imo: number | null;
  name: string | null;
  callsign: string | null;
  shipType: number | null;
  destination: string | null;
  etaUtc: number | null;
  etaText: string | null;
  etaAt: number | null;
}

// --- ETA parsing -------------------------------------------------------------
// AIS ETAs carry no year (month/day/hour/minute, UTC), so infer the year that
// puts the date closest to now — "Jan 2" reported on Dec 28 lands next year.
// Month/Day 0 and Hour 24 / Minute 60 are AIS "not available" sentinels.
export function etaFromAisFields(
  month: unknown,
  day: unknown,
  hour: unknown,
  minute: unknown
): number | null {
  const M = typeof month === 'number' ? month : 0;
  const D = typeof day === 'number' ? day : 0;
  if (M < 1 || M > 12 || D < 1 || D > 31) return null;
  const H = typeof hour === 'number' && hour < 24 ? hour : 0;
  const Min = typeof minute === 'number' && minute < 60 ? minute : 0;
  const now = Date.now();
  const year = new Date(now).getUTCFullYear();
  let best: number | null = null;
  for (const y of [year - 1, year, year + 1]) {
    const t = Date.UTC(y, M - 1, D, H, Min);
    if (best === null || Math.abs(t - now) < Math.abs(best - now)) best = t;
  }
  return best;
}

const MONTHS: Record<string, number> = {
  jan: 1, feb: 2, mar: 3, apr: 4, may: 5, jun: 6,
  jul: 7, aug: 8, sep: 9, oct: 10, nov: 11, dec: 12,
};

// Best-effort parse of the ETA strings the position providers hand back
// ("07-22 06:00", "Jul 22, 06:00", "22 Jul 06:00", ISO datetimes). All are
// treated as UTC per AIS convention. Returns epoch ms or null.
export function parseEtaText(raw: string | null | undefined): number | null {
  if (typeof raw !== 'string' || !raw) return null;
  const s = raw.trim();
  if (!s) return null;

  // Bare epoch (some providers send seconds or milliseconds since 1970).
  if (/^\d{10}$/.test(s) || /^\d{13}$/.test(s)) {
    const t = Number(s) * (s.length === 10 ? 1000 : 1);
    if (t > Date.UTC(2000, 0, 1) && t < Date.UTC(2100, 0, 1)) return t;
    return null;
  }

  // ISO-ish "2026-07-22 06:00" / "2026-07-22T06:00[:00Z]"
  let m = s.match(/^(\d{4})-(\d{2})-(\d{2})[T ](\d{2}):(\d{2})/);
  if (m) return Date.UTC(+m[1], +m[2] - 1, +m[3], +m[4], +m[5]);

  // VesselFinder-style "MM-DD HH:MM" (no year)
  m = s.match(/^(\d{1,2})-(\d{1,2})\s+(\d{1,2}):(\d{2})$/);
  if (m) return etaFromAisFields(+m[1], +m[2], +m[3], +m[4]);

  // "Jul 22, 06:00" / "Jul 22 06:00"
  m = s.match(/^([A-Za-z]{3,9})\.?\s+(\d{1,2}),?\s+(\d{1,2}):(\d{2})/);
  if (m) {
    const mo = MONTHS[m[1].slice(0, 3).toLowerCase()];
    if (mo) return etaFromAisFields(mo, +m[2], +m[3], +m[4]);
  }

  // "22 Jul, 06:00" / "22 Jul 06:00"
  m = s.match(/^(\d{1,2})\s+([A-Za-z]{3,9})\.?,?\s+(\d{1,2}):(\d{2})/);
  if (m) {
    const mo = MONTHS[m[2].slice(0, 3).toLowerCase()];
    if (mo) return etaFromAisFields(mo, +m[1], +m[3], +m[4]);
  }

  return null;
}

// The ETA triple travels as a unit so a parsed time is never paired with a
// raw string from a different report.
interface EtaFields {
  etaUtc: number | null;
  etaText: string | null;
  etaAt: number | null;
}
const NO_ETA: EtaFields = { etaUtc: null, etaText: null, etaAt: null };

// Carry a previously seen ETA forward only while it's plausibly still current:
// drop it once the parsed time is well past, or once no source has repeated it
// for a day (e.g. the ship arrived and the provider stopped sending one).
function carriedEta(existing: EtaFields | undefined, now: number): EtaFields {
  if (!existing || (existing.etaUtc === null && existing.etaText === null)) return NO_ETA;
  if (existing.etaUtc !== null && existing.etaUtc < now - 12 * 3600_000) return NO_ETA;
  if (existing.etaAt !== null && existing.etaAt < now - 24 * 3600_000) return NO_ETA;
  return { etaUtc: existing.etaUtc, etaText: existing.etaText, etaAt: existing.etaAt };
}

// Of two ETA observations, keep the more recently reported one (then expire).
function freshestEta(a: EtaFields | undefined, b: EtaFields | undefined, now: number): EtaFields {
  const aHas = a && (a.etaUtc !== null || a.etaText !== null);
  const bHas = b && (b.etaUtc !== null || b.etaText !== null);
  if (aHas && bHas) {
    return carriedEta((a.etaAt ?? 0) >= (b.etaAt ?? 0) ? a : b, now);
  }
  return carriedEta(aHas ? a : bHas ? b : undefined, now);
}

// First usable ETA-ish value among the given keys — skips null/empty-string
// sentinels (which pickField would return, masking a usable fallback key) and
// coerces numbers so a numeric epoch can't crash string parsing downstream.
function pickEtaText(o: Record<string, unknown>, ...keys: string[]): string | null {
  for (const k of keys) {
    const v = o[k];
    if (typeof v !== 'string' && typeof v !== 'number') continue;
    const s = String(v).trim();
    if (s) return s;
  }
  return null;
}

const vessels = new Map<string, VesselData>();
const staticCache = new Map<string, StaticInfo>();

// The allowlisted passenger vessels we actually display. This map keeps each
// ship's LAST KNOWN position indefinitely (never evicted, never capped) so a
// vessel that sails out of coastal AIS range stays on the map at its last
// reported spot until a fresh report updates it.
const tracked = new Map<string, VesselData>();
// MMSIs confirmed to belong to an allowlisted IMO. Pre-seeded from the known
// fleet so position reports are accepted and labelled immediately (no need to
// wait for a static-data message), and topped up by isAllowed() if static data
// ever reveals an allowlisted IMO under a new MMSI.
const allowedMmsis = new Set<string>();
for (const s of FLEET) {
  allowedMmsis.add(s.mmsi);
  staticCache.set(s.mmsi, {
    imo: s.imo,
    name: s.name,
    callsign: null,
    shipType: 60, // passenger ship; real static data refines this
    destination: null,
    etaUtc: null,
    etaText: null,
    etaAt: null,
  });
}

function isAllowed(mmsi: string, imo: number | null): boolean {
  if (allowedMmsis.has(mmsi)) return true;
  if (imo !== null && ALLOWED_IMOS.has(imo)) {
    allowedMmsis.add(mmsi);
    return true;
  }
  return false;
}

// Per-ship breadcrumb history (where each vessel has been), used to draw the
// "past path". Like the tracked map, this lives in memory for the process.
interface TrackPoint {
  lat: number;
  lon: number;
  t: number;
}
const history = new Map<string, TrackPoint[]>();
const MAX_TRACK_POINTS = 400;
const MAX_TRACK_AGE_MS = 72 * 60 * 60_000; // 72h
const MIN_TRACK_MOVE_M = 75; // ignore jitter while moored/anchored

function haversineM(aLat: number, aLon: number, bLat: number, bLon: number): number {
  const R = 6_371_000;
  const dLat = ((bLat - aLat) * Math.PI) / 180;
  const dLon = ((bLon - aLon) * Math.PI) / 180;
  const s =
    Math.sin(dLat / 2) ** 2 +
    Math.cos((aLat * Math.PI) / 180) * Math.cos((bLat * Math.PI) / 180) * Math.sin(dLon / 2) ** 2;
  return 2 * R * Math.asin(Math.sqrt(s));
}

function recordHistory(mmsi: string, lat: number, lon: number, t: number): void {
  let h = history.get(mmsi);
  if (!h) {
    h = [];
    history.set(mmsi, h);
  }
  const last = h[h.length - 1];
  if (last && haversineM(last.lat, last.lon, lat, lon) < MIN_TRACK_MOVE_M) return;
  h.push({ lat, lon, t });
  const cutoff = t - MAX_TRACK_AGE_MS;
  while (h.length > MAX_TRACK_POINTS || (h.length > 0 && h[0].t < cutoff)) h.shift();
}

// --- Fix acceptance ----------------------------------------------------------
// Every position, whatever its source, goes through applyFix(). Two rules stop
// a ship from "snapping back" to somewhere it used to be:
//
//  1. Ordering by FIX time, not receipt time. `updatedAt` is when the ship
//     actually reported (aisstream's MetaData.time_utc, a paid provider's
//     timestamp, CruiseMapper's "reported N minutes ago"), so a source that
//     re-serves an old fix — a scrape still showing last week's port call, a
//     delayed AIS message — is older than what we hold and is dropped.
//  2. A plausibility gate for fixes whose age is unknown or wrong. A cruise
//     ship cannot cover 1,500 nm in two hours, so a candidate implying more
//     than MAX_PLAUSIBLE_KT relative to the held fix is rejected and logged
//     (see /api/ships/debug → fixes.rejections). To stay self-healing when it
//     is the HELD fix that is wrong, a source that keeps reporting a
//     self-consistent track far away — HEAL_MIN_REPEATS reports spanning at
//     least HEAL_MIN_SPAN_MS — wins. A page re-serving the same coordinates
//     with no time attached never counts as new evidence.
//
// Fleet top speeds are ~15–19 kt; 35 kt leaves room for rounding in a
// source's stated age, GPS scatter and strong currents.
export const MAX_PLAUSIBLE_KT = 35;
// A fix time is never trusted to better than this when judging speed — it
// stops a 1-minute clock difference turning a 2 nm hop into "120 kt".
export const MIN_GATE_DT_MS = 15 * 60_000;
// ...and the other end: how much elapsed time a source that states NO fix
// time is allowed to claim. Such a source tells us where it thinks the ship
// is, never when it was there, so it must not inherit the age of the held fix.
// Without this cap the gate dissolves exactly when it matters most: a ship
// three days out of receiver range mid-Pacific makes an ageless coastal
// coordinate 2,000 nm away look like a routine 28 kt run, and the marker jumps
// back to port. Capped, an untimed source can advance the ship ~70 nm per
// report; anything larger has to earn it through the healing path below.
export const UNTIMED_MAX_DT_MS = 2 * 3_600_000;
export const HEAL_MIN_REPEATS = 3;
export const HEAL_MIN_SPAN_MS = 20 * 60_000;

export interface HeldFix {
  latitude: number;
  longitude: number;
  updatedAt: number;
}

export interface CandidateFix {
  latitude: number;
  longitude: number;
  source: FixSource;
  fixAt: number; // best estimate of when the ship reported this position
  fixAtKnown: boolean; // false: the source gave no time, fixAt is our receipt time
  fixPrecisionMs: number; // rounding of fixAt ("2 hours ago" is only good to 1 h)
}

// A far-away position we have refused so far, and how consistently the same
// source has kept reporting it.
export interface PendingOverride {
  source: FixSource;
  lat: number;
  lon: number;
  fixAt: number;
  firstAt: number;
  count: number;
}

export type FixDecision =
  | { accept: true; moved: boolean; healed: boolean; impliedKt: number | null; pending: null }
  | {
      accept: false;
      reason: 'older' | 'duplicate' | 'implausible';
      moved: boolean;
      distanceNm: number;
      impliedKt: number | null;
      pending: PendingOverride | null;
    };

function impliedKnots(distM: number, dtMs: number): number {
  return distM / 1852 / (Math.max(dtMs, MIN_GATE_DT_MS) / 3_600_000);
}

// Pure decision for one candidate against the held fix. `pending` is the
// override state from the previous rejection (if any); the returned `pending`
// is the state to keep for the next call (null clears it).
export function evaluateCandidate(
  prev: HeldFix | undefined,
  cand: CandidateFix,
  pending: PendingOverride | undefined,
  now: number
): FixDecision {
  if (!prev) return { accept: true, moved: true, healed: false, impliedKt: null, pending: null };

  const distM = haversineM(prev.latitude, prev.longitude, cand.latitude, cand.longitude);
  const moved = distM >= MIN_TRACK_MOVE_M;
  const distanceNm = distM / 1852;
  const keep = pending ?? null;

  // Rule 1: an older (or re-served) fix never replaces a newer one. A report
  // from the same spot only counts as newer once it clears the source's own
  // time rounding, so "2 hours ago" re-read two hours after "38 minutes ago"
  // is recognised as the same fix.
  if (cand.fixAt <= prev.updatedAt + (moved ? 0 : cand.fixPrecisionMs)) {
    return {
      accept: false,
      reason: moved ? 'older' : 'duplicate',
      moved,
      distanceNm,
      impliedKt: null,
      pending: keep,
    };
  }

  if (!moved) {
    // Same spot, genuinely newer report: refresh the fix time (a moored ship
    // reporting every few minutes). With no source-stated time there is
    // nothing new to learn.
    if (!cand.fixAtKnown) {
      return { accept: false, reason: 'duplicate', moved, distanceNm, impliedKt: 0, pending: keep };
    }
    return { accept: true, moved: false, healed: false, impliedKt: 0, pending: null };
  }

  // Rule 2: plausibility against the held fix. A source that states when the
  // ship reported is judged over the true interval, so a genuine ocean
  // crossing after a silent week is accepted. A source that states no time is
  // judged over a capped interval (see UNTIMED_MAX_DT_MS), so it cannot ride
  // in on how long the held fix has been sitting there.
  const elapsed = cand.fixAt - prev.updatedAt;
  const impliedKt = impliedKnots(
    distM,
    cand.fixAtKnown ? elapsed : Math.min(elapsed, UNTIMED_MAX_DT_MS)
  );
  if (impliedKt <= MAX_PLAUSIBLE_KT) {
    return { accept: true, moved: true, healed: false, impliedKt, pending: null };
  }

  // Implausible. Count self-consistent repeats from the same source. Evidence
  // only accumulates when the candidate has actually moved since the last
  // refused one or carries a newer source-stated time — a stuck page serving
  // the same coordinates with no time attached is not new evidence.
  let next: PendingOverride;
  if (pending && pending.source === cand.source) {
    const sincePendingM = haversineM(pending.lat, pending.lon, cand.latitude, cand.longitude);
    const consistent =
      impliedKnots(sincePendingM, cand.fixAt - pending.fixAt) <= MAX_PLAUSIBLE_KT;
    if (consistent) {
      const newEvidence =
        sincePendingM >= MIN_TRACK_MOVE_M ||
        (cand.fixAtKnown && cand.fixAt > pending.fixAt + cand.fixPrecisionMs);
      next = {
        ...pending,
        lat: cand.latitude,
        lon: cand.longitude,
        fixAt: Math.max(pending.fixAt, cand.fixAt),
        count: pending.count + (newEvidence ? 1 : 0),
      };
    } else {
      next = { source: cand.source, lat: cand.latitude, lon: cand.longitude, fixAt: cand.fixAt, firstAt: now, count: 1 };
    }
  } else {
    next = { source: cand.source, lat: cand.latitude, lon: cand.longitude, fixAt: cand.fixAt, firstAt: now, count: 1 };
  }
  if (next.count >= HEAL_MIN_REPEATS && now - next.firstAt >= HEAL_MIN_SPAN_MS) {
    return { accept: true, moved: true, healed: true, impliedKt, pending: null };
  }
  return { accept: false, reason: 'implausible', moved, distanceNm, impliedKt, pending: next };
}

// What applyFix refused and why — the trail an operator needs when a ship
// "jumps": which feed served the bad fix, how far it was from the held one,
// and the speed that would have implied.
interface Rejection {
  at: number;
  mmsi: string;
  name: string | null;
  source: FixSource;
  reason: 'older' | 'implausible';
  lat: number;
  lon: number;
  fixAt: number;
  fixAtKnown: boolean;
  distanceNm: number;
  impliedKt: number | null;
  held: { lat: number; lon: number; fixAt: number; source: FixSource };
}
const REJECTION_LOG_MAX = 40;
const rejections: Rejection[] = [];
const lastRejection = new Map<string, Rejection>();
const pendingOverrides = new Map<string, PendingOverride>();
const acceptedBySource: Record<FixSource, number> = {
  aisstream: 0,
  cruisemapper: 0,
  vesselfinder: 0,
  myshiptracking: 0,
  marinetraffic: 0,
  snapshot: 0,
};
let healedCount = 0;

// The single write path for positions. `record.updatedAt` must already be the
// fix time. Returns whether the fix was accepted into `tracked`.
function applyFix(record: VesselData, fixAtKnown: boolean, fixPrecisionMs: number): boolean {
  const now = Date.now();
  const { mmsi } = record;
  const prev = tracked.get(mmsi);
  const decision = evaluateCandidate(
    prev,
    {
      latitude: record.latitude,
      longitude: record.longitude,
      source: record.source,
      fixAt: record.updatedAt,
      fixAtKnown,
      fixPrecisionMs,
    },
    pendingOverrides.get(mmsi),
    now
  );

  if (!decision.accept) {
    if (decision.pending) pendingOverrides.set(mmsi, decision.pending);
    else pendingOverrides.delete(mmsi);
    if (prev && decision.reason !== 'duplicate') {
      const rej: Rejection = {
        at: now,
        mmsi,
        name: record.name,
        source: record.source,
        reason: decision.reason,
        lat: record.latitude,
        lon: record.longitude,
        fixAt: record.updatedAt,
        fixAtKnown,
        distanceNm: Math.round(decision.distanceNm * 10) / 10,
        impliedKt: decision.impliedKt === null ? null : Math.round(decision.impliedKt),
        held: { lat: prev.latitude, lon: prev.longitude, fixAt: prev.updatedAt, source: prev.source },
      };
      rejections.push(rej);
      if (rejections.length > REJECTION_LOG_MAX) rejections.shift();
      lastRejection.set(mmsi, rej);
      if (decision.reason === 'implausible') {
        console.warn(
          `[ships] refused ${record.source} fix for ${record.name ?? mmsi}: ` +
            `${record.latitude.toFixed(3)},${record.longitude.toFixed(3)} is ${rej.distanceNm} nm ` +
            `from the held ${prev.source} fix (~${rej.impliedKt} kt implied)`
        );
      }
    }
    return false;
  }

  pendingOverrides.delete(mmsi);
  allowedMmsis.add(mmsi);
  tracked.set(mmsi, record);
  // Keep the firehose shadow copy in step so the next live position report
  // merges against this data instead of an older snapshot of the ship.
  if (vessels.has(mmsi)) vessels.set(mmsi, record);
  if (decision.moved) recordHistory(mmsi, record.latitude, record.longitude, record.updatedAt);
  acceptedBySource[record.source]++;
  if (decision.healed) {
    healedCount++;
    console.warn(
      `[ships] ${record.source} kept reporting ${record.name ?? mmsi} ~${Math.round(
        (decision.impliedKt ?? 0)
      )} kt away from the held fix; accepting its track as the new truth`
    );
  }
  markSnapshotDirty();
  return true;
}

// --- Fix-time parsing --------------------------------------------------------
// aisstream MetaData.time_utc: "2022-12-29 18:22:32.318353 +0000 UTC". Returns
// epoch ms, or null when absent/unparseable/absurd so the caller falls back to
// receipt time (and marks the fix time as unknown).
export function parseAisTimeUtc(raw: unknown, now: number): number | null {
  if (typeof raw !== 'string') return null;
  const m = raw
    .trim()
    .match(
      /^(\d{4})-(\d{2})-(\d{2})[ T](\d{2}):(\d{2}):(\d{2})(?:\.(\d{1,9}))?\s*(?:Z|(?:([+-])(\d{2}):?(\d{2})))?/
    );
  if (!m) return null;
  const ms = m[7] ? Math.round(Number(`0.${m[7]}`) * 1000) : 0;
  let t = Date.UTC(+m[1], +m[2] - 1, +m[3], +m[4], +m[5], +m[6], ms);
  if (m[8]) {
    const off = (+m[9] * 60 + +m[10]) * 60_000;
    t += m[8] === '+' ? -off : off;
  }
  if (!Number.isFinite(t)) return null;
  // A few minutes ahead is clock skew; further ahead, or older than the stream
  // could plausibly replay, is garbage.
  if (t > now + 5 * 60_000 || t < now - 30 * 24 * 3600_000) return null;
  return t;
}

export interface ReportedAge {
  ageMs: number;
  precisionMs: number;
  text: string;
}

const AGE_UNIT_MS: Record<string, number> = {
  sec: 1_000,
  min: 60_000,
  hour: 3_600_000,
  hr: 3_600_000,
  day: 86_400_000,
  week: 7 * 86_400_000,
};

// CruiseMapper states how old the fix is in prose next to the position:
// "The AIS position was reported 38 minutes ago" / "received 2 hours ago" /
// "an hour ago" / "just now". Only text near those keywords is trusted — the
// page also carries unrelated "N days ago" strings (reviews, news).
export function parseReportedAgo(html: string): ReportedAge | null {
  const m = html.match(
    /\b(?:reported|received|updated|last\s+(?:seen|report(?:ed)?|update[d]?))\b[^<.]{0,60}?\b(just\s+now|moments\s+ago|(\d{1,3}|an?|one)\s+(sec(?:ond)?|min(?:ute)?|h(?:ou)?r|day|week)s?\s+ago)\b/i
  );
  if (!m) return null;
  const text = m[1];
  if (/^(just\s+now|moments\s+ago)$/i.test(text)) return { ageMs: 0, precisionMs: 60_000, text };
  const n = /^\d/.test(m[2]) ? Number(m[2]) : 1;
  const unitKey = m[3].toLowerCase().replace(/^hou?r$/, 'hour').replace(/^second$/, 'sec').replace(/^minute$/, 'min');
  const unitMs = AGE_UNIT_MS[unitKey];
  if (!unitMs || !Number.isFinite(n)) return null;
  return { ageMs: n * unitMs, precisionMs: unitMs, text };
}

// --- Last-known persistence --------------------------------------------------
// The tracked map and trails are written to the Postgres `snapshots` table
// (same key/value pattern as the flights tracker and the wind grid), plus a
// local JSON file as the dev fallback when DATABASE_URL is unset. The file
// alone was the original mechanism, but Heroku wipes the dyno filesystem on
// every restart and deploy, so the process used to boot with no memory of the
// fleet: whatever the first scrape served became the truth, even a stale fix,
// and the trail started from scratch. Persisting accepted fixes also gives
// applyFix() something to compare a post-restart fix against, so the ordering
// and plausibility rules keep working across restarts.
const SNAPSHOT_PATH =
  process.env.SHIPS_SNAPSHOT_PATH ??
  path.join(__dirname, '../../ships-snapshot.json');
const SNAPSHOT_KEY = 'ships:v1';
const DB_ENABLED = Boolean(process.env.DATABASE_URL);
const SAVE_MIN_INTERVAL_MS = 30_000;
// Positions older than this at restore time are dropped — a week-old fix is
// more misleading than an empty map until the next poll.
const SNAPSHOT_MAX_AGE_MS = 7 * 24 * 60 * 60_000;

interface Snapshot {
  tracked: VesselData[];
  history: { mmsi: string; pts: TrackPoint[] }[];
  savedAt: number;
}

// Restore/save bookkeeping, surfaced in /api/ships/debug so a restart's
// recovery (or a failing database) is visible.
let snapshotLoadedCount = 0;
let snapshotLoadedAgeMin: number | null = null;
let snapshotLoadedFrom: string | null = null;
let lastSnapshotSaveAt = 0;
let lastSnapshotSaveError: string | null = null;
let snapshotDirty = false;
let saveTimer: ReturnType<typeof setTimeout> | null = null;

// Coalesce the bursty aisstream updates into one write per 30 s.
function markSnapshotDirty(): void {
  snapshotDirty = true;
  if (saveTimer) return;
  saveTimer = setTimeout(() => {
    saveTimer = null;
    void saveSnapshot();
  }, SAVE_MIN_INTERVAL_MS);
  saveTimer.unref?.();
}

async function saveSnapshot(): Promise<void> {
  if (!snapshotDirty) return;
  snapshotDirty = false;
  const snap: Snapshot = {
    tracked: [...tracked.values()],
    history: [...history.entries()].map(([mmsi, pts]) => ({ mmsi, pts })),
    savedAt: Date.now(),
  };
  const json = JSON.stringify(snap);
  try {
    fs.writeFileSync(SNAPSHOT_PATH, json);
  } catch {
    // Read-only or ephemeral filesystem — Postgres is the real store.
  }
  if (!DB_ENABLED) {
    lastSnapshotSaveAt = snap.savedAt;
    return;
  }
  try {
    await pool.query(
      `INSERT INTO snapshots (key, data) VALUES ($1, $2)
       ON CONFLICT (key) DO UPDATE SET data = EXCLUDED.data, updated_at = NOW()`,
      [SNAPSHOT_KEY, json]
    );
    lastSnapshotSaveAt = snap.savedAt;
    lastSnapshotSaveError = null;
  } catch (err) {
    lastSnapshotSaveError = err instanceof Error ? err.message : String(err);
    console.warn('[ships] snapshot save failed:', lastSnapshotSaveError);
    // Re-arm so a transient failure is retried rather than silently losing the
    // last fix before a quiet spell.
    markSnapshotDirty();
  }
}

// Merge a persisted snapshot into the live maps. Never overwrites a position a
// faster live poll already refreshed; persisted trail points are prepended to
// whatever the live polls recorded meanwhile.
function restoreSnapshot(snap: Snapshot | null | undefined, from: string): number {
  if (!snap || !Array.isArray(snap.tracked)) return 0;
  const now = Date.now();
  const ageMs = now - (snap.savedAt ?? 0);
  if (ageMs > SNAPSHOT_MAX_AGE_MS) return 0;
  let restored = 0;
  for (const v of snap.tracked) {
    if (
      !v?.mmsi ||
      !FLEET_MMSIS.includes(v.mmsi) ||
      typeof v.latitude !== 'number' ||
      typeof v.longitude !== 'number' ||
      typeof v.updatedAt !== 'number'
    ) {
      continue;
    }
    const existing = tracked.get(v.mmsi);
    if (existing && existing.updatedAt >= v.updatedAt) continue;
    // Snapshots written before the ETA / source fields existed lack them.
    tracked.set(v.mmsi, {
      ...v,
      etaUtc: v.etaUtc ?? null,
      etaText: v.etaText ?? null,
      etaAt: v.etaAt ?? null,
      receivedAt: typeof v.receivedAt === 'number' ? v.receivedAt : v.updatedAt,
      source: v.source ?? 'snapshot',
      reception: v.reception ?? null,
    });
    allowedMmsis.add(v.mmsi);
    restored++;
  }
  const cutoff = now - MAX_TRACK_AGE_MS;
  for (const { mmsi, pts } of snap.history ?? []) {
    if (!FLEET_MMSIS.includes(mmsi) || !Array.isArray(pts)) continue;
    const kept = pts.filter(
      (p) =>
        typeof p?.lat === 'number' && typeof p?.lon === 'number' && typeof p?.t === 'number' && p.t >= cutoff
    );
    if (kept.length === 0) continue;
    const live = history.get(mmsi) ?? [];
    const oldestLive = live[0]?.t ?? Infinity;
    const merged = [...kept.filter((p) => p.t < oldestLive), ...live];
    history.set(mmsi, merged.slice(-MAX_TRACK_POINTS));
  }
  if (restored > 0) {
    snapshotLoadedCount += restored;
    snapshotLoadedAgeMin = Math.round(ageMs / 60_000);
    snapshotLoadedFrom = from;
    console.log(`[ships] restored ${restored} ships from ${from} snapshot (${snapshotLoadedAgeMin} min old)`);
  }
  return restored;
}

// File first (instant, covers local dev), then Postgres. The database read
// retries briefly because the boot-time migration may still be creating the
// table; live polls that land meanwhile are merged, not clobbered.
async function loadSnapshot(): Promise<void> {
  try {
    restoreSnapshot(JSON.parse(fs.readFileSync(SNAPSHOT_PATH, 'utf8')) as Snapshot, 'file');
  } catch {
    // No file yet — normal on a fresh dyno.
  }
  if (!DB_ENABLED) return;
  const attempts = 5;
  for (let attempt = 1; attempt <= attempts; attempt++) {
    try {
      const { rows } = await pool.query<{ data: Snapshot }>(
        'SELECT data FROM snapshots WHERE key = $1',
        [SNAPSHOT_KEY]
      );
      restoreSnapshot(rows[0]?.data, 'postgres');
      return;
    } catch (err) {
      if (attempt === attempts) {
        console.warn('[ships] snapshot load failed:', err instanceof Error ? err.message : err);
        return;
      }
      await new Promise((res) => setTimeout(res, 2_000 * attempt));
    }
  }
}

// Prevent unbounded memory growth from the global AIS stream.
const VESSEL_CAP = 50_000;

let ws: WebSocket | null = null;
let reconnectTimer: ReturnType<typeof setTimeout> | null = null;

// --- Diagnostics (surfaced via GET /api/ships/debug) -----------------------
// Enough signal to tell apart the failure modes: no key, can't connect/auth,
// connected-but-silent, live-but-out-of-range, or actually working.
let connectAttempts = 0;
let lastConnectAt = 0;
let lastError: string | null = null;
let totalMessages = 0;
let positionReports = 0;
let staticReports = 0;
let lastMessageAt = 0;

function evictStale() {
  const cutoff = Date.now() - 15 * 60_000;
  for (const [mmsi, v] of vessels) {
    if (v.updatedAt < cutoff) vessels.delete(mmsi);
  }
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
function handleMessage(raw: string) {
  let msg: any;
  try {
    msg = JSON.parse(raw);
  } catch {
    return;
  }

  const type = msg?.MessageType as string | undefined;
  const meta = msg?.MetaData ?? {};
  const mmsi = String(meta.MMSI ?? '');
  if (!mmsi || !type) return;

  const now = Date.now();

  if (type === 'PositionReport') {
    positionReports++;
    const pr = msg.Message?.PositionReport ?? {};
    const lat = typeof pr.Latitude === 'number' ? pr.Latitude : null;
    const lon = typeof pr.Longitude === 'number' ? pr.Longitude : null;
    if (lat === null || lon === null || lat < -90 || lat > 90 || lon < -180 || lon > 180) return;

    // Always accept reports for confirmed allowlisted ships; only apply the
    // memory cap to the anonymous firehose.
    const known = allowedMmsis.has(mmsi);
    if (!known && vessels.size >= VESSEL_CAP && !vessels.has(mmsi)) return;

    // For a tracked ship the permanent map is the truth (every accepted fix,
    // whatever its source, lands there); the firehose shadow only serves ships
    // we don't track.
    const existing = tracked.get(mmsi) ?? vessels.get(mmsi);
    const sd = staticCache.get(mmsi);
    const eta = freshestEta(sd, existing, now);

    // The stream stamps each message with when it was received upstream;
    // that, not our receipt time, orders the fix against other sources.
    const parsedAt = parseAisTimeUtc(meta.time_utc, now);
    const fixAt = parsedAt ?? now;

    const record: VesselData = {
      mmsi,
      imo: sd?.imo ?? existing?.imo ?? null,
      name: sd?.name || (meta.ShipName as string | undefined)?.trim() || existing?.name || null,
      callsign: sd?.callsign ?? existing?.callsign ?? null,
      shipType: sd?.shipType ?? existing?.shipType ?? null,
      latitude: lat,
      longitude: lon,
      // AIS encodes "speed not available" as 102.3 kt; passing it through
      // would draw a 600 nm dead-reckoning line on the map.
      speedKt: typeof pr.Sog === 'number' && pr.Sog < 102.2 ? pr.Sog : existing?.speedKt ?? null,
      heading:
        typeof pr.TrueHeading === 'number' && pr.TrueHeading !== 511
          ? pr.TrueHeading
          : existing?.heading ?? null,
      course:
        typeof pr.Cog === 'number' && pr.Cog < 360
          ? pr.Cog
          : existing?.course ?? null,
      navStatus:
        typeof pr.NavigationalStatus === 'number'
          ? pr.NavigationalStatus
          : existing?.navStatus ?? null,
      destination: sd?.destination ?? existing?.destination ?? null,
      ...eta,
      updatedAt: fixAt,
      receivedAt: now,
      source: 'aisstream',
      // aisstream is a community network of shore-based receivers, so every
      // position it carries was heard from land by definition.
      reception: 'terrestrial',
    };

    if (isAllowed(mmsi, record.imo)) {
      // Two receivers relaying the same transmission differ by milliseconds;
      // treat anything inside 2 s at the same spot as the same report.
      applyFix(record, parsedAt !== null, 2_000);
    } else {
      vessels.set(mmsi, record);
    }
  } else if (type === 'ShipStaticData') {
    staticReports++;
    const sd = msg.Message?.ShipStaticData ?? {};
    const imo = typeof sd.ImoNumber === 'number' && sd.ImoNumber > 0 ? sd.ImoNumber : null;
    const eta = sd.Eta ?? {};
    const etaUtc = etaFromAisFields(eta.Month, eta.Day, eta.Hour, eta.Minute);
    const info: StaticInfo = {
      imo,
      name: (sd.Name as string | undefined)?.trim() || null,
      callsign: (sd.CallSign as string | undefined)?.trim() || null,
      shipType: typeof sd.Type === 'number' ? sd.Type : null,
      destination: (sd.Destination as string | undefined)?.trim() || null,
      etaUtc,
      etaText: null,
      etaAt: etaUtc !== null ? now : null,
    };
    // In firehose mode the global stream carries static data for every MMSI
    // worldwide — apply the same cap logic as `vessels` so this map can't grow
    // without bound (allowlisted ships always get through).
    if (staticCache.size < VESSEL_CAP || staticCache.has(mmsi) || allowedMmsis.has(mmsi)) {
      staticCache.set(mmsi, info);
    }

    // Enrich an existing position entry immediately if we have one.
    const existing = tracked.get(mmsi) ?? vessels.get(mmsi);
    if (existing) {
      const enriched: VesselData = {
        ...existing,
        imo: info.imo ?? existing.imo,
        name: info.name || existing.name,
        callsign: info.callsign || existing.callsign,
        shipType: info.shipType ?? existing.shipType,
        destination: info.destination || existing.destination,
        ...freshestEta(info, existing, now),
      };
      if (tracked.has(mmsi)) {
        // Identity/voyage fields only — the position and its fix time are
        // untouched, so this bypasses the acceptance rules by design.
        tracked.set(mmsi, enriched);
        markSnapshotDirty();
      } else if (isAllowed(mmsi, enriched.imo)) {
        // Static data just revealed an allowlisted IMO under a new MMSI:
        // promote its last live position into the permanent tracked map.
        applyFix(enriched, true, 2_000);
      }
      if (vessels.has(mmsi)) vessels.set(mmsi, enriched);
    }
  }
}

// Reconnect with exponential backoff + jitter so a revoked key or upstream
// outage doesn't open a fresh TLS connection every 5s forever. Failures are
// counted until the first *message* arrives — auth rejections close after
// 'open', so 'open' alone can't prove the subscription is healthy.
let consecutiveFailures = 0;
function reconnectDelayMs(): number {
  const base = Math.min(300_000, 5_000 * 2 ** Math.min(consecutiveFailures, 6));
  return base + Math.floor(Math.random() * 2_000);
}

function connectAIS() {
  if (reconnectTimer) {
    clearTimeout(reconnectTimer);
    reconnectTimer = null;
  }

  try {
    connectAttempts++;
    consecutiveFailures++;
    lastConnectAt = Date.now();
    ws = new WebSocket('wss://stream.aisstream.io/v0/stream');

    ws.on('open', () => {
      // Whole-world box is mandatory. By default we narrow to the fleet MMSIs
      // (lightweight, live supplement); AIS_MMSI_FILTER=0 takes the firehose.
      const sub: Record<string, unknown> = {
        APIKey: config.aisstreamApiKey,
        BoundingBoxes: [[[-90, -180], [90, 180]]],
        FilterMessageTypes: ['PositionReport', 'ShipStaticData'],
      };
      if (USE_MMSI_FILTER) sub.FiltersShipMMSI = FLEET_MMSIS;
      ws?.send(JSON.stringify(sub));
      console.log(`AIS stream connected (${USE_MMSI_FILTER ? 'MMSI filter' : 'firehose'})`);
    });

    ws.on('message', (data: WebSocket.RawData) => {
      totalMessages++;
      lastMessageAt = Date.now();
      consecutiveFailures = 0;
      handleMessage(data.toString());
    });

    ws.on('close', () => {
      ws = null;
      reconnectTimer = setTimeout(connectAIS, reconnectDelayMs());
    });

    ws.on('error', (err) => {
      lastError = err.message;
      console.error('AIS WebSocket error:', err.message);
      ws?.terminate();
    });
  } catch (err) {
    lastError = String(err);
    reconnectTimer = setTimeout(connectAIS, reconnectDelayMs());
    console.error('AIS connect failed:', err);
  }
}

// --- Paid by-IMO position polling ------------------------------------------
// Free aisstream can't always see the fleet. When a paid provider key is set we
// poll the fleet's positions by IMO and write them into the same `tracked` map
// the client renders as pins — so the ships reliably show up regardless of
// community-receiver coverage. Free aisstream stays on as a live supplement;
// whichever source reported most recently wins in the response dedupe.
// Poll cadence — tunable via SHIPS_POLL_MINUTES; defaults cheap since cruise
// ships move slowly and last-known is fine. On VesselFinder (1 credit/ship/poll)
// the fleet runs ~ ships × polls/month credits: 120 min ≈ 2,500 credits/month
// for 7 ships (~€85 on the €330/10k pack); raise the interval to spend less.
const PAID_POLL_MS = Math.max(15, Number(process.env.SHIPS_POLL_MINUTES) || 120) * 60_000;

interface PaidPosition {
  imo: number | null;
  mmsi: string | null;
  lat: number | null;
  lon: number | null;
  speedKt: number | null;
  courseDeg: number | null;
  headingDeg: number | null;
  navStatus: number | null;
  destination: string | null;
  etaText: string | null; // provider ETA string, parsed downstream
  name: string | null;
  t: number; // fix time (ms) — receipt time when the provider gave none
  fixAtKnown: boolean; // whether `t` came from the provider
  fixPrecisionMs: number; // rounding of `t` (0 for exact timestamps)
  reception: Reception; // how the transmission reached the provider, if stated
}

let paidProvider: FixSource | null = null;
let paidLastOk = 0;
let paidLastError: string | null = null;
let paidLastCount = 0; // fixes accepted on the last poll
let paidLastOffered = 0; // positions the provider returned on the last poll

function pnum(v: unknown): number | null {
  if (typeof v === 'number' && Number.isFinite(v)) return v;
  if (typeof v === 'string' && v.trim() !== '') {
    const n = Number(v);
    if (Number.isFinite(n)) return n;
  }
  return null;
}

function pickField<T = unknown>(o: Record<string, unknown>, ...keys: string[]): T | undefined {
  for (const k of keys) if (o[k] != null) return o[k] as T;
  return undefined;
}

async function fetchJson(url: string, headers?: Record<string, string>): Promise<unknown> {
  const r = await fetch(url, {
    signal: AbortSignal.timeout(12_000),
    headers: { 'User-Agent': 'gsoc-monitor/1.0', Accept: 'application/json', ...(headers ?? {}) },
  });
  if (!r.ok) throw new Error(`HTTP ${r.status}`);
  return r.json();
}

// VesselFinder Vessels API — one request returns all fleet IMOs; each row has an
// AIS object with the position/voyage fields (confirmed schema).
async function fetchVesselFinder(key: string): Promise<PaidPosition[]> {
  const imos = FLEET.map((s) => s.imo).join(',');
  const data = await fetchJson(
    `https://api.vesselfinder.com/vessels?userkey=${encodeURIComponent(key)}&imo=${imos}`
  );
  const rows = Array.isArray(data) ? data : [];
  return rows.map((row) => {
    const r = row as Record<string, unknown>;
    const ais = (r.AIS ?? r.ais ?? r) as Record<string, unknown>;
    const ts = pickField<string>(ais, 'TIMESTAMP', 'timestamp');
    const t = ts ? Date.parse(ts) : NaN;
    return {
      imo: pnum(pickField(ais, 'IMO', 'imo')),
      mmsi: ((): string | null => {
        const m = pickField(ais, 'MMSI', 'mmsi');
        return m != null ? String(m) : null;
      })(),
      lat: pnum(pickField(ais, 'LATITUDE', 'latitude', 'lat')),
      lon: pnum(pickField(ais, 'LONGITUDE', 'longitude', 'lon', 'lng')),
      speedKt: pnum(pickField(ais, 'SPEED', 'speed')),
      courseDeg: pnum(pickField(ais, 'COURSE', 'course')),
      headingDeg: pnum(pickField(ais, 'HEADING', 'heading')),
      navStatus: pnum(pickField(ais, 'NAVSTAT', 'navstat')),
      destination: (pickField<string>(ais, 'DESTINATION', 'destination') ?? null) || null,
      etaText: pickEtaText(ais, 'ETA_PREDICTED', 'ETA', 'eta'),
      name: (pickField<string>(ais, 'NAME', 'name') ?? null) || null,
      t: Number.isNaN(t) ? Date.now() : t,
      fixAtKnown: !Number.isNaN(t),
      fixPrecisionMs: 0,
      reception: null,
    };
  });
}

// --- MarineTraffic (Kpler) AIS API ------------------------------------------
// The one source here that carries ROAMING AIS as well as satellite, which is
// what lets it hold a position for a ship in mid-ocean when the terrestrial
// feeds and the CruiseMapper scrape have nothing newer than her last port. No
// amount of parsing gets a position out of a source that never received one,
// so when the fleet is at sea this is the feed that has the answer.
//
// PS07 (single vessel positions): one request per MMSI, which needs no fleet
// set up in the MarineTraffic account.
const MT_DSRC: Record<string, Reception> = {
  TER: 'terrestrial',
  SAT: 'satellite',
  ROAM: 'roaming',
};

// MarineTraffic's SPEED scaling is documented inconsistently across protocol
// versions and endpoints: raw knots in some responses, knots x10 in others,
// and the XML protocol divides by 100. Reading it wrong by a factor of ten
// would drive the dead-reckoning projection, so take the first interpretation
// that lands in a real vessel's range rather than trusting one convention.
export function normalizeMtSpeed(raw: number | null): number | null {
  if (raw === null || !Number.isFinite(raw) || raw < 0) return null;
  for (const divisor of [1, 10, 100]) {
    const kt = raw / divisor;
    if (kt <= 40) return kt;
  }
  return null;
}

// One MarineTraffic position row -> our shape. Exported for tests: the live
// API needs a paid key, so the field mapping is verified against fixtures.
export function mtRow(v: Record<string, unknown>, ship: FleetShip, now: number): PaidPosition {
  const ts = pickField<string | number>(v, 'TIMESTAMP', 'timestamp');
  const t = typeof ts === 'number' ? ts * (ts < 1e12 ? 1000 : 1) : ts ? Date.parse(String(ts)) : NaN;
  const dsrc = String(pickField<string>(v, 'DSRC', 'dsrc') ?? '').trim().toUpperCase();
  const heading = pnum(pickField(v, 'HEADING', 'heading'));
  const course = pnum(pickField(v, 'COURSE', 'course'));
  return {
    imo: ship.imo,
    mmsi: ship.mmsi,
    lat: pnum(pickField(v, 'LAT', 'lat', 'LATITUDE', 'latitude')),
    lon: pnum(pickField(v, 'LON', 'lon', 'LONGITUDE', 'longitude')),
    speedKt: normalizeMtSpeed(pnum(pickField(v, 'SPEED', 'speed'))),
    courseDeg: course,
    headingDeg: heading,
    navStatus: pnum(pickField(v, 'STATUS', 'status')),
    destination: (pickField<string>(v, 'DESTINATION', 'destination') ?? null) || null,
    etaText: pickEtaText(v, 'ETA', 'eta'),
    name: ship.name,
    t: Number.isNaN(t) ? now : t,
    fixAtKnown: !Number.isNaN(t),
    fixPrecisionMs: 0,
    reception: MT_DSRC[dsrc] ?? null,
  };
}

async function fetchMarineTraffic(key: string): Promise<PaidPosition[]> {
  const out: PaidPosition[] = [];
  const span = config.marinetrafficTimespanMin;
  for (const ship of FLEET) {
    const now = Date.now();
    try {
      const data = await fetchJson(
        `https://services.marinetraffic.com/api/exportvessel/v:5/${encodeURIComponent(key)}` +
          `/timespan:${span}/protocol:jsono/mmsi:${ship.mmsi}`
      );
      // jsono answers with an array of objects; an empty array simply means
      // the vessel was not heard inside the timespan.
      const rows = Array.isArray(data) ? (data as Record<string, unknown>[]) : [];
      let best: PaidPosition | null = null;
      for (const row of rows) {
        const r = mtRow(row, ship, now);
        if (r.lat == null || r.lon == null) continue;
        if (!best || r.t > best.t) best = r;
      }
      if (best) out.push(best);
    } catch (err) {
      // One vessel's failure must not cost the rest of the fleet its poll.
      console.warn(`[ships] marinetraffic ${ship.name} failed:`, err instanceof Error ? err.message : err);
    }
    await sleep(400);
  }
  return out;
}

// --- CruiseMapper free scrape ----------------------------------------------
// CruiseMapper's public ship page (reachable by IMO at /?imo=NNN) renders the
// vessel's last AIS fix into the HTML, and crucially it carries satellite-AIS
// coverage — it sees the fleet at sea where free aisstream cannot. The catch is
// Cloudflare bot protection: a plain fetch may be served a 403 challenge instead
// of the page. We send a full, consistent set of browser headers to pass the
// lighter checks; if we're still blocked, lastScrapeNote records the status so
// /api/ships/debug shows exactly what happened on the live server.
let lastScrapeNote: string | null = null;

const BROWSER_HEADERS: Record<string, string> = {
  'User-Agent':
    'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36',
  Accept: 'text/html,application/xhtml+xml,application/xml;q=0.9,image/avif,image/webp,*/*;q=0.8',
  'Accept-Language': 'en-US,en;q=0.9',
  'sec-ch-ua': '"Chromium";v="124", "Google Chrome";v="124", "Not-A.Brand";v="99"',
  'sec-ch-ua-mobile': '?0',
  'sec-ch-ua-platform': '"Windows"',
  'Sec-Fetch-Dest': 'document',
  'Sec-Fetch-Mode': 'navigate',
  'Sec-Fetch-Site': 'none',
  'Upgrade-Insecure-Requests': '1',
};

async function fetchText(url: string, headers?: Record<string, string>): Promise<string> {
  const r = await fetch(url, {
    signal: AbortSignal.timeout(15_000),
    redirect: 'follow',
    headers: { ...BROWSER_HEADERS, ...(headers ?? {}) },
  });
  if (!r.ok) throw new Error(`HTTP ${r.status}`);
  return r.text();
}

const sleep = (ms: number) => new Promise((res) => setTimeout(res, ms));

// What the last scrape of each ship's page produced — kept for
// /api/ships/debug so a bad coordinate can be traced to the parse strategy
// and page text that yielded it.
interface ScrapeResult {
  imo: number;
  name: string;
  at: number;
  ok: boolean;
  strategy: string | null; // parse strategy that yielded the coordinates
  lat: number | null;
  lon: number | null;
  ageText: string | null; // the page's own "reported N minutes ago"
  fixAgeMin: number | null;
  note: string | null; // why the page was not used, or a caveat
  excerpt: string | null; // the page text around the coordinates that were used
}
const scrapeResults = new Map<number, ScrapeResult>();

export interface ParsedShipPage {
  pos: PaidPosition | null;
  strategy: string | null;
  ageText: string | null;
  note: string | null;
  excerpt: string | null;
}

// Collapse tags and whitespace so a page excerpt reads as text in the debug
// output.
function textExcerpt(html: string, at: number, radius = 220): string {
  return html
    .slice(Math.max(0, at - radius), at + radius)
    .replace(/<[^>]*>/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

// Pull a last-known position out of one CruiseMapper ship page. The page
// format isn't contractual, so several strategies are tried, most specific
// first. Never throws: a page with no usable position yields pos: null (with a
// note) so one ship's miss doesn't abort the batch.
export function parseCruiseMapper(html: string, ship: FleetShip, now = Date.now()): ParsedShipPage {
  // 0) Is this even the ship's page? A Cloudflare interstitial, a redirect to
  //    the homepage or a "vessel not found" page can all arrive as HTTP 200
  //    with somebody else's coordinates in the map init.
  const nameRe = new RegExp(ship.name.replace(/[.*+?^${}()|[\]\\]/g, '\\$&').replace(/\s+/g, '[\\s-]*'), 'i');
  if (!nameRe.test(html) && !html.includes(String(ship.imo))) {
    return {
      pos: null,
      strategy: null,
      ageText: null,
      note: 'page does not mention the ship (interstitial, redirect or not found?)',
      excerpt: textExcerpt(html, 0, 300),
    };
  }

  let lat: number | null = null;
  let lon: number | null = null;
  let strategy: string | null = null;
  let matchAt = -1; // where in the page the coordinates were found
  const hemi = (v: string, h: string | undefined, negative: 'S' | 'W'): number =>
    Number(v) * (h && h.toUpperCase() === negative ? -1 : 1);

  // 1) The position prose: "current position is at North America West Coast
  //    (coordinates 59.76 N / 149.05 W) cruising at speed of 8 kn ...". It's
  //    the human-facing statement of the ship's fix and the same block that
  //    states the fix age, so it beats anything in the map scripts.
  const prose = html.match(
    /position[^<.]{0,160}?coordinates?\s*:?\s*\(?\s*(-?\d{1,2}(?:\.\d+)?)\s*°?\s*([NS])?\s*[/,|]\s*(-?\d{1,3}(?:\.\d+)?)\s*°?\s*([EW])?/i
  );
  if (prose && prose.index !== undefined) {
    lat = hemi(prose[1], prose[2], 'S');
    lon = hemi(prose[3], prose[4], 'W');
    strategy = 'prose';
    matchAt = prose.index;
  }

  // 2) Decimal coords assigned to lat/lng-like keys in inline JS or JSON
  //    (the marker init: "lat":-15.877,"lng":-149.56). A key must start a
  //    token so "lat" can't match inside "translate", "platform" or "flat";
  //    the ship-specific names are tried first because the page also embeds
  //    markers for the itinerary's ports; and the longitude must sit within
  //    the same object as the latitude — never spliced from a different one.
  if (lat === null || lon === null) {
    const PAIRS: Array<[string, string[]]> = [
      ['nlat', ['nlng', 'nlon']],
      ['shipLat', ['shipLng', 'shipLon']],
      ['ship_lat', ['ship_lng', 'ship_lon']],
      ['latitude', ['longitude']],
      ['lat', ['lng', 'lon']],
    ];
    const keyRe = (n: string) =>
      new RegExp(`(?<![A-Za-z0-9_$])["']?${n}["']?\\s*[:=]\\s*["']?(-?\\d{1,3}\\.\\d{3,})`, 'i');
    outer: for (const [latKey, lonKeys] of PAIRS) {
      const a = html.match(keyRe(latKey));
      if (!a || a.index === undefined) continue;
      const window = html.slice(Math.max(0, a.index - 200), a.index + a[0].length + 200);
      for (const lonKey of lonKeys) {
        const b = window.match(keyRe(lonKey));
        if (b) {
          lat = Number(a[1]);
          lon = Number(b[1]);
          strategy = 'keyed';
          matchAt = a.index;
          break outer;
        }
      }
    }
  }

  // 3) data-* attributes on the map container.
  if (lat === null || lon === null) {
    const a = html.match(/data-lat(?:itude)?=["'](-?\d{1,2}\.\d+)["']/i);
    const b = html.match(/data-l(?:ng|on|ongitude)=["'](-?\d{1,3}\.\d+)["']/i);
    if (a && b && a.index !== undefined) {
      lat = Number(a[1]);
      lon = Number(b[1]);
      strategy = 'data-attr';
      matchAt = a.index;
    }
  }

  // 4) Any visible hemisphere pair "15.877 S / 149.560 W". Upper-case letters
  //    and decimals only — "deck 2 n, 4 e" is not a position.
  if (lat === null || lon === null) {
    const m = html.match(/(\d{1,2}\.\d+)\s*°?\s*([NS])\s*[/,]?\s*(\d{1,3}\.\d+)\s*°?\s*([EW])/);
    if (m && m.index !== undefined) {
      lat = hemi(m[1], m[2], 'S');
      lon = hemi(m[3], m[4], 'W');
      strategy = 'hemisphere';
      matchAt = m.index;
    }
  }

  if (
    lat === null ||
    lon === null ||
    !Number.isFinite(lat) ||
    !Number.isFinite(lon) ||
    Math.abs(lat) > 90 ||
    Math.abs(lon) > 180 ||
    (lat === 0 && lon === 0)
  ) {
    return {
      pos: null,
      strategy: null,
      ageText: null,
      note: 'no coordinates found on the page',
      excerpt: textExcerpt(html, 0, 300),
    };
  }

  // The page says how old the fix is, in the same block as the coordinates
  // ("...(coordinates 59.76 N / 149.05 W) cruising at speed of 8 kn ... The
  // AIS position was reported 38 minutes ago"). Only that block is read: a
  // page-wide search would attach a review's "updated 3 days ago" to a fresh
  // position and get it refused as older than what we hold. With no age here
  // the fix is treated as untimed, which the plausibility gate handles.
  const near = html.slice(Math.max(0, matchAt - 300), matchAt + 1_200);
  const age = parseReportedAgo(near);

  // Speed, course and destination are read from the position block first;
  // the page-wide fallbacks pick up spec sheets ("service speed 15 kn") and
  // weather widgets ("wind 25 kts") only when the block says nothing.
  const num = (re: RegExp, scope: string = html): number | null => {
    const m = scope.match(re);
    return m ? Number(m[1]) : null;
  };
  const speedRe = /(?:speed\s+(?:of|is)?|sailing\s+at|cruising\s+at)\s*:?\s*([\d.]+)\s*(?:kn|knots|kts)\b/i;
  let speedKt = num(speedRe, near) ?? num(speedRe) ?? num(/([\d.]+)\s*(?:kn|knots|kts)\b/i);
  if (speedKt !== null && !(speedKt >= 0 && speedKt <= 40)) speedKt = null;
  const courseRe = /course[^0-9-]{0,24}(\d{1,3}(?:\.\d+)?)\s*°/i;
  const courseDeg = num(courseRe, near) ?? num(courseRe);
  const destRe = /(?:en route to|next port|destination)[:\s]+([A-Za-z][A-Za-z .,'()-]{1,38})/i;
  const destM = near.match(destRe) ?? html.match(destRe);
  // The prose runs straight on ("en route to Tokyo. The AIS position was…"),
  // so cut at a sentence end — but not inside "St. Thomas".
  const destination = destM
    ? destM[1].replace(/(?<!\b(?:St|Ste|Ft|Mt|Pt))\.\s.*$/, '').trim() || null
    : null;
  // ETA appears in a few shapes ("ETA: Jul 22, 06:00", "arrival ... 22 Jul, 06:00",
  // or an ISO datetime nearby); grab the first date-like run after the keyword.
  const etaM = html.match(
    /(?:ETA|estimated\s+(?:time\s+of\s+)?arrival|arrival)[^A-Za-z0-9]{0,20}(\d{4}-\d{2}-\d{2}[ T]\d{2}:\d{2}|[A-Za-z]{3,9}\.?\s+\d{1,2},?\s+\d{1,2}:\d{2}|\d{1,2}\s+[A-Za-z]{3,9}\.?,?\s+\d{1,2}:\d{2})/i
  );

  return {
    pos: {
      imo: ship.imo,
      mmsi: ship.mmsi,
      lat,
      lon,
      speedKt,
      courseDeg,
      headingDeg: null,
      navStatus: null,
      destination,
      etaText: etaM ? etaM[1].trim() : null,
      name: ship.name,
      t: age ? now - age.ageMs : now,
      fixAtKnown: age !== null,
      fixPrecisionMs: age ? age.precisionMs : 0,
      // The page shows a position without saying how it was received.
      reception: null,
    },
    strategy,
    ageText: age?.text ?? null,
    note: age ? null : 'page gave no fix age; treated as current',
    excerpt: textExcerpt(html, matchAt),
  };
}

async function fetchCruiseMapper(): Promise<PaidPosition[]> {
  const out: PaidPosition[] = [];
  let blocked = 0;
  let parsed = 0;
  let lastErr = '';
  for (const ship of FLEET) {
    const at = Date.now();
    try {
      const html = await fetchText(`https://www.cruisemapper.com/?imo=${ship.imo}`, {
        Referer: 'https://www.cruisemapper.com/',
      });
      const r = parseCruiseMapper(html, ship, at);
      scrapeResults.set(ship.imo, {
        imo: ship.imo,
        name: ship.name,
        at,
        ok: r.pos !== null,
        strategy: r.strategy,
        lat: r.pos?.lat ?? null,
        lon: r.pos?.lon ?? null,
        ageText: r.ageText,
        fixAgeMin: r.pos ? Math.round((at - r.pos.t) / 60_000) : null,
        note: r.note,
        excerpt: r.excerpt,
      });
      if (r.pos) {
        out.push(r.pos);
        parsed++;
      }
    } catch (err) {
      lastErr = String(err);
      if (lastErr.includes('403') || lastErr.includes('503')) blocked++;
      scrapeResults.set(ship.imo, {
        imo: ship.imo,
        name: ship.name,
        at,
        ok: false,
        strategy: null,
        lat: null,
        lon: null,
        ageText: null,
        fixAgeMin: null,
        note: lastErr,
        excerpt: null,
      });
    }
    await sleep(1_200 + Math.random() * 800); // gentle, less bot-like pacing
  }
  lastScrapeNote =
    blocked > 0
      ? `${blocked}/${FLEET.length} requests blocked (Cloudflare ${lastErr || '403/503'}); ${parsed} parsed`
      : `${parsed}/${FLEET.length} ships parsed${lastErr ? ` (last error: ${lastErr})` : ''}`;
  return out;
}

// MyShipTracking bulk endpoint — comma-separated IMOs in one request; response
// is a { data: [...] } envelope. Field names parsed defensively.
async function fetchMyShipTracking(key: string): Promise<PaidPosition[]> {
  const imos = FLEET.map((s) => s.imo).join(',');
  const data = (await fetchJson(
    `https://api.myshiptracking.com/api/v2/vessel/bulk?imo=${imos}&response=simple`,
    { Authorization: `Bearer ${key}` }
  )) as { data?: unknown };
  const rows = Array.isArray(data?.data) ? (data.data as Record<string, unknown>[]) : [];
  return rows.map((v) => {
    const ts = pickField<string | number>(v, 'received', 'timestamp', 'last_position_time', 'time');
    const t = typeof ts === 'number' ? ts * (ts < 1e12 ? 1000 : 1) : ts ? Date.parse(String(ts)) : NaN;
    return {
      imo: pnum(pickField(v, 'imo', 'IMO')),
      mmsi: ((): string | null => {
        const m = pickField(v, 'mmsi', 'MMSI');
        return m != null ? String(m) : null;
      })(),
      lat: pnum(pickField(v, 'lat', 'latitude', 'LAT')),
      lon: pnum(pickField(v, 'lng', 'lon', 'longitude', 'LON')),
      speedKt: pnum(pickField(v, 'speed', 'sog', 'SPEED')),
      courseDeg: pnum(pickField(v, 'course', 'cog', 'COURSE')),
      headingDeg: pnum(pickField(v, 'heading', 'true_heading', 'HEADING')),
      navStatus: pnum(pickField(v, 'nav_status', 'navstat', 'status')),
      destination: (pickField<string>(v, 'destination', 'dest') ?? null) || null,
      etaText: pickEtaText(v, 'eta_UTC', 'eta_utc', 'eta', 'ETA'),
      name: (pickField<string>(v, 'name', 'vessel_name', 'shipname') ?? null) || null,
      t: Number.isNaN(t) ? Date.now() : t,
      fixAtKnown: !Number.isNaN(t),
      fixPrecisionMs: 0,
      reception: null,
    };
  });
}

// Turn a provider row into a candidate fix and offer it to applyFix. Returns
// whether it was accepted.
function applyPaidPosition(r: PaidPosition, source: FixSource): boolean {
  if (r.lat == null || r.lon == null || Math.abs(r.lat) > 90 || Math.abs(r.lon) > 180) return false;
  const ship =
    (r.imo != null ? FLEET.find((s) => s.imo === r.imo) : undefined) ??
    (r.mmsi ? FLEET.find((s) => s.mmsi === r.mmsi) : undefined);
  const mmsi = ship?.mmsi ?? r.mmsi ?? (r.imo != null ? `imo-${r.imo}` : null);
  if (!mmsi) return false;
  const now = Date.now();
  const fixAt = Number.isFinite(r.t) ? r.t : now;
  const existing = tracked.get(mmsi);
  const eta: EtaFields = r.etaText
    ? { etaUtc: parseEtaText(r.etaText), etaText: r.etaText, etaAt: fixAt }
    : carriedEta(existing, now);
  const record: VesselData = {
    mmsi,
    imo: ship?.imo ?? r.imo ?? existing?.imo ?? null,
    name: ship?.name ?? r.name ?? existing?.name ?? null,
    callsign: existing?.callsign ?? null,
    shipType: existing?.shipType ?? 60,
    latitude: r.lat,
    longitude: r.lon,
    speedKt: r.speedKt ?? existing?.speedKt ?? null,
    heading: r.headingDeg != null && r.headingDeg !== 511 ? r.headingDeg : existing?.heading ?? null,
    course: r.courseDeg != null && r.courseDeg < 360 ? r.courseDeg : existing?.course ?? null,
    navStatus: r.navStatus ?? existing?.navStatus ?? null,
    destination: r.destination ?? existing?.destination ?? null,
    ...eta,
    updatedAt: fixAt,
    receivedAt: now,
    source,
    reception: r.reception,
  };
  return applyFix(record, r.fixAtKnown, r.fixPrecisionMs);
}

// --- Provider registry -------------------------------------------------------
// Every configured source is polled on every cycle, and the best candidate per
// ship wins. This replaces an if/else chain that ran only the FIRST configured
// source: with one feed there was no second opinion, so when that feed had no
// position for a vessel at sea — or served her last port call instead — the
// map had nothing better to show and no way to know it was wrong.
//
// Listed best-coverage-first. That order is only the tie-break; a fresher fix
// from a lower-ranked source still wins.
interface PositionProvider {
  source: FixSource;
  label: string;
  fetch: () => Promise<PaidPosition[]>;
}

function activeProviders(): PositionProvider[] {
  const out: PositionProvider[] = [];
  if (config.marinetrafficApiKey) {
    out.push({
      source: 'marinetraffic',
      label: 'MarineTraffic',
      fetch: () => fetchMarineTraffic(config.marinetrafficApiKey),
    });
  }
  if (config.vesselfinderApiKey) {
    out.push({
      source: 'vesselfinder',
      label: 'VesselFinder',
      fetch: () => fetchVesselFinder(config.vesselfinderApiKey),
    });
  }
  if (config.myshiptrackingApiKey) {
    out.push({
      source: 'myshiptracking',
      label: 'MyShipTracking',
      fetch: () => fetchMyShipTracking(config.myshiptrackingApiKey),
    });
  }
  if (config.cruisemapperScrape) {
    out.push({ source: 'cruisemapper', label: 'CruiseMapper', fetch: fetchCruiseMapper });
  }
  return out;
}

export interface SourceCandidate {
  source: FixSource;
  row: PaidPosition;
}

// Which of two positions for the same ship to believe. A source that states
// when the ship reported beats one that does not, because an unstated time is
// stamped with our own clock and would always look like the newest. Then the
// newer fix. Then coverage rank, so a satellite/roaming feed settles a tie
// against a scrape of a web page.
export function betterCandidate(
  a: SourceCandidate,
  b: SourceCandidate,
  rank: (s: FixSource) => number
): SourceCandidate {
  if (a.row.fixAtKnown !== b.row.fixAtKnown) return a.row.fixAtKnown ? a : b;
  if (a.row.t !== b.row.t) return a.row.t > b.row.t ? a : b;
  return rank(a.source) <= rank(b.source) ? a : b;
}

// The fleet MMSI a provider row belongs to, or null when it names no ship we
// track.
function fleetKeyOf(r: PaidPosition): string | null {
  const ship =
    (r.imo != null ? FLEET.find((s) => s.imo === r.imo) : undefined) ??
    (r.mmsi ? FLEET.find((s) => s.mmsi === r.mmsi) : undefined);
  return ship?.mmsi ?? r.mmsi ?? (r.imo != null ? `imo-${r.imo}` : null);
}

// What each source said about each ship on the last cycle, and which answer
// was used. This is the view that makes a coverage gap obvious: a feed with
// no row for a vessel simply is not listed against her.
interface SourceReport {
  source: FixSource;
  lat: number;
  lon: number;
  fixAt: number;
  fixAtKnown: boolean;
  fixAgeMin: number;
  reception: Reception;
  won: boolean;
  accepted: boolean | null; // null: not the winner, so never offered to applyFix
}
const lastCycleReports = new Map<string, SourceReport[]>();

interface ProviderStat {
  source: FixSource;
  label: string;
  lastRunAt: number | null;
  lastOkAt: number | null;
  lastError: string | null;
  rows: number;
  tookMs: number;
}
const providerStats = new Map<FixSource, ProviderStat>();

async function pollPositions() {
  const providers = activeProviders();
  if (providers.length === 0) return;

  const started = Date.now();
  const settled = await Promise.all(
    providers.map(async (p) => {
      const t0 = Date.now();
      try {
        const rows = await p.fetch();
        providerStats.set(p.source, {
          source: p.source,
          label: p.label,
          lastRunAt: t0,
          lastOkAt: Date.now(),
          lastError: null,
          rows: rows.length,
          tookMs: Date.now() - t0,
        });
        return { provider: p, rows };
      } catch (err) {
        const msg = err instanceof Error ? err.message : String(err);
        providerStats.set(p.source, {
          source: p.source,
          label: p.label,
          lastRunAt: t0,
          lastOkAt: providerStats.get(p.source)?.lastOkAt ?? null,
          lastError: msg,
          rows: 0,
          tookMs: Date.now() - t0,
        });
        console.error(`[ships] ${p.label} poll failed:`, msg);
        return { provider: p, rows: [] as PaidPosition[] };
      }
    })
  );

  const rank = (s: FixSource) => {
    const i = providers.findIndex((p) => p.source === s);
    return i === -1 ? providers.length : i;
  };

  // Collect every source's answer per ship, then apply only the winner. Handing
  // applyFix each answer in turn would let whichever arrived first claim an
  // empty slot and make the better answer look like a backwards jump.
  const byShip = new Map<string, SourceCandidate[]>();
  for (const { provider, rows } of settled) {
    for (const row of rows) {
      if (row.lat == null || row.lon == null) continue;
      const key = fleetKeyOf(row);
      if (!key) continue;
      const list = byShip.get(key);
      if (list) list.push({ source: provider.source, row });
      else byShip.set(key, [{ source: provider.source, row }]);
    }
  }

  lastCycleReports.clear();
  let offered = 0;
  let applied = 0;
  for (const [key, candidates] of byShip) {
    const winner = candidates.reduce((best, c) => betterCandidate(best, c, rank));
    offered++;
    const ok = applyPaidPosition(winner.row, winner.source);
    if (ok) applied++;
    lastCycleReports.set(
      key,
      candidates.map((c) => ({
        source: c.source,
        lat: c.row.lat as number,
        lon: c.row.lon as number,
        fixAt: c.row.t,
        fixAtKnown: c.row.fixAtKnown,
        fixAgeMin: Math.round((started - c.row.t) / 60_000),
        reception: c.row.reception,
        won: c === winner,
        accepted: c === winner ? ok : null,
      }))
    );
  }

  // Kept for the plain-language diagnosis: the source whose answer is on the
  // map for the most ships right now.
  const wins = new Map<FixSource, number>();
  for (const reports of lastCycleReports.values()) {
    const w = reports.find((r) => r.won);
    if (w) wins.set(w.source, (wins.get(w.source) ?? 0) + 1);
  }
  paidProvider =
    [...wins.entries()].sort((a, b) => b[1] - a[1])[0]?.[0] ?? providers[0]?.source ?? null;

  const errors = [...providerStats.values()].filter((s) => s.lastError);
  paidLastError = errors.length === providers.length && errors.length > 0 ? errors[0].lastError : null;
  if (errors.length < providers.length) paidLastOk = Date.now();
  paidLastCount = applied;
  paidLastOffered = offered;
}

function paidConfigured(): boolean {
  return activeProviders().length > 0;
}

export function initShipsStream() {
  // Free AIS stream — live updates when a ship is in community-receiver range.
  // A live report is current by definition, so it needn't wait for the restore.
  if (config.aisstreamApiKey) {
    connectAIS();
    setInterval(evictStale, 5 * 60_000);
  }
  // Restore what we held before the restart, THEN start the by-IMO polling
  // (a paid provider if a key is set, otherwise the free CruiseMapper scrape).
  // Order matters: the first scrape after a restart must be judged against the
  // last accepted fix, not accepted blindly into an empty map — that blind
  // acceptance is how a stale page put a mid-ocean ship back in port.
  // loadSnapshot never throws; the Postgres read is bounded by its retries.
  void loadSnapshot().finally(() => {
    if (!paidConfigured()) return;
    void pollPositions();
    setInterval(pollPositions, PAID_POLL_MS);
  });
  // Heroku sends SIGTERM before a dyno restart and allows ~30 s of grace —
  // flush a pending save so the restart resumes from the very last fix.
  process.once('SIGTERM', () => {
    if (saveTimer) {
      clearTimeout(saveTimer);
      saveTimer = null;
    }
    void saveSnapshot();
  });
}

router.get('/', (_req, res) => {
  if (!config.aisstreamApiKey && !paidConfigured()) {
    res.json({ source: 'no-key', ships: [], updated: Date.now() });
    return;
  }

  const now = Date.now();

  // Return every tracked ship at its last known position regardless of age —
  // no staleness cutoff, so they stay visible until a fresh report moves them.
  // Dedupe by IMO (keeping the most recent) in case an MMSI was reassigned.
  const best = new Map<string, VesselData>();
  for (const v of tracked.values()) {
    const key = v.imo !== null ? `imo:${v.imo}` : `mmsi:${v.mmsi}`;
    const prev = best.get(key);
    if (!prev || v.updatedAt > prev.updatedAt) best.set(key, v);
  }
  const result = [...best.values()].map((v) => ({
    ...v,
    lastSeenSec: (now - v.updatedAt) / 1000,
    track: history.get(v.mmsi) ?? [],
  }));

  res.json({
    source: 'aisstream',
    ships: result,
    updated: now,
    connected: ws !== null && ws.readyState === WebSocket.OPEN,
    streaming: lastMessageAt > 0 && now - lastMessageAt < 60_000,
    messages: totalMessages,
    matched: allowedMmsis.size,
    total: ALLOWED_IMOS.size,
  });
});

function wsStateName(): string {
  if (!ws) return 'closed';
  switch (ws.readyState) {
    case WebSocket.CONNECTING:
      return 'connecting';
    case WebSocket.OPEN:
      return 'open';
    case WebSocket.CLOSING:
      return 'closing';
    default:
      return 'closed';
  }
}

// Per-IMO snapshot of the allowlist: which of the tracked ships we've actually
// correlated to a live MMSI, and where/when we last saw them.
function trackedByImo() {
  const now = Date.now();
  const byImo = new Map<number, VesselData>();
  for (const v of tracked.values()) {
    if (v.imo == null) continue;
    const prev = byImo.get(v.imo);
    if (!prev || v.updatedAt > prev.updatedAt) byImo.set(v.imo, v);
  }
  return [...ALLOWED_IMOS].map((imo) => {
    const v = byImo.get(imo);
    const rej = v ? lastRejection.get(v.mmsi) : undefined;
    return {
      imo,
      matched: !!v,
      mmsi: v?.mmsi ?? null,
      name: v?.name ?? null,
      lat: v?.latitude ?? null,
      lon: v?.longitude ?? null,
      lastSeenSec: v ? Math.round((now - v.updatedAt) / 1000) : null,
      source: v?.source ?? null,
      reception: v?.reception ?? null,
      fixAt: v?.updatedAt ?? null,
      fixAgeMin: v ? Math.round((now - v.updatedAt) / 60_000) : null,
      receivedAt: v?.receivedAt ?? null,
      // What every polled source said about this ship on the last cycle.
      reportedBy: v ? (lastCycleReports.get(v.mmsi) ?? []) : [],
      lastRejection: rej
        ? {
            at: rej.at,
            source: rej.source,
            reason: rej.reason,
            lat: rej.lat,
            lon: rej.lon,
            distanceNm: rej.distanceNm,
            impliedKt: rej.impliedKt,
          }
        : null,
    };
  });
}

function providerLabel(): string {
  switch (paidProvider) {
    case 'marinetraffic':
      return 'MarineTraffic';
    case 'cruisemapper':
      return 'CruiseMapper';
    case 'vesselfinder':
      return 'VesselFinder';
    case 'myshiptracking':
      return 'MyShipTracking';
    default:
      return 'the position feed';
  }
}

// Plain-language read of the current state so the situation is obvious at a
// glance from a browser. A by-IMO source (CruiseMapper scrape or a paid key) is
// now the primary way ships reach the map, so lead with whether ships are
// actually shown and from where; aisstream is a live supplement whose silence
// is expected when no fleet ship is in a community receiver's range.
function diagnose(perImo: ReturnType<typeof trackedByImo>): string {
  const total = ALLOWED_IMOS.size;
  const matched = perImo.filter((p) => p.matched).length;
  const aisOpen = wsStateName() === 'open';
  const aisSupp = aisOpen
    ? ' aisstream is connected as a live supplement (silent until a ship enters receiver range).'
    : '';

  // Primary: are ships on the map, and where from?
  if (matched > 0) {
    const head =
      matched === total
        ? `Working: all ${total} ships on the map`
        : `${matched} of ${total} ships on the map`;
    const via = paidProvider ? ` via ${providerLabel()}` : '';
    const dayAgo = Date.now() - 24 * 3600_000;
    const refused = rejections.filter((r) => r.at >= dayAgo && r.reason === 'implausible').length;
    const stale = rejections.filter((r) => r.at >= dayAgo && r.reason === 'older').length;
    const refusedNote =
      refused > 0 || stale > 0
        ? ` In the last 24 h ${refused} fix(es) were refused as implausible jumps and ${stale} as older than the held fix — see fixes.rejections.`
        : '';
    // The failure that looks like a bug but is a coverage gap: every ship is
    // on the map, yet the positions are days old because no configured source
    // can hear a vessel away from the coast. Say so, with the remedy.
    const oldest = Math.max(0, ...perImo.filter((p) => p.matched).map((p) => p.fixAgeMin ?? 0));
    const hasOffshore = Boolean(config.marinetrafficApiKey || config.vesselfinderApiKey);
    const coverageNote =
      oldest >= 12 * 60 && !hasOffshore
        ? ` Oldest fix is ${Math.round(oldest / 60)} h old and no source carrying satellite or roaming AIS is configured` +
          ' (aisstream is shore receivers only; the CruiseMapper scrape shows whatever that page has). A ship offshore' +
          ' will sit at her last coastal position until she is heard again — set MARINETRAFFIC_API_KEY or' +
          ' VESSELFINDER_API_KEY to close that gap.'
        : '';
    return `${head}${via}.${aisSupp}${refusedNote}${coverageNote}`;
  }

  // No ships shown — diagnose the by-IMO source first, then aisstream.
  if (paidConfigured()) {
    const src = providerLabel();
    if (paidLastError) return `No ships yet — ${src} poll failed: ${paidLastError}.`;
    if (lastScrapeNote && /blocked/i.test(lastScrapeNote))
      return `No ships yet — ${src} is being blocked: ${lastScrapeNote}.`;
    if (paidLastOk === 0) return `No ships yet — ${src} has not finished its first poll.`;
    return `No ships yet — ${src} returned no positions${lastScrapeNote ? ` (${lastScrapeNote})` : ''}.`;
  }
  if (!config.aisstreamApiKey) return 'No position source configured (no scrape, no paid key, no AISSTREAM_API_KEY).';
  if (!aisOpen)
    return `aisstream WebSocket is "${wsStateName()}" (last error: ${lastError ?? 'none'}).`;
  return `aisstream connected but none of the ${total} ships are in receiver range yet.`;
}

// GET /api/ships/debug — connection, stream-volume and per-ship match state.
router.get('/debug', (_req, res) => {
  const now = Date.now();
  const perImo = trackedByImo();
  res.json({
    keyConfigured: Boolean(config.aisstreamApiKey),
    ws: {
      state: wsStateName(),
      connectAttempts,
      lastConnectAt: lastConnectAt || null,
      lastError,
      lastMessageAt: lastMessageAt || null,
      secSinceLastMessage: lastMessageAt ? Math.round((now - lastMessageAt) / 1000) : null,
      streaming: lastMessageAt > 0 && now - lastMessageAt < 60_000,
    },
    stream: {
      totalMessages,
      positionReports,
      staticReports,
      distinctVesselsInMemory: vessels.size,
    },
    paid: {
      configured: paidConfigured(),
      provider: paidProvider,
      pollMinutes: PAID_POLL_MS / 60_000,
      lastOkAt: paidLastOk || null,
      lastOffered: paidLastOffered,
      lastCount: paidLastCount,
      lastError: paidLastError,
      scrapeNote: lastScrapeNote,
      // Every source polled this cycle, in tie-break order, with what it cost
      // and whether it answered. A source absent from a ship's `reportedBy`
      // list simply had no position for her.
      providers: activeProviders().map((p) => {
        const stat = providerStats.get(p.source);
        return {
          source: p.source,
          label: p.label,
          rows: stat?.rows ?? null,
          lastRunAt: stat?.lastRunAt ?? null,
          lastOkAt: stat?.lastOkAt ?? null,
          lastError: stat?.lastError ?? null,
          tookMs: stat?.tookMs ?? null,
        };
      }),
      carriesRoamingOrSatellite: Boolean(config.marinetrafficApiKey || config.vesselfinderApiKey),
      // Per ship: which parse strategy produced the coordinates, the page's
      // own fix age, and why a page was skipped.
      scrape: [...scrapeResults.values()],
    },
    // The acceptance trail: what each feed contributed, which fixes were
    // refused (and how far off they were), and any far-away track a source
    // is currently insisting on.
    fixes: {
      rules: {
        maxPlausibleKt: MAX_PLAUSIBLE_KT,
        minGateMinutes: MIN_GATE_DT_MS / 60_000,
        healRepeats: HEAL_MIN_REPEATS,
        healSpanMinutes: HEAL_MIN_SPAN_MS / 60_000,
      },
      acceptedBySource,
      healed: healedCount,
      pending: [...pendingOverrides.entries()].map(([mmsi, p]) => ({ mmsi, ...p })),
      rejections: [...rejections].reverse(),
    },
    allowlist: {
      imoCount: ALLOWED_IMOS.size,
      matchedMmsis: [...allowedMmsis],
      ships: perImo,
    },
    snapshot: {
      path: SNAPSHOT_PATH,
      database: DB_ENABLED,
      loadedAtStartup: snapshotLoadedCount,
      loadedFrom: snapshotLoadedFrom,
      ageAtStartupMin: snapshotLoadedAgeMin,
      lastSavedAt: lastSnapshotSaveAt || null,
      lastSaveError: lastSnapshotSaveError,
      trackedNow: tracked.size,
    },
    diagnosis: diagnose(perImo),
    updated: now,
  });
});

export default router;
