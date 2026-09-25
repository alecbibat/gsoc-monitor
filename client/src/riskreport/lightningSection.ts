import type { LightningHistoryResponse } from '../types';
import type { LightningGap, LightningNearResponse } from '../types/lightning';
import { haversineMeters, MILES_TO_M } from '../lib/geo';
import type { RiskLevel, RiskTarget, SectionResult, WildfireReportData } from './riskTypes';

// ── Lightning section of the wildfire report ─────────────────────────────────
// Pure: turns the server's /near answer into the section, the report's
// lightning block, the strikes for the map, and the caveats that must reach
// the bottom line. Thresholds live in docs/RISK-REPORT-MATRIX.md.
//
// The counts come from the server, computed over every stored strike before
// any point thinning, and are used as-is: the map may show a sample, the
// numbers never are one. What the numbers can't show — time the collector
// was blind, history still loading after a restart, a collector that is down
// right now, positions the memory cap dropped — becomes an explicit caveat
// that is ALWAYS surfaced in the BLUF, even at Low: otherwise a quiet day and
// a blind collector read identically.

export interface LightningSectionResult {
  section: SectionResult;
  lightning: WildfireReportData['lightning'];
  /**
   * Strikes for the map, oldest → newest (fresh strikes draw on top). `t` is
   * epoch seconds on the CLIENT clock — the server's skew is removed — so the
   * map can age them against Date.now().
   */
  mapStrikes: { lat: number; lon: number; t: number }[];
  mapNote: string | null;
  /** Caveats for the report's bottom line, surfaced whatever the section level. */
  blufDrivers: string[];
}

const TITLE = 'Lightning (24 h)';

/**
 * Less total blind time than this stays out of the report: a relay hop or the
 * daily dyno restart costs a minute or two and moves no count that matters.
 */
export const GAP_CAVEAT_MIN = 10;

/**
 * The global stream never pauses this long (tens of strikes per second), so a
 * collector this silent is down even if its socket still reads open.
 */
const SILENT_OFFLINE_S = 120;

/** HH:MM UTC — the report is shared across time zones. */
const utcClock = (ms: number) => new Date(ms).toISOString().slice(11, 16);

/** A span of minutes: 25 → "25 min", 65 → "1h05m". */
export function fmtSpan(min: number): string {
  const m = Math.max(0, Math.round(min));
  if (m < 60) return `${m} min`;
  return `${Math.floor(m / 60)}h${String(m % 60).padStart(2, '0')}m`;
}

/** A strike's age for a driver: "<1 min", "12 min", "3 h". */
function fmtAge(ageS: number): string {
  if (ageS < 60) return '<1 min';
  if (ageS < 3600) return `${Math.round(ageS / 60)} min`;
  return `${Math.round(ageS / 3600)} h`;
}

/** Gaps clipped to [fromMs, toMs]: total blind minutes and the largest gap. */
function summarizeGaps(
  gaps: readonly LightningGap[],
  fromMs: number,
  toMs: number
): { totalMin: number; largest: LightningGap | null } {
  let totalMs = 0;
  let largest: LightningGap | null = null;
  for (const g of gaps) {
    const a = Math.max(g.fromMs, fromMs);
    const b = Math.min(g.toMs, toMs);
    if (!(b > a)) continue;
    totalMs += b - a;
    if (!largest || b - a > largest.toMs - largest.fromMs) largest = { fromMs: a, toMs: b };
  }
  return { totalMin: totalMs / 60_000, largest };
}

/**
 * The map caption's coverage line — any blind spot at all, since the map is
 * where a missing hour would otherwise read as "no storms then".
 */
export function coverageCaption(
  coverage: WildfireReportData['lightning']['coverage'] | undefined
): string | null {
  if (!coverage || coverage.gaps.length === 0) return null;
  const { totalMin } = summarizeGaps(coverage.gaps, -Infinity, Infinity);
  const n = coverage.gaps.length;
  return `collector blind ${fmtSpan(totalMin)} in ${n} gap${n === 1 ? '' : 's'} — no strikes recorded then`;
}

