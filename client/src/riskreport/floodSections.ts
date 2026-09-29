import type { FemaZoneResponse, FloodCat, FloodDischargeResponse, FloodPrecipResponse } from '../types';
import { severityRank, type RawAlert } from '../layers/alerts/alertsData';
import { CAT, catSev } from '../layers/rivers/riverMeta';
import { femaZoneClass } from './floodPalette';
import {
  ERO_META,
  type EroCategory, type EroDay, type FemaSiteZone, type FloodAlertHit,
  type FloodReportData, type FloodRingCount, type GaugeHit,
} from './floodTypes';
import { RISK_LEVELS, RISK_RINGS, bumpLevel, maxLevel, type RiskLevel, type SectionResult } from './riskTypes';

// ── Flood report: pure section logic ─────────────────────────────────────────
// The flood analog of lightningSection.ts plus the per-section blocks inside
// assembleWildfire.ts. No fetch, no DOM, no clock: assembleFlood.ts gathers
// the feeds and hands the answers here; every builder turns one feed's answer
// into a SectionResult. Thresholds live in the Flood table of
// docs/RISK-REPORT-MATRIX.md — change them there first.
//
// Fail-honest throughout: a feed that is down, out of coverage or returned
// something unreadable becomes an "unavailable" section with a plain reason.
// Absence of coverage is not absence of risk, so nothing here ever turns "we
// could not check" into a silent Low.

export type FloodSectionId = 'alerts' | 'gauges' | 'ero' | 'rain' | 'antecedent' | 'fema' | 'burn-scars' | 'discharge';

export const FLOOD_SECTION_TITLES: Record<FloodSectionId, string> = {
  alerts: 'Flood alerts at site',
  gauges: 'River gauges (NWPS)',
  ero: 'Excessive Rainfall Outlook (WPC)',
  rain: 'Forecast rainfall',
  antecedent: 'Recent rainfall (past 7 days)',
  fema: 'FEMA flood zone',
  'burn-scars': 'Burn scars (post-fire runoff)',
  discharge: 'River discharge forecast (GloFAS)',
};

/**
 * The live signals the SFHA escalator multiplies. The FEMA zone itself is
 * static exposure and antecedent rain is context — neither lifts the overall
 * level through the escalator on its own.
 */
export const FLOOD_LIVE_SECTIONS: readonly FloodSectionId[] = ['alerts', 'gauges', 'ero', 'rain', 'burn-scars', 'discharge'];

/** A down / out-of-coverage feed: shown honestly, excluded from the overall level. */
export function unavailableSection(id: FloodSectionId, reason: string): SectionResult {
  return { id, title: FLOOD_SECTION_TITLES[id], level: 'low', drivers: [], unavailable: reason };
}

// ── Formatting helpers ───────────────────────────────────────────────────────

const rank = (l: RiskLevel) => RISK_LEVELS[l].rank;
const plural = (n: number, one: string, many = `${one}s`) => (n === 1 ? one : many);
const isNum = (v: unknown): v is number => typeof v === 'number' && Number.isFinite(v);
/** Sums carry float noise (0.1 + 0.2); two decimals is finer than any model resolves. */
const round2 = (n: number) => Math.round(n * 100) / 100;

/**
 * Inches for a driver: "2.8", "0.06", "0" — never "0.0" for a trace. Rounded
 * DOWN to the tenth, so a total just short of a threshold (3.99 in against
 * ≥4) never prints as the threshold itself beside the lower level.
 */
export function fmtInches(n: number): string {
  if (!(n >= 0.005)) return '0';
  if (n < 0.1) return n.toFixed(2);
  return (Math.floor(n * 10 + 1e-6) / 10).toFixed(1); // epsilon: 2.8 * 10 = 27.999…
}

/** Miles for a driver: "2.4", "<0.1". */
const fmtMi = (n: number) => (n < 0.1 ? '<0.1' : n.toFixed(1));

/** m³/s for a driver: "3.2", "980", "1,240". */
const fmtFlow = (n: number) => (n < 10 ? n.toFixed(1) : Math.round(n).toLocaleString('en-US'));

const WEEKDAYS = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];
const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];

/** Local calendar date → [year, month0, day]; null when not an ISO date. */
function isoParts(iso: string | null | undefined): [number, number, number] | null {
  const m = /^(\d{4})-(\d{2})-(\d{2})/.exec(iso ?? '');
  return m ? [+m[1], +m[2] - 1, +m[3]] : null;
}

/** "2026-10-01" → "Thu 10/1" (the ERO day chips' framing). */
export function fmtEroDate(iso: string | null | undefined): string | null {
  const p = isoParts(iso);
  if (!p) return null;
  // UTC so the weekday is the calendar date's own, whatever the viewer's zone.
  return `${WEEKDAYS[new Date(Date.UTC(p[0], p[1], p[2])).getUTCDay()]} ${p[1] + 1}/${p[2]}`;
}

/** "2026-10-03" → "Oct 3". */
const fmtMonthDay = (iso: string | null | undefined): string | null => {
  const p = isoParts(iso);
  return p ? `${MONTHS[p[1]]} ${p[2]}` : null;
};

// ── Flood alerts at the site ─────────────────────────────────────────────────
// Ordered rules, most specific first: "flash flood warning" must win before
// "flood warning" matches inside it, and the marine "Hurricane Force Wind"
// products must be dropped before "hurricane" pulls them in as tropical.

const ALERT_RULES: { re: RegExp; level: RiskLevel | null }[] = [
  { re: /hurricane force wind/, level: null }, // marine wind product, not a flood signal
  { re: /flash flood warning/, level: 'critical' },
  { re: /storm surge warning/, level: 'critical' },
  { re: /tsunami warning/, level: 'critical' },
  // Coastal / Lakeshore Flood Warnings are High, not Critical — listed before
  // the generic rule only to make that explicit.
  { re: /(?:coastal|lakeshore) flood warning/, level: 'high' },
  { re: /flood warning/, level: 'high' }, // incl. river and "Areal" Flood Warnings
  { re: /hurricane warning/, level: 'high' },
  { re: /typhoon warning/, level: 'high' },
  { re: /flash flood watch/, level: 'elevated' },
  { re: /flood watch/, level: 'elevated' }, // incl. Coastal / Lakeshore Flood Watch
  { re: /storm surge watch/, level: 'elevated' },
  { re: /tsunami (?:watch|advisory)/, level: 'elevated' },
  { re: /hurricane watch/, level: 'elevated' },
  { re: /typhoon watch/, level: 'elevated' },
  { re: /tropical storm warning/, level: 'elevated' },
  // Every other flood-family product: advisories, statements, Hydrologic
  // Outlook, Tropical Storm Watch, Hurricane / Typhoon Local Statements…
  { re: /flood|hydrologic|storm surge|tsunami|hurricane|typhoon|tropical storm|tropical cyclone/, level: 'guarded' },
];

/** A CAP parameter as upper-cased strings: NWS sends string arrays, tolerate a bare value. */
function paramValues(params: Record<string, unknown> | undefined, key: string): string[] {
  if (!params || typeof params !== 'object') return [];
  let raw = params[key];
  if (raw === undefined) {
    const k = Object.keys(params).find((x) => x.toLowerCase() === key.toLowerCase());
    if (k !== undefined) raw = params[k];
  }
  const arr: unknown[] = Array.isArray(raw) ? raw : raw == null ? [] : [raw];
  return arr
    .filter((v) => typeof v === 'string' || typeof v === 'number')
    .map((v) => String(v).trim().toUpperCase());
}

// A downgraded emergency is still narrated in the follow-up text ("The Flash
// Flood Emergency has been downgraded to a Flash Flood Warning") — those
// mentions must not re-tag it.
const EMERGENCY_NEGATED_RE =
  /flash flood emergency\s+(?:has been|is|was|will be)\s+(?:no longer|downgraded|cancell?ed|allowed to expire|expired)|no longer a flash flood emergency/gi;