/** Append bottom-line caveats the section drivers didn't already put there. */
export function appendBlufDrivers(overall: string[], bluf: readonly string[]): string[] {
  for (const d of bluf) if (!overall.includes(d)) overall.push(d);
  return overall;
}

/**
 * How a count prints: "≥" once the memory cap dropped positions inside the
 * window (the counts only cover the rest — a floor), "≈" for pre-upgrade
 * 1-in-6 history counted ×6 (an estimate), else exact. The floor wins when both apply.
 */
export function lightningCountPrefix(l: Pick<WildfireReportData['lightning'], 'countsExact' | 'countsFromMs'>): string {
  if (l.countsFromMs !== undefined) return '≥';
  return l.countsExact === false ? '≈' : '';
}

/**
 * @param receivedAtMs Client clock when the /near response arrived — paired
 *   with `near.now` (the server's clock at response time) to remove the skew.
 */
export function buildLightningSection(near: LightningNearResponse, receivedAtMs: number): LightningSectionResult {
  const { counts, nearest, coverage, collector, fidelity, points } = near;
  const past = `past ${near.hours} h`;
  // Server clock throughout: the window, gaps and fidelity marks are all server times.
  const windowFromMs = near.now - near.hours * 3_600_000;
  const inWindow = (ms: number | null): ms is number => ms !== null && ms > windowFromMs;
  // Positions older than this were evicted: every location count and the
  // nearest strike cover only evictedBeforeMs → now, so they are floors.
  const countsFromMs = inWindow(fidelity.evictedBeforeMs) ? fidelity.evictedBeforeMs : undefined;
  const prefix = lightningCountPrefix({ countsExact: counts.exact, countsFromMs });

  let level: RiskLevel = 'low';
  const drivers: string[] = [];
  if (nearest && nearest.mi <= 5) {
    level = 'elevated';
    drivers.push(`Strike ${nearest.mi < 1 ? '<1' : Math.round(nearest.mi)} mi from the property ${fmtAge(nearest.ageS)} ago — direct ignition source`);
  } else if (nearest && nearest.mi <= 25) {
    level = 'guarded';
    drivers.push(`Nearest strike ${Math.round(nearest.mi)} mi away, ${fmtAge(nearest.ageS)} ago`);
  }
  if (counts.le100 > 0) {
    drivers.push(`${prefix}${counts.le100.toLocaleString()} strike${counts.le100 === 1 ? '' : 's'} within 100 mi in the ${past}`);
  }

  // ── Honesty caveats: section drivers AND the bottom line ──────────────────
  const caveats: string[] = [];
  const gaps = summarizeGaps(coverage.gaps, windowFromMs, near.now);
  if (gaps.totalMin >= GAP_CAVEAT_MIN && gaps.largest) {
    caveats.push(
      `⚠ Lightning collector blind for ${fmtSpan(gaps.totalMin)} of the ${past} ` +
        `(largest ${utcClock(gaps.largest.fromMs)}–${utcClock(gaps.largest.toMs)} UTC) — strikes in those periods are missing`
    );
  }
  // Time the restore hasn't reached yet is unknown, not a gap (so it isn't in
  // the blind total above); before the collector's first ever start is a gap.
  if (coverage.restoring) {
    caveats.push(
      coverage.restoredBackToMs !== null
        ? `⚠ Lightning history still loading on the server (back to ${utcClock(coverage.restoredBackToMs)} UTC) — counts may be low`
        : '⚠ Lightning history still loading on the server — counts may be low'
    );
  }
  const silentS = collector.lastStrikeAgeS;
  // downSince also covers a socket that opened after a restart but has
  // delivered nothing yet (lastStrikeAgeS is still null then).
  if (!collector.connected || collector.downSince !== null || (silentS !== null && silentS > SILENT_OFFLINE_S)) {
    // Since the last strike received is what's missing; downSince when none arrived since boot.
    const downMin =
      silentS !== null
        ? silentS / 60
        : collector.downSince !== null
          ? (near.now - collector.downSince) / 60_000
          : null;
    caveats.push(
      downMin !== null
        ? `⚠ Lightning collector offline for ${fmtSpan(Math.max(1, downMin))} — the most recent strikes are missing`
        : '⚠ Lightning collector offline — the most recent strikes are missing'
    );
  }
  if (countsFromMs !== undefined) {
    // Only the global /status counts survive eviction; everything here is by location.
    const from = utcClock(countsFromMs);
    caveats.push(
      `⚠ Strike positions before ${from} UTC were dropped (server memory cap) — counts, the nearest strike ` +
        `and the map cover only ${from}–now; a nearby strike before then would be missed`
    );
  }
  const blufDrivers = [...caveats];
  if (inWindow(fidelity.legacyBeforeMs)) {
    const legacy =
      `Strikes before ${utcClock(fidelity.legacyBeforeMs)} UTC come from pre-upgrade history sampled 1-in-6 — ` +
      'counts there are estimates and a single nearby strike can be missed';
    caveats.push(legacy);
    // A strike ≤5 mi already carries the bottom line; without one, "nothing
    // close" may just be the sample talking.
    if (!nearest || nearest.mi > 5) blufDrivers.push(legacy);
  }
  drivers.push(...caveats);

  // ── Map points ─────────────────────────────────────────────────────────────
  const skewS = (receivedAtMs - near.now) / 1000;
  const n = Math.min(points.lat.length, points.lon.length, points.t.length);
  const mapStrikes: LightningSectionResult['mapStrikes'] = [];
  for (let i = 0; i < n; i++) {
    const lat = points.lat[i];
    const lon = points.lon[i];
    const t = points.t[i];
    if (Number.isFinite(lat) && Number.isFinite(lon) && Number.isFinite(t)) {
      mapStrikes.push({ lat, lon, t: t + skewS });
    }
  }
  mapStrikes.sort((a, b) => a.t - b.t); // already ascending from the server; cheap insurance

  const mapNotes: string[] = [];
  if (points.sampled) {
    mapNotes.push(`showing the newest strike per area (${n.toLocaleString()} of ${prefix}${counts.inRadius.toLocaleString()} strikes)`);
  }
  if (countsFromMs !== undefined) {
    mapNotes.push(`no positions before ${utcClock(countsFromMs)} UTC`);
  }
  if (inWindow(fidelity.legacyBeforeMs)) {
    mapNotes.push(`strikes before ${utcClock(fidelity.legacyBeforeMs)} UTC are a 1-in-6 sample`);
  }
  const mapNote = mapNotes.length > 0 ? mapNotes.join(' · ') : null;

  return {
    section: {
      id: 'lightning',
      title: TITLE,
      level,
      drivers,
      countLabel:
        counts.le25 > 0
          ? `${prefix}${counts.le25.toLocaleString()} ≤25 mi`
          : countsFromMs !== undefined
            ? `None ≤25 mi since ${utcClock(countsFromMs)}`
            : 'None ≤25 mi',
    },
    lightning: {
      strikes25mi: counts.le25,
      strikes100mi: counts.le100,
      coverageMin: coverage.coveredMin,
      nearestMi: nearest?.mi,
      nearestAgeS: nearest?.ageS,
      countsExact: counts.exact,
      countsFromMs,
      coverage: { windowMin: coverage.windowMin, coveredMin: coverage.coveredMin, gaps: coverage.gaps },
      notes: caveats,
      mapNote: mapNote ?? undefined,
    },
    mapStrikes,
    mapNote,
    blufDrivers,
  };
}