export function classifyFloodAlert(p: {
  event?: string;
  headline?: string | null;
  description?: string;
  parameters?: Record<string, unknown>;
}): { relevant: boolean; level: RiskLevel; tags: string[] } {
  // Classify on the event name; the headline starts with it, so it stands in
  // when an upstream record arrives without one.
  const name = ((p.event ?? '').trim() || (p.headline ?? '')).toLowerCase();
  const rule = name ? ALERT_RULES.find((r) => r.re.test(name)) : undefined;
  if (!rule || rule.level === null) return { relevant: false, level: 'low', tags: [] };

  const tags: string[] = [];
  const damage = paramValues(p.parameters, 'flashFloodDamageThreat');
  if (/flash flood warning/.test(name)) {
    const text = `${p.headline ?? ''}\n${p.description ?? ''}`.replace(EMERGENCY_NEGATED_RE, '');
    if (damage.some((v) => v.includes('CATASTROPHIC')) || /flash flood emergency/i.test(text)) {
      tags.push('Flash Flood Emergency');
    }
  }
  // CONSIDERABLE and CATASTROPHIC are exclusive tiers; the emergency tag already says more.
  if (!tags.includes('Flash Flood Emergency') && damage.some((v) => v.includes('CONSIDERABLE'))) {
    tags.push('Damage threat: Considerable');
  }
  if (paramValues(p.parameters, 'flashFloodDetection').some((v) => v.includes('OBSERVED'))) {
    tags.push('Observed');
  }
  return { relevant: true, level: rule.level, tags };
}

const BULLET_RE = /(?:^|\n)[ \t]*\*[ \t]*([A-Z][A-Z0-9 /&-]{0,31}?)[ \t]*\.\.\.[ \t]*/g;
const BULLET_TEXT_MAX = 400;
const BULLETS_MAX = 12;

function capText(s: string, max = BULLET_TEXT_MAX): string {
  if (s.length <= max) return s;
  const cut = s.slice(0, max - 1);
  const sp = cut.lastIndexOf(' ');
  // Break on a word when one is close; never mid-word unless it's one huge token.
  return `${(sp > max - 60 ? cut.slice(0, sp) : cut).replace(/[\s.,;:·-]+$/, '')}…`;
}

/**
 * The NWS "* WHAT...text / * WHERE... / * WHEN... / * IMPACTS... /
 * * ADDITIONAL DETAILS..." bullets → [{ label: 'What', text }, …] in order.
 * A bullet runs to the next bullet or the first blank line (the product's
 * tail — tide tables, "&&" — is not part of it); "- " list items join with
 * " · " and bare URLs are dropped. [] when the text has no such bullets.
 */
export function parseNwsBullets(description?: string): { label: string; text: string }[] {
  if (typeof description !== 'string' || !description) return [];
  const src = description.replace(/\r\n?/g, '\n');
  const marks: { label: string; start: number; end: number }[] = [];
  BULLET_RE.lastIndex = 0;
  for (let m = BULLET_RE.exec(src); m !== null; m = BULLET_RE.exec(src)) {
    marks.push({ label: m[1].trim(), start: m.index, end: m.index + m[0].length });
  }
  const out: { label: string; text: string }[] = [];
  marks.forEach((mk, i) => {
    if (out.length >= BULLETS_MAX) return;
    let body = src.slice(mk.end, i + 1 < marks.length ? marks[i + 1].start : src.length).replace(/^\s+/, '');
    const para = body.search(/\n[ \t]*\n/);
    if (para >= 0) body = body.slice(0, para);
    const parts: string[] = [];
    for (const raw of body.split('\n')) {
      const line = raw.trim();
      if (!line) continue;
      const item = /^-\s+(.*)$/.exec(line);
      if (item) parts.push(item[1]);
      else if (parts.length === 0) parts.push(line);
      else parts[parts.length - 1] += ` ${line}`;
    }
    const text = parts
      .map((s) => s.replace(/\s+/g, ' ').trim())
      .filter((s) => s && !/^(?:https?:\/\/|www\.)\S+$/i.test(s))
      .join(' · ');
    if (!text) return;
    const label = mk.label.charAt(0) + mk.label.slice(1).toLowerCase();
    out.push({ label, text: capText(text) });
  });
  return out;
}

/** A raw NWS alert → the report's hit; null when it isn't a flood-family product. */
export function toFloodAlertHit(a: RawAlert): FloodAlertHit | null {
  const p = a?.properties;
  if (!p) return null;
  const c = classifyFloodAlert(p);
  if (!c.relevant) return null;
  return {
    event: p.event?.trim() || 'Flood alert',
    severity: p.severity,
    expires: p.expires,
    headline: p.headline ?? undefined,
    level: c.level,
    tags: c.tags,
    bullets: parseNwsBullets(p.description),
  };
}

// Products NWS issues for COASTAL zones only. Inside a coastal county the
// inland zones are left out on purpose — so when only the county outline
// placed one at the property, it can't carry its full level.
const COASTAL_ONLY_RE = /storm surge|tsunami|coastal flood|lakeshore flood/i;

/**
 * A hit placed only by the property's county outline (NWS's own point lookup
 * was unavailable). Coastal-only products are capped at Elevated: the county
 * matched, the warned coastal zone may well not.
 */
export function countyResolvedHit(hit: FloodAlertHit): FloodAlertHit {
  const capped = COASTAL_ONLY_RE.test(hit.event) && rank(hit.level) > rank('elevated');
  return { ...hit, countyResolved: true, level: capped ? 'elevated' : hit.level };
}

/** Worst matrix level first, then NWS severity; stable otherwise. Returns a copy. */
export function sortFloodAlerts(hits: FloodAlertHit[]): FloodAlertHit[] {
  return hits
    .slice()
    .sort((x, y) => rank(y.level) - rank(x.level) || severityRank(y.severity) - severityRank(x.severity));
}

/**
 * @param opts.countiesDown County shapes failed to load (fallback matching can't see county-based alerts).
 * @param opts.pointLookupDown NWS's point lookup failed, so hits were matched by polygon / county outline.
 * @param opts.unplaceable With the point lookup down, zone alerts for this property's area can't be
 *   placed at all (US territories: the county outlines don't cover them).
 */
export function buildFloodAlertsSection(
  hits: FloodAlertHit[],
  opts: { countiesDown: boolean; pointLookupDown?: boolean; unplaceable?: boolean }
): SectionResult {
  const sorted = sortFloodAlerts(hits);
  const level = sorted.reduce<RiskLevel>((acc, h) => maxLevel(acc, h.level), 'low');
  // One driver per distinct alert: a county under two river Flood Warnings
  // (two forecast points) would otherwise print the same line twice.
  const drivers: string[] = [];
  const counts = new Map<string, number>();
  for (const h of sorted) {
    const where = h.countyResolved
      ? COASTAL_ONLY_RE.test(h.event)
        ? " issued for coastal zones of the property's county — confirm the site is in the warned zone"
        : " issued for the property's county — confirm the site is in the warned area"
      : ' in effect at the property';
    const d = `${h.event}${where}${h.tags.includes('Flash Flood Emergency') ? ' — Flash Flood Emergency' : ''}`;
    if (!counts.has(d)) drivers.push(d);
    counts.set(d, (counts.get(d) ?? 0) + 1);
  }
  for (let i = 0; i < drivers.length; i++) {
    const n = counts.get(drivers[i]) ?? 1;
    if (n > 1) drivers[i] = `${drivers[i]} (${n} alerts)`;
  }
  const section: SectionResult = {
    id: 'alerts',
    title: FLOOD_SECTION_TITLES.alerts,
    level,
    drivers,
    // This section answers "how many, or none" — frame it that way.
    countLabel: hits.length === 0 ? 'None active' : `${hits.length} active`,
  };
  if (opts.pointLookupDown && opts.unplaceable && hits.length === 0) {
    section.unavailable =
      "NWS point lookup unavailable, and this area's zone-based alerts can't be placed from county outlines — flood alerts could not be checked";
    return section;
  }
  if (opts.pointLookupDown) {
    drivers.push('⚠ NWS point lookup unavailable — alerts matched by polygon and county outline, so a zone-based alert may not cover the site itself');
    if (opts.unplaceable) {
      drivers.push("⚠ This area's zone-based alerts (Flood Watches, Typhoon / Tropical Storm Warnings) can't be placed without the point lookup — more may be in effect");
    }
  }
  if (opts.countiesDown) {
    if (hits.length === 0) {
      // County shapes down = zone/county alerts (Flood Watches, river Flood
      // Warnings) can't be resolved; an empty result is not a verified all-clear.
      section.unavailable =
        'County geometry unavailable — county-based flood alerts (incl. Flood Watches and river Flood Warnings) could not be checked';
    } else {
      // A polygon hit (say a Flood Advisory) must not imply it is the whole
      // story when a county-based river Flood Warning could not be checked.
      drivers.push('⚠ County geometry unavailable — county-based flood alerts could not be checked; more may be in effect');
    }
  }
  return section;
}

// ── River gauges (NWPS) ──────────────────────────────────────────────────────

/** The worse of observed and NWS-forecast category (ties keep the observed value). */
export function gaugeTier(g: { cat: FloodCat; fcat: FloodCat | null }): FloodCat {
  return g.fcat && catSev(g.fcat) > catSev(g.cat) ? g.fcat : g.cat;
}

/** Ring × tier table from the matrix: what one gauge contributes to the section. */
export function gaugeLevel(g: Pick<GaugeHit, 'cat' | 'fcat' | 'distanceMi'>): RiskLevel {
  const sev = catSev(gaugeTier(g));
  const d = g.distanceMi;
  if (!(d >= 0)) return 'low';
  if (d <= 5) return (['low', 'guarded', 'elevated', 'high', 'critical'] as const)[sev] ?? 'low';
  if (d <= 25) return sev >= 4 ? 'high' : sev === 3 ? 'elevated' : sev === 2 ? 'guarded' : 'low';
  if (d <= 100) return sev >= 3 ? 'guarded' : 'low';
  return 'low';
}

/** Plain state for a driver, from the rivers layer's CAT: "Moderate flood", "Action stage", "Normal". */
export function gaugeStateLabel(c: FloodCat): string {
  const meta = CAT[c];
  if (!meta) return String(c);
  if (meta.sev >= 2) return `${meta.short} flood`;
  if (c === 'action') return `${meta.short} stage`;
  return meta.label.charAt(0) + meta.label.slice(1).toLowerCase();
}

/** "14:05 UTC Sep 29" — the report is shared across time zones. */
function fmtUtcShort(iso: string | null | undefined): string | null {
  const ms = typeof iso === 'string' ? Date.parse(iso) : NaN;
  if (!Number.isFinite(ms) || new Date(ms).getUTCFullYear() < 1900) return null;
  const d = new Date(ms);
  return `${d.toISOString().slice(11, 16)} UTC ${MONTHS[d.getUTCMonth()]} ${d.getUTCDate()}`;
}

/** "Action stage now, forecast Minor flood" — the forecast only when it differs. */
function gaugeStateText(g: Pick<GaugeHit, 'cat' | 'fcat' | 'offline'>, now: boolean): string {
  if (g.offline) {
    // No current reading: only the NWS forecast (if still current) speaks.
    const base = g.offline === 'out_of_service' ? 'out of service' : 'not reporting';
    return g.fcat && catSev(g.fcat) >= 1 ? `${base}, NWS forecast ${gaugeStateLabel(g.fcat)}` : base;
  }
  let s = `${gaugeStateLabel(g.cat)}${now ? ' now' : ''}`;
  if (g.fcat && g.fcat !== g.cat) {
    const f = gaugeStateLabel(g.fcat);
    if (catSev(g.fcat) > catSev(g.cat)) s += `, forecast ${f}`;
    else if (catSev(g.fcat) < catSev(g.cat)) s += `, forecast to fall to ${f}`;
  }
  return s;
}

const within = (gauges: GaugeHit[], mi: number) =>
  gauges.filter((g) => isNum(g.distanceMi) && g.distanceMi >= 0 && g.distanceMi <= mi);

/**
 * @param gauges Every NWPS forecast point within 100 mi, any order.
 * @param opts.inUs NWPS covers the US: outside it, "no gauges" is no coverage.
 */
export function buildGaugeSection(gauges: GaugeHit[], opts: { inUs: boolean }): SectionResult {
  const all = within(gauges, 100).sort((a, b) => a.distanceMi - b.distanceMi);
  const base = { id: 'gauges', title: FLOOD_SECTION_TITLES.gauges };
  if (all.length === 0) {
    if (!opts.inUs) return unavailableSection('gauges', 'NWPS river forecasts cover the US only');
    return { ...base, level: 'low', drivers: ['No NWPS forecast points within 100 mi'], countLabel: 'No gauges ≤100 mi' };
  }

  const scored = all.map((g) => ({ g, level: gaugeLevel(g), sev: catSev(gaugeTier(g)) }));
  const level = scored.reduce<RiskLevel>((acc, s) => maxLevel(acc, s.level), 'low');
  // Worst contribution first; a worse tier, then the closer gauge, breaks ties.
  const contributing = scored
    .filter((s) => s.level !== 'low')
    .sort((a, b) => rank(b.level) - rank(a.level) || b.sev - a.sev || a.g.distanceMi - b.g.distanceMi);
  const listed = contributing.slice(0, 3);
  const drivers = listed.map(({ g }) => `${g.name} (${fmtMi(g.distanceMi)} mi): ${gaugeStateText(g, true)}`);

  // Flooding gauges the drivers above don't name — incl. minor floods 25–100
  // mi out, which move no level but are the regional picture.
  const listedIds = new Set(listed.map((s) => s.g));
  const moreFlooding = scored.filter((s) => s.sev >= 2 && !listedIds.has(s.g));
  if (moreFlooding.length > 0) {
    const n = moreFlooding.length;
    // "At flood stage" is only literally true for an observed flood.
    const fc = moreFlooding.some((s) => catSev(s.g.cat) < 2) ? ' (observed or forecast)' : '';
    drivers.push(
      listed.length > 0
        ? `+${n} more ${plural(n, 'gauge')} at flood stage${fc} within 100 mi`
        : `${n} ${plural(n, 'gauge')} at flood stage${fc} 25–100 mi away`
    );
  }

  // Gauges that have gone dark near the property — common at a flood's peak
  // (power, telemetry, debris). One that still has a flooding NWS forecast
  // already speaks through the table above; the rest are a caveat that
  // reaches the bottom line whatever the level.
  // (A dark gauge that already contributes through its forecast is named above.)
  const dark = all.filter((g) => g.offline && g.distanceMi <= 25 && gaugeLevel(g) === 'low');
  for (const g of dark.slice(0, 3)) {
    const since = fmtUtcShort(g.obsTime);
    drivers.push(
      `⚠ ${g.name} (${fmtMi(g.distanceMi)} mi) ${g.offline === 'out_of_service' ? 'out of service' : 'not reporting'}` +
        `${since ? ` since ${since}` : ''} — river state there unknown`
    );
  }
  if (dark.length > 3) {
    const n = dark.length - 3;
    drivers.push(`⚠ +${n} more NWPS ${plural(n, 'gauge')} within 25 mi not reporting`);
  }

  if (level === 'low') {
    const reporting = all.filter((g) => !g.offline);
    const nearest = reporting[0];
    // Never call a farther gauge "nearest" while a closer one is dark.
    const qualifier = nearest && all[0] !== nearest ? 'Nearest reporting' : 'Nearest';
    if (nearest) {
      drivers.push(
        nearest.distanceMi <= 25
          ? `${qualifier} NWPS gauge: ${nearest.name} (${fmtMi(nearest.distanceMi)} mi) — ${gaugeStateText(nearest, false)}`
          : `No reporting NWPS gauge within 25 mi — nearest: ${nearest.name} (${fmtMi(nearest.distanceMi)} mi), ${gaugeStateText(nearest, false)}`
      );
    } else {
      drivers.push('⚠ Every NWPS gauge within 100 mi is out of service or not reporting');
    }
  }

  const flooding25 = scored.filter((s) => s.sev >= 2 && s.g.distanceMi <= 25).length;
  return {
    ...base,
    level,
    drivers,
    countLabel: flooding25 > 0 ? `${flooding25} in flood ≤25 mi` : 'None in flood ≤25 mi',
  };
}