/** A server from before /near stored 1 of every 6 strikes it received. */
const LEGACY_KEEP_EVERY = 6;

/**
 * The pre-/near logic, for a server that doesn't have /near yet: counts are
 * made client-side from the radius-filtered legacy history. That server kept
 * 1-in-6 on ingest, so every count is an estimate (×6) and a single nearby
 * strike has a 5-in-6 chance of being absent — said in the bottom line too.
 * Only the fallback path uses it.
 */
export function legacyLightningSection(
  resp: LightningHistoryResponse,
  target: RiskTarget,
  receivedAtMs: number
): LightningSectionResult {
  const lightning: WildfireReportData['lightning'] = {};
  const strikes: { lat: number; lon: number; t: number; distanceMi: number }[] = [];
  // Keep everything the 110 mi map view can show (a little past 100 mi).
  for (let i = 0; i < resp.lat.length; i++) {
    const dm = haversineMeters(target.lat, target.lon, resp.lat[i], resp.lon[i]) / MILES_TO_M;
    if (dm <= 130) strikes.push({ lat: resp.lat[i], lon: resp.lon[i], t: resp.t[i], distanceMi: dm });
  }
  // The stored strikes are a 1-in-6 sample, scaled back up ×6. If the
  // response was also stride-sampled (a pre-filter server, or a truly extreme
  // local storm), scale that back up too and say so — never present a sample
  // as a census.
  const sampled = resp.thinned && resp.returned > 0;
  const scale = LEGACY_KEEP_EVERY * (sampled ? resp.totalInWindow / resp.returned : 1);
  const approx = (n: number) => Math.round(n * scale);
  const n25 = strikes.filter((s) => s.distanceMi <= 25).length;
  const n100 = strikes.filter((s) => s.distanceMi <= 100).length;
  lightning.strikes25mi = approx(n25);
  lightning.strikes100mi = approx(n100);
  lightning.coverageMin = resp.coverageMin;
  lightning.countsExact = false;

  const nearestMi = strikes.reduce<number>((m, s) => Math.min(m, s.distanceMi), Infinity);
  let level: RiskLevel = 'low';
  const drivers: string[] = [];
  if (nearestMi <= 5) {
    level = 'elevated';
    drivers.push(`Strike ${nearestMi < 1 ? '<1' : Math.round(nearestMi)} mi from the property in the past 24 h — direct ignition source`);
  } else if (nearestMi <= 25) {
    level = 'guarded';
    drivers.push(`Nearest sampled strike ${Math.round(nearestMi)} mi away in the past 24 h`);
  }
  if ((lightning.strikes100mi ?? 0) > 0) {
    drivers.push(`≈${lightning.strikes100mi!.toLocaleString()} strike${lightning.strikes100mi === 1 ? '' : 's'} within 100 mi in the past 24 h`);
  }
  // Caveats: in the section and, like /near's, always in the bottom line.
  const caveats = [
    '⚠ Lightning history from this older server is a 1-in-6 sample — counts are estimates (×6) and a single nearby strike can be missed',
  ];
  if (sampled) {
    caveats.push(`⚠ Strike data was sampled (${resp.returned.toLocaleString()} of ${resp.totalInWindow.toLocaleString()} returned) — counts are estimates and sparse nearby activity can be missed`);
  }
  if (resp.coverageMin < 23 * 60) {
    caveats.push(`⚠ Only ${(resp.coverageMin / 60).toFixed(1)} h of strike history collected — counts undercount the full day`);
  }
  drivers.push(...caveats);
  lightning.notes = caveats;
  if (Number.isFinite(nearestMi)) lightning.nearestMi = nearestMi;

  // `updated` is the server's clock at response time — same skew removal as /near.
  const skewS = Number.isFinite(resp.updated) ? receivedAtMs / 1000 - resp.updated : 0;
  const mapStrikes = strikes
    .map((s) => ({ lat: s.lat, lon: s.lon, t: s.t + skewS }))
    .sort((a, b) => a.t - b.t);
  const mapNote = sampled
    ? `strikes are a 1-in-6 sample, thinned again to ${resp.returned.toLocaleString()} of ${resp.totalInWindow.toLocaleString()}`
    : 'strikes are a 1-in-6 sample';
  lightning.mapNote = mapNote;

  return {
    section: {
      id: 'lightning',
      title: TITLE,
      level,
      drivers,
      countLabel: n25 === 0 ? 'None sampled ≤25 mi' : `≈${lightning.strikes25mi!.toLocaleString()} ≤25 mi`,
    },
    lightning,
    mapStrikes,
    mapNote,
    blufDrivers: [...caveats],
  };
}