/**
 * Gauges for the hydrograph cards: within 25 mi only — flooding tiers first
 * (worst, then nearest), then action stage, then the nearest whatever its
 * state; de-duplicated, at most `max`.
 */
export function pickDetailGauges(gauges: GaugeHit[], max = 3): GaugeHit[] {
  // A dark gauge is only worth a card while it still carries an NWS forecast.
  const near = within(gauges, 25)
    .filter((g) => !g.offline || catSev(g.fcat) >= 1)
    .sort((a, b) => a.distanceMi - b.distanceMi);
  const flooding = near
    .filter((g) => catSev(gaugeTier(g)) >= 2)
    .sort((a, b) => catSev(gaugeTier(b)) - catSev(gaugeTier(a)) || a.distanceMi - b.distanceMi);
  const action = near.filter((g) => gaugeTier(g) === 'action');
  const out: GaugeHit[] = [];
  const seen = new Set<string>();
  for (const g of [...flooding, ...action, ...near]) {
    if (out.length >= max) break;
    const key = g.lid || `${g.lat},${g.lon}`;
    if (seen.has(key)) continue;
    seen.add(key);
    out.push(g);
  }
  return out;
}

/** Ring exposure table: gauges inside each fixed ring and their observed / forecast states. */
export function floodRingCounts(gauges: GaugeHit[]): FloodRingCount[] {
  // Observed columns count reporting gauges only (a dark gauge has no reading);
  // an NWS forecast needs no live reading, so dark gauges still count there.
  const reporting = gauges.filter((g) => !g.offline);
  return RISK_RINGS.map((ring) => {
    const inside = within(reporting, ring.miles);
    const all = within(gauges, ring.miles);
    return {
      ring,
      gauges: inside.length,
      action: inside.filter((g) => g.cat === 'action').length,
      flooding: inside.filter((g) => catSev(g.cat) >= 2).length,
      forecastFlooding: all.filter((g) => catSev(g.fcat) >= 2).length,
      offline: all.length - inside.length,
    };
  });
}

// ── Excessive Rainfall Outlook (WPC, Days 1–5) ───────────────────────────────

/**
 * An outlook label → category. High before Moderate before Slight before
 * Marginal: the labels carry probabilities ("Moderate (At Least 40%)") and
 * the order keeps any future wording from matching a lower tier first.
 */
function eroFromText(s: string): EroCategory | null {
  const u = s.toUpperCase();
  if (/\bHIGH\b/.test(u)) return 4;
  if (/\bMODERATE\b|\bMDT\b/.test(u)) return 3;
  if (/\bSLIGHT\b|\bSLGT\b/.test(u)) return 2;
  if (/\bMARGINAL\b|\bMRGL\b/.test(u)) return 1;
  return null;
}

/** dn fallback: 1–4 as category codes, or the probability floors 0.05/0.15/0.40/0.70. */
function eroFromNumber(v: unknown): EroCategory | null {
  const n = typeof v === 'number' ? v : typeof v === 'string' && v.trim() !== '' ? Number(v) : NaN;
  if (!Number.isFinite(n)) return null;
  if (Number.isInteger(n) && n >= 1 && n <= 4) return n as EroCategory;
  const floors: [number, EroCategory][] = [[0.05, 1], [0.15, 2], [0.4, 3], [0.7, 4]];
  for (const [f, c] of floors) if (Math.abs(n - f) < 0.005) return c;
  return null;
}

/**
 * The WPC MapServer's `outlook` attribute ("Marginal (At Least 5%)", "SLGT",
 * …) → category, keys read case-insensitively, `dn` as the fallback. null =
 * unreadable: the caller treats it as unknown, never as "no risk".
 */
export function eroCategoryFromAttributes(attrs: Record<string, unknown>): EroCategory | null {
  if (!attrs || typeof attrs !== 'object') return null;
  const get = (name: string): unknown => {
    const k = Object.keys(attrs).find((x) => x.toLowerCase() === name);
    return k === undefined ? undefined : attrs[k];
  };
  const outlook = get('outlook');
  const fromOutlook =
    typeof outlook === 'string' ? eroFromText(outlook) : typeof outlook === 'number' ? eroFromNumber(outlook) : null;
  return fromOutlook ?? eroFromNumber(get('dn'));
}

/** Matrix rule for one ERO day: Day 1 counts most, Days 4–5 only at Moderate+. */
function eroDayLevel(day: number, c: EroCategory): RiskLevel {
  if (c === 0) return 'low';
  if (day <= 1) return c >= 3 ? 'high' : c === 2 ? 'elevated' : 'guarded';
  if (day <= 3) return c >= 3 ? 'elevated' : c === 2 ? 'guarded' : 'low';
  return c >= 3 ? 'guarded' : 'low';
}

/** A day whose period starts this soon is "the coming day", whatever WPC numbers it. */
const IMMINENT_MS = 12 * 3600_000;

/**
 * @param nowMs Overnight (after WPC's 01Z Day 1 update, before the ~09Z roll)
 *   Day 1 is only the rest of the night and "Day 2" is the coming daytime; a
 *   day whose period starts within 12 h of now is weighed with the Day 1 rule.
 */
export function buildEroSection(days: EroDay[], nowMs: number): SectionResult {
  const valid = (days ?? [])
    .filter((d) => d && Number.isInteger(d.day) && d.day >= 1 && d.day <= 5 && d.category in ERO_META)
    .sort((a, b) => a.day - b.day);
  if (valid.length === 0) return unavailableSection('ero', 'Excessive Rainfall Outlook returned no days for the property');

  const imminent = (d: EroDay) => d.day === 1 || (isNum(d.startMs) && d.startMs - nowMs <= IMMINENT_MS);
  let level: RiskLevel = 'low';
  const drivers: string[] = [];
  for (const d of valid) {
    level = maxLevel(level, eroDayLevel(imminent(d) ? 1 : d.day, d.category));
    if (d.category === 0) continue;
    const meta = ERO_META[d.category];
    if (d.day === 1) {
      drivers.push(`WPC Day 1: ${meta.label} risk (${meta.prob}) of excessive rainfall at the property`);
    } else if (imminent(d)) {
      drivers.push(`WPC Day ${d.day}, starting within 12 h: ${meta.label} risk (${meta.prob}) of excessive rainfall at the property`);
    } else {
      // Later days still print when they move no level ("driver only").
      const date = fmtEroDate(d.date);
      drivers.push(`${meta.label} risk flagged for Day ${d.day}${date ? ` (${date})` : ''}`);
    }
  }
  if (drivers.length === 0) {
    const first = valid[0].day;
    const last = valid[valid.length - 1].day;
    drivers.push(`No excessive-rainfall risk area over the property, ${first === last ? `Day ${first}` : `Days ${first}–${last}`}`);
  }
  const today = valid.find((d) => d.day === 1);
  // Overnight the section can be raised by a Day 2 starting within 12 h — the
  // chip must not say "None today" beside that level.
  const soon = valid.find((d) => d.day !== 1 && d.category > 0 && imminent(d));
  return {
    id: 'ero',
    title: FLOOD_SECTION_TITLES.ero,
    level,
    drivers,
    countLabel: !today
      ? 'Day 1 unknown'
      : today.category > 0
        ? `Day 1: ${ERO_META[today.category].short}`
        : soon
          ? `Day ${soon.day} (<12 h): ${ERO_META[soon.category].short}`
          : 'None today',
  };
}

// ── Rainfall: already fallen (antecedent) and forecast ──────────────────────

export interface AntecedentSummary {
  past24In?: number;
  past72In?: number;
  past7dIn?: number;
  days?: { date: string; precipIn: number }[];
}

/** Sum of values[from, to); null when any is missing — a hole is not a dry hour. */
function sumWindow(values: unknown[], from: number, to: number): number | null {
  if (from < 0 || to > values.length) return null;
  let s = 0;
  for (let i = from; i < to; i++) {
    const v = values[i];
    if (!isNum(v)) return null;
    s += v;
  }
  return round2(s);
}

/** 'YYYY-MM-DDTHH:MM' shifted by whole hours (local ISO strings, read as-is). */
function shiftHour(t: string, hours: number): string {
  const ms = Date.parse(`${t.slice(0, 16)}Z`);
  return Number.isFinite(ms) ? new Date(ms + hours * 3600_000).toISOString().slice(0, 16) : t;
}

/**
 * Open-Meteo's modelled past 7 days + forecast at the property → the
 * antecedent totals, the rain still to come, and the next-48 h timing window.
 * Hourly times are local ('YYYY-MM-DDTHH:MM') and each value is the PRECEDING
 * hour's sum, so the entry stamped with the current hour is the last complete
 * past hour and everything after it is still to come — no hour is counted as
 * both fallen and forecast. "Now" is placed in the property's local time via
 * the response's own UTC offset. Never throws: a total that can't be computed
 * from what arrived (a hole in the series, a window past its end) is omitted
 * rather than guessed.
 */
export function summarizePrecip(
  resp: FloodPrecipResponse,
  nowMs: number
): {
  antecedent: AntecedentSummary;
  /** Rain still to come, from the current hour: 24 / 48 / 72 h and 5 days. */
  forecast: { in24?: number; in48?: number; in72?: number; in120?: number };
  hourlyNext48: { times: string[]; precipIn: number[]; probPct: (number | null)[] } | null;
} {
  const antecedent: AntecedentSummary = {};
  const forecast: { in24?: number; in48?: number; in72?: number; in120?: number } = {};
  let hourlyNext48: { times: string[]; precipIn: number[]; probPct: (number | null)[] } | null = null;
  const off = isNum(resp?.utcOffsetSeconds) ? resp.utcOffsetSeconds : 0;
  const localNow = new Date(nowMs + off * 1000);
  if (Number.isNaN(localNow.getTime())) return { antecedent, forecast, hourlyNext48 };
  const localIso = localNow.toISOString();
  const curHour = localIso.slice(0, 13);
  const today = localIso.slice(0, 10);

  // ── Hourly: past 24 / 72 h, what's still to come, the next 48 h ──────────
  const times = Array.isArray(resp?.hourly?.time) ? resp.hourly.time : [];
  const precip: unknown[] = Array.isArray(resp?.hourly?.precipIn) ? resp.hourly.precipIn : [];
  const prob: unknown[] = Array.isArray(resp?.hourly?.probPct) ? resp.hourly.probPct : [];
  // First entry at or after the current hour; -1 = the series ends before
  // now (stale), so nothing can be placed.
  const c = times.findIndex((t) => typeof t === 'string' && t.slice(0, 13) >= curHour);
  if (c >= 0) {
    // The entry stamped with the current hour closes the last complete hour.
    const split = times[c].slice(0, 13) === curHour ? c + 1 : c;
    const p24 = sumWindow(precip, split - 24, split);
    const p72 = sumWindow(precip, split - 72, split);
    if (p24 !== null) antecedent.past24In = p24;
    if (p72 !== null) antecedent.past72In = p72;

    for (const [key, h] of [['in24', 24], ['in48', 48], ['in72', 72], ['in120', 120]] as const) {
      const v = sumWindow(precip, split, split + h);
      if (v !== null) forecast[key] = v;
    }

    const n = Math.min(48, times.length - split, precip.length - split);
    if (n >= 6) {
      hourlyNext48 = {
        // Labelled by the hour each bar covers (its entry is stamped at the end).
        times: times.slice(split, split + n).map((t) => shiftHour(t, -1)),
        // Chart only (thresholds never read these): a missing hour draws as no bar.
        precipIn: precip.slice(split, split + n).map((v) => (isNum(v) ? v : 0)),
        probPct: Array.from({ length: n }, (_, i) => {
          const v = prob[split + i];
          return isNum(v) ? v : null;
        }),
      };
    }
  }

  // ── Daily: the 7 complete days before today, and today (partial) ─────────
  const dTimes = Array.isArray(resp?.daily?.time) ? resp.daily.time : [];
  const dPrecip: unknown[] = Array.isArray(resp?.daily?.precipIn) ? resp.daily.precipIn : [];
  const ti = dTimes.indexOf(today);
  if (ti >= 0) {
    const p7 = sumWindow(dPrecip, ti - 7, ti);
    if (p7 !== null) antecedent.past7dIn = p7;
    const days: { date: string; precipIn: number }[] = [];
    for (let i = Math.max(0, ti - 7); i <= ti; i++) {
      const v = dPrecip[i];
      if (typeof dTimes[i] === 'string' && isNum(v)) days.push({ date: dTimes[i], precipIn: v });
    }
    if (days.length > 0) antecedent.days = days;
  }
  return { antecedent, forecast, hourlyNext48 };
}

/** Recent (modelled) rainfall — how wet the ground already is. */
export function buildAntecedentSection(a: AntecedentSummary): SectionResult {
  const p72 = isNum(a?.past72In) ? a.past72In : undefined;
  const p7 = isNum(a?.past7dIn) ? a.past7dIn : undefined;
  if (p72 === undefined && p7 === undefined) {
    return unavailableSection('antecedent', 'Recent rainfall could not be computed from the model series');
  }
  let level: RiskLevel = 'low';
  const drivers: string[] = [];
  if (p72 !== undefined && p72 >= 4) {
    level = 'elevated';
    drivers.push(`${fmtInches(p72)} in over the past 72 h — soils saturated, new rain runs off fast`);
  } else if (p72 !== undefined && p72 >= 2) {
    level = 'guarded';
    drivers.push(`${fmtInches(p72)} in over the past 72 h — soils likely saturated`);
  }
  if (p7 !== undefined && p7 >= 3) {
    level = maxLevel(level, 'guarded');
    drivers.push(`${fmtInches(p7)} in over the past 7 days — ground already wet`);
  }
  if (drivers.length === 0) {
    drivers.push(
      p7 !== undefined ? `${fmtInches(p7)} in over the past 7 days` : `${fmtInches(p72!)} in over the past 72 h`
    );
  }
  // One window missing (a gap in the model series) is said, not implied dry.
  if (p72 === undefined) drivers.push('Past-72 h total unavailable (gap in the model series)');
  else if (p7 === undefined) drivers.push('Past-7-day total unavailable (gap in the model series)');
  return { id: 'antecedent', title: FLOOD_SECTION_TITLES.antecedent, level, drivers };
}

// Forecast windows, in the order drivers name them. The 5-day total only
// reaches Guarded: a week-out total spread over days is a heads-up, not a flood.
const RAIN_WINDOWS: { key: 'in24' | 'in72' | 'in120'; high: number; elevated: number; guarded: number }[] = [
  { key: 'in24', high: 4, elevated: 2, guarded: 1 },
  { key: 'in72', high: 6, elevated: 4, guarded: 2 },
  { key: 'in120', high: Infinity, elevated: Infinity, guarded: 3 },
];

type RainKey = 'in24' | 'in48' | 'in72' | 'in120';

/**
 * Window wording per source, as the phrase after "forecast". The daily
 * fallback is whole calendar days from TOMORROW (today's total already holds
 * rain that has fallen), so it can't claim "next 24 h".
 */
function rainWindowPhrase(key: RainKey, source: FloodReportData['rain']['source']): string {
  if (source === 'daily') {
    return {
      in24: 'for tomorrow',
      in48: 'for the 2 days from tomorrow',
      in72: 'for the 3 days from tomorrow',
      in120: 'for the 5 days from tomorrow',
    }[key];
  }
  return { in24: 'in the next 24 h', in48: 'in the next 48 h', in72: 'in the next 72 h', in120: 'in the next 5 days' }[key];
}

const RAIN_SOURCE_SUFFIX: Record<NonNullable<FloodReportData['rain']['source']>, string> = {
  wpc: ' (WPC)',
  hourly: ' (Open-Meteo hourly forecast)',
  daily: ' (daily forecast)',
};

/** Wet-ground escalator input: past 72 h ≥ 2 in or past 7 days ≥ 3 in. */
function wetGround(a: AntecedentSummary | null): string | null {
  if (!a) return null;
  if (isNum(a.past72In) && a.past72In >= 2) return `${fmtInches(a.past72In)} in over the past 72 h`;
  if (isNum(a.past7dIn) && a.past7dIn >= 3) return `${fmtInches(a.past7dIn)} in over the past 7 days`;
  return null;
}

/**
 * @param antecedent null = recent rainfall unavailable: the wet-ground
 *   escalator can't be applied, and a non-Low level says so.
 */
export function buildRainSection(rain: FloodReportData['rain'], antecedent: AntecedentSummary | null): SectionResult {
  if (rain.unavailable) return unavailableSection('rain', rain.unavailable);
  const src = rain.source ? RAIN_SOURCE_SUFFIX[rain.source] : '';
  const scored = RAIN_WINDOWS.flatMap((w) => {
    const v = rain[w.key];
    if (!isNum(v)) return [];
    const level: RiskLevel = v >= w.high ? 'high' : v >= w.elevated ? 'elevated' : v >= w.guarded ? 'guarded' : 'low';
    return [{ w, v, level }];
  });
  if (scored.length === 0 && !isNum(rain.in48)) {
    return unavailableSection('rain', 'No rainfall point values returned for the property');
  }

  let level = scored.reduce<RiskLevel>((acc, s) => maxLevel(acc, s.level), 'low');
  const drivers: string[] = [];
  if (level !== 'low') {
    // Name the window(s) that set the level.
    for (const s of scored) {
      if (s.level === level) drivers.push(`${fmtInches(s.v)} in forecast ${rainWindowPhrase(s.w.key, rain.source)}${src}`);
    }
    // Wet-ground escalator: the same rain on saturated soil floods sooner.
    // Unknown wetness (feed down, or a series too holed to total) is said,
    // never taken for dry ground.
    // Dry ground is only known when BOTH totals are in and below their
    // thresholds: with one missing, the other window could still be wet.
    const wet = wetGround(antecedent);
    const wetKnown = wet !== null || (antecedent !== null && isNum(antecedent.past72In) && isNum(antecedent.past7dIn));
    if (wet) {
      level = bumpLevel(level);
      drivers.push(`Ground already wet (${wet}) — rainfall level raised one step`);
    } else if (!wetKnown) {
      drivers.push('⚠ Recent rainfall unavailable — if the ground is already wet this level would be one step higher');
    }
  } else {
    // Context at Low: the longest window we have.
    const ctx: RainKey[] = ['in72', 'in48', 'in24'];
    const key = ctx.find((k) => isNum(rain[k]));
    if (key) {
      const v = rain[key] as number;
      const phrase = rainWindowPhrase(key, rain.source);
      drivers.push(
        v >= 0.005 ? `${fmtInches(v)} in forecast ${phrase}${src}` : `No measurable rain forecast ${phrase}${src}`
      );
    }
  }
  return { id: 'rain', title: FLOOD_SECTION_TITLES.rain, level, drivers };
}

// ── FEMA flood zone (NFHL) ───────────────────────────────────────────────────

const zoneCode = (z: { zone: string }) => (z.zone ?? '').trim().toUpperCase();

/** The NFHL polygon at the property, in plain English. */
export function describeFemaZone(z: NonNullable<FemaZoneResponse['atSite']>): FemaSiteZone {
  const zone = zoneCode(z);
  // FEMA's "AREA NOT INCLUDED" (outside the study) starts with an A, which
  // femaZoneClass's zone-letter test would read as SFHA — it is unmapped.
  const notIncluded = zone === 'AREA NOT INCLUDED';
  const cls = notIncluded ? 'other' : femaZoneClass(z);
  const tag = `Zone ${zone}`;
  let label: string;
  switch (cls) {
    case 'floodway':
      label = `Regulatory floodway (${tag})`;
      break;
    case 'coastal':
      label = `Coastal high-hazard area, wave action (${tag})`;
      break;
    case 'sfha':
      label =
        zone === 'AO' ? `1%-annual-chance shallow flooding, sheet flow (${tag})`
        : zone === 'AH' ? `1%-annual-chance shallow flooding, ponding (${tag})`
        : zone === 'AR' ? `1%-annual-chance floodplain, levee being restored (${tag})`
        : zone === 'A99' ? `1%-annual-chance floodplain, levee under construction (${tag})`
        : `1%-annual-chance floodplain (${tag})`;
      break;
    case 'moderate': {
      const where = zone === 'X' ? 'Zone X, shaded' : tag;
      const sub = (z.subtype ?? '').toUpperCase();
      // Shaded X is also where FEMA puts 1% flooding it keeps outside the
      // SFHA — shallow, small-drainage or future-conditions — say which.
      label =
        sub.includes('0.2 PCT') || zone !== 'X' ? `0.2%-annual-chance floodplain (${where})`
        : sub.includes('DEPTH') ? `1%-annual-chance flooding under 1 ft deep (${where})`
        : sub.includes('DRAINAGE') ? `1%-annual-chance flooding, drainage under 1 sq mi (${where})`
        : sub.includes('FUTURE') ? `1%-annual-chance floodplain under future conditions (${where})`
        : `Moderate flood hazard (${where})`;
      break;
    }
    case 'levee':
      label = `Levee-reduced risk (${tag})`;
      break;
    case 'minimal':
      label = `Minimal flood hazard (${tag})`;
      break;
    case 'undetermined':
      label = `Undetermined flood hazard (${tag})`;
      break;
    case 'water':
      label = 'Open water';
      break;
    default:
      label = notIncluded ? 'Area not included in the FEMA flood study' : zone ? `FEMA ${tag}` : 'Unlabelled FEMA zone';
  }
  const num = (v: unknown) => (isNum(v) && v > -9000 ? v : null); // -9999 = FEMA "none"
  return {
    zone: z.zone,
    subtype: z.subtype ?? null,
    // Trust FEMA's SFHA flag, and the zone letter when the flag is missing.
    sfha: !notIncluded && (!!z.sfha || cls === 'floodway' || cls === 'coastal' || cls === 'sfha'),
    label,
    floodway: cls === 'floodway',
    coastal: zone.startsWith('V'),
    bfeFt: num(z.bfeFt),
    depthFt: num(z.depthFt),
    datum: z.datum?.trim() || null,
  };
}

/** "Zone AE" chip; the shaded X gets its qualifier so it can't read as minimal. */
function femaCountLabel(site: FemaSiteZone): string {
  const cls = femaZoneClass(site);
  const zone = zoneCode(site);
  if (cls === 'water') return 'Open water';
  if (cls === 'moderate' && zone === 'X') return 'Zone X (shaded)';
  return zone ? `Zone ${zone}` : 'Zone unknown';
}

const FEMA_NO_MAP = 'No digital FEMA flood map (NFHL) at this location — the area may be unmapped or on a paper FIRM';

/**
 * FEMA zone section + the report's fema block. Static exposure: an SFHA zone
 * is Guarded at most on its own — it escalates the live signals instead
 * (computeFloodOverall).
 */
export function buildFemaSection(resp: FemaZoneResponse): { section: SectionResult; fema: FloodReportData['fema'] } {
  const nearestSfhaMi = isNum(resp?.nearestSfhaMi) ? resp.nearestSfhaMi : null;
  if (!resp?.covered) {
    return { section: unavailableSection('fema', FEMA_NO_MAP), fema: { atSite: null, nearestSfhaMi, unavailable: FEMA_NO_MAP } };
  }
  if (!resp.atSite) {
    const reason = resp.truncated
      ? 'No mapped FEMA flood zone at the property point (the zone query hit its record cap — zones may be missing)'
      : 'No mapped FEMA flood zone at the property point';
    return { section: unavailableSection('fema', reason), fema: { atSite: null, nearestSfhaMi, unavailable: reason } };
  }

  const site = describeFemaZone(resp.atSite);
  const zone = zoneCode(site);
  if (zone === 'AREA NOT INCLUDED') {
    // Outside the study area FEMA assigns no zone — unmapped, not safe.
    const reason = 'Property is in an area not included in the FEMA flood study — no flood zone assigned';
    return { section: unavailableSection('fema', reason), fema: { atSite: site, nearestSfhaMi, unavailable: reason } };
  }

  let level: RiskLevel = 'low';
  const drivers: string[] = [];
  if (site.sfha) {
    level = 'guarded';
    if (site.floodway) {
      drivers.push(`Property is in the regulatory floodway (Zone ${zone}) — the channel that carries the deepest, fastest floodwater`);
    }
    if (site.coastal) {
      drivers.push(`Property is in a coastal high-hazard area (Zone ${zone}) — exposed to storm-surge waves of 3 ft or more`);
    }
    if (!site.floodway && !site.coastal) {
      drivers.push(`Property is in the ${site.label.charAt(0).toLowerCase()}${site.label.slice(1)} — about a 1-in-4 chance of flooding over 30 years`);
    }
    if (site.bfeFt !== null) drivers.push(`Base flood elevation ${Math.round(site.bfeFt).toLocaleString('en-US')} ft${site.datum ? ` (${site.datum})` : ''}`);
    if (site.depthFt !== null && site.depthFt > 0) drivers.push(`Base flood depth ${site.depthFt} ft`);
  } else {
    const cls = femaZoneClass(site);
    drivers.push(
      cls === 'undetermined' ? `${site.label} — flood risk not studied, not ruled out`
      : cls === 'levee' ? `${site.label} — residual risk if the levee is overtopped or fails`
      : site.label
    );
    if (nearestSfhaMi !== null && nearestSfhaMi > 0 && nearestSfhaMi <= 0.25) {
      drivers.push(`Nearest 1%-annual-chance floodplain ${fmtMi(nearestSfhaMi)} mi away`);
    }
  }
  if (resp.truncated) {
    drivers.push("⚠ FEMA's zone query hit its record cap — zones near the property (and the nearest-floodplain distance) may be missing");
  }
  if (resp.envelopeUnavailable) {
    drivers.push('⚠ Zone map around the property unavailable — distance to the nearest floodplain not checked');
  }
  if (resp.mapTrimmed) {
    drivers.push("Zone map trimmed for size — the farthest zones aren't drawn (distances use FEMA's full shapes)");
  }

  return {
    section: { id: 'fema', title: FLOOD_SECTION_TITLES.fema, level, drivers, countLabel: femaCountLabel(site) },
    fema: { atSite: site, nearestSfhaMi },
  };
}

// ── Burn scars (post-fire runoff) ────────────────────────────────────────────

export interface BurnScarInput {
  name?: string;
  acres?: number;
  /** Polygon rings as [lon, lat]. */
  rings: number[][][];
}

const MI_PER_DEG = 69.093; // mean Earth radius 3958.8 mi × π/180

/**
 * Distance from the property to one perimeter in miles: 0 inside (even-odd
 * over every ring, so a point in an unburned island is outside), else the
 * nearest edge. Local equirectangular about the property — within the 10 mi
 * that matters its error is far below the perimeters' own accuracy.
 */
function scarDistanceMi(target: { lat: number; lon: number }, rings: number[][][]): number | null {
  const kx = Math.cos((target.lat * Math.PI) / 180) * MI_PER_DEG;
  const proj = (p: number[]): [number, number] | null => {
    if (!Array.isArray(p) || !isNum(p[0]) || !isNum(p[1])) return null;
    let dLon = p[0] - target.lon;
    dLon -= 360 * Math.round(dLon / 360); // the shorter way across the antimeridian
    return [dLon * kx, (p[1] - target.lat) * MI_PER_DEG];
  };
  let inside = false;
  let best = Infinity;
  for (const ring of Array.isArray(rings) ? rings : []) {
    const pts = (Array.isArray(ring) ? ring : []).map(proj).filter((p): p is [number, number] => p !== null);
    if (pts.length < 2) continue;
    for (let i = 0, j = pts.length - 1; i < pts.length; j = i++) {
      const [ax, ay] = pts[j];
      const [bx, by] = pts[i];
      // Even-odd crossing of the ray from the property (origin) toward +x.
      if (ay > 0 !== by > 0 && 0 < ax + ((bx - ax) * (0 - ay)) / (by - ay)) inside = !inside;
      const dx = bx - ax;
      const dy = by - ay;
      const len2 = dx * dx + dy * dy;
      const t = len2 > 0 ? Math.max(0, Math.min(1, -(ax * dx + ay * dy) / len2)) : 0;
      best = Math.min(best, Math.hypot(ax + t * dx, ay + t * dy));
    }
  }
  if (inside) return 0;
  return Number.isFinite(best) ? best : null;
}

export function nearestBurnScar(
  target: { lat: number; lon: number },
  scars: BurnScarInput[]
): { within10: number; nearestMi?: number; nearestName?: string } {
  let within10 = 0;
  let nearestMi: number | undefined;
  let nearestName: string | undefined;
  for (const s of scars ?? []) {
    const d = scarDistanceMi(target, s?.rings);
    if (d === null) continue;
    if (d <= 10) within10++;
    if (nearestMi === undefined || d < nearestMi) {
      nearestMi = d;
      nearestName = s.name?.trim() || undefined;
    }
  }
  const out: { within10: number; nearestMi?: number; nearestName?: string } = { within10 };
  if (nearestMi !== undefined) out.nearestMi = nearestMi;
  if (nearestName !== undefined) out.nearestName = nearestName;
  return out;
}

/**
 * Is rain coming to a burn scar? any = Day 1–3 ERO ≥ Marginal or 72 h QPF ≥
 * 0.5 in; strong = Day 1–2 ERO ≥ Slight or 24 h QPF ≥ 1 in. `unknown` when
 * neither the outlook nor a rainfall forecast is available — "no signal" is
 * then not the same as "no rain".
 */
export function rainSignalFrom(
  ero: EroDay[] | undefined,
  rain: FloodReportData['rain']
): { any: boolean; strong: boolean; unknown: boolean } {
  const eroMax = (maxDay: number) =>
    (ero ?? []).reduce((m, d) => (d && d.day >= 1 && d.day <= maxDay ? Math.max(m, d.category) : m), 0);
  const q: FloodReportData['rain'] = rain && !rain.unavailable ? rain : {};
  const strong = eroMax(2) >= 2 || (isNum(q.in24) && q.in24 >= 1);
  const any = strong || eroMax(3) >= 1 || (isNum(q.in72) && q.in72 >= 0.5);
  const unknown = !ero?.length && !isNum(q.in24) && !isNum(q.in72);
  return { any, strong, unknown };
}

const BURN_WHY = 'burned ground sheds rain fast — flash floods and debris flows follow far smaller storms';

/**
 * @param opts.truncated The perimeter query hit its record cap — a scar near
 *   the property may be missing, so "none within 10 mi" can't be claimed.
 * @param opts.yearStart Early in the year: the perimeter archive restarts each
 *   January, so last year's scars (the riskiest) are not in it.
 */
export function buildBurnScarSection(
  s: ReturnType<typeof nearestBurnScar>,
  rain: { any: boolean; strong: boolean; unknown?: boolean },
  opts: { truncated?: boolean; yearStart?: boolean } = {}
): SectionResult {
  const base = { id: 'burn-scars', title: FLOOD_SECTION_TITLES['burn-scars'] };
  const d = s.nearestMi;
  const yearNote = opts.yearStart ? ["⚠ The fire-perimeter archive restarts each January — last year's burn scars are not included"] : [];
  if (s.within10 === 0 || d === undefined || d > 10) {
    if (opts.truncated) {
      return unavailableSection('burn-scars', 'Fire-perimeter list hit its record cap — a burn scar near the property may be missing');
    }
    const drivers = ["No burn scar from this year's fires within 10 mi"];
    if (d !== undefined && d <= 100) {
      drivers.push(`Nearest: ${s.nearestName ?? 'unnamed fire'} burn scar ${d < 20 ? fmtMi(d) : Math.round(d)} mi away`);
    }
    return { ...base, level: 'low', drivers: [...drivers, ...yearNote] };
  }

  const name = s.nearestName ?? 'An unnamed fire';
  const drivers = [
    d === 0
      ? `Property is inside the ${s.nearestName ?? 'unnamed'} burn scar: ${BURN_WHY}`
      : `${name} burn scar ${fmtMi(d)} mi away: ${BURN_WHY}`,
  ];
  let level: RiskLevel = 'guarded';
  if (d <= 2 && rain.strong) {
    level = 'high';
    drivers.push('Heavy rain signal in the next 48 h (WPC outlook Slight or higher, or ≥1 in forecast in 24 h)');
  } else if (rain.any) {
    level = 'elevated';
    drivers.push('Rain signal in the next 72 h (WPC outlook Marginal or higher, or ≥0.5 in forecast)');
  } else if (rain.unknown) {
    drivers.push('⚠ Rain signal unknown (outlook and rainfall forecast unavailable) — with rain coming this would be Elevated or higher');
  }
  if (s.within10 > 1) drivers.push(`${s.within10} burn scars from this year's fires within 10 mi`);
  if (opts.truncated) drivers.push('⚠ Fire-perimeter list hit its record cap — other scars nearby may be missing');
  return { ...base, level, drivers: [...drivers, ...yearNote] };
}

// ── River discharge forecast (GloFAS) ────────────────────────────────────────

// Today plus the next 10 days: GloFAS's ensemble skill fades past ~10 days
// for all but the largest rivers, and a day-15 peak must not carry the same
// weight as tomorrow's.
const FORECAST_DAYS = 11;
/** Below this 2-year flow the model cell is a creek GloFAS can't resolve meaningfully. */
const MINOR_STREAM_M3S = 5;

/**
 * @param opts.todayIso GloFAS's own (UTC) day; the window is today and the next 10 days.
 * @param opts.forecastGauge The nearest NWPS point within 25 mi that carries a
 *   current NWS river forecast — when there is one, the official forecast
 *   leads and the model is capped at Guarded. A gauge with no forecast (or no
 *   flood thresholds) caps nothing: it says nothing about where the river goes.
 */
export function buildDischargeSection(
  d: FloodDischargeResponse,
  opts: {
    todayIso: string;
    forecastGauge: { name: string; distanceMi: number } | null;
    /** false = the NWPS list itself is down or warming: "no official forecast" can't be claimed. */
    gaugesKnown?: boolean;
  }
): SectionResult {
  const th = d?.thresholds;
  if (!th || !isNum(th.rp2) || !isNum(th.rp5) || !isNum(th.rp20)) {
    return unavailableSection('discharge', 'GloFAS return-period thresholds unavailable — discharge shown for trend only');
  }
  const base = { id: 'discharge', title: FLOOD_SECTION_TITLES.discharge };
  if (th.rp2 < MINOR_STREAM_M3S) {
    return {
      ...base,
      level: 'low',
      drivers: [`Nearest model river cell carries a minor stream (2-yr flow ${fmtFlow(th.rp2)} m³/s) — not assessed`],
    };
  }

  const time = Array.isArray(d.time) ? d.time : [];
  const idxs: number[] = [];
  for (let i = 0; i < time.length && idxs.length < FORECAST_DAYS; i++) {
    if (typeof time[i] === 'string' && time[i].slice(0, 10) >= opts.todayIso) idxs.push(i);
  }
  const peakOf = (series: Array<number | null> | undefined) => {
    let best: { v: number; date: string } | null = null;
    for (const i of idxs) {
      const v = series?.[i];
      if (isNum(v) && (!best || v > best.v)) best = { v, date: time[i] };
    }
    return best;
  };
  const med = peakOf(d.median);
  if (!med) return unavailableSection('discharge', 'GloFAS ensemble forecast missing for the coming days');
  const mx = peakOf(d.max);

  const thresholds: [number, string, RiskLevel][] = [
    [th.rp20, '20-year', 'high'],
    [th.rp5, '5-year', 'elevated'],
    [th.rp2, '2-year', 'guarded'],
  ];
  const on = (p: { date: string }) => {
    const date = fmtMonthDay(p.date);
    return date ? ` on ${date}` : '';
  };
  let level: RiskLevel = 'low';
  const drivers: string[] = [];
  const hit = thresholds.find(([flow]) => med.v >= flow);
  if (hit) {
    level = hit[2];
    drivers.push(`Model peak ${fmtFlow(med.v)} m³/s${on(med)} — above the ${hit[1]} flow (${fmtFlow(hit[0])} m³/s)`);
  } else if (mx && mx.v >= th.rp5) {
    // The median stays below the 2-year flow but part of the ensemble floods.
    level = 'guarded';
    drivers.push(`Some ensemble members reach ${fmtFlow(mx.v)} m³/s${on(mx)} — above the 5-year flow (${fmtFlow(th.rp5)} m³/s)`);
  } else {
    drivers.push(`Model peak ${fmtFlow(med.v)} m³/s${on(med)} — below the 2-year flow (${fmtFlow(th.rp2)} m³/s)`);
  }

  // The official NWS river forecast leads wherever one is issued close by.
  const fg = opts.forecastGauge;
  if (fg && level !== 'low') {
    const capped = rank(level) > rank('guarded');
    if (capped) level = 'guarded';
    const who = `the official NWS river forecast at ${fg.name} (${fmtMi(fg.distanceMi)} mi)`;
    drivers.push(capped ? `Capped at Guarded — ${who} leads` : `${who.charAt(0).toUpperCase()}${who.slice(1)} leads`);
  } else if (!fg && level !== 'low') {
    drivers.push(
      opts.gaugesKnown === false
        ? 'NWPS gauges unavailable — could not check for an official NWS river forecast nearby'
        : 'Model only — no official NWS river forecast within 25 mi'
    );
  }
  return { ...base, level, drivers };
}

// ── Overall ──────────────────────────────────────────────────────────────────

/** Short SFHA name for the escalator driver. */
function sfhaPlain(z: FemaSiteZone): string {
  if (z.floodway) return 'regulatory floodway';
  if (z.coastal) return 'coastal high-hazard area';
  return '1%-annual-chance floodplain';
}

/**
 * Worst AVAILABLE section, every non-Low driver in section order, the SFHA
 * escalator, and the incomplete-picture line. Never throws: when every
 * section is unavailable the assembler decides what to do.
 */
export function computeFloodOverall(
  sections: SectionResult[],
  sfha: FemaSiteZone | null
): { level: RiskLevel; drivers: string[] } {
  const available = sections.filter((s) => !s.unavailable);
  let level = available.reduce<RiskLevel>((acc, s) => maxLevel(acc, s.level), 'low');
  const isLive = (s: SectionResult) => (FLOOD_LIVE_SECTIONS as readonly string[]).includes(s.id);
  // Non-Low sections bring every driver; a Low live section still brings its
  // ⚠ caveats (a gauge gone dark, an alert lookup that fell back to county
  // outlines) — a blind spot must never read as a calm day.
  const drivers = available.flatMap((s) =>
    s.level !== 'low' ? s.drivers : isLive(s) ? s.drivers.filter((d) => d.startsWith('⚠')) : []
  );

  // SFHA escalator: static exposure multiplies the live signals — a Flood
  // Warning means more to a house in Zone AE than to one on the ridge above it.
  const liveHot = available.some((s) => isLive(s) && rank(s.level) >= rank('elevated'));
  if (sfha?.sfha && liveHot) {
    const raised = level !== 'critical';
    level = bumpLevel(level);
    drivers.unshift(
      `Property sits in FEMA Zone ${zoneCode(sfha)} (${sfhaPlain(sfha)}) with live flood signals at Elevated or above` +
        (raised ? ' — overall raised one level' : '')
    );
  }

  const down = sections.filter((s) => s.unavailable).length;
  if (down > 0) drivers.push(`⚠ ${down} ${plural(down, 'feed')} unavailable — this picture is incomplete`);
  return { level, drivers };
}
