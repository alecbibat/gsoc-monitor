import type { FloodCat, FloodDischargeResponse, RiverSeriesPoint, RiverThreshold } from '../types';
import { CAT, catColor, catLabel, catSev } from '../layers/rivers/riverMeta';
import { ERO_META, type EroCategory, type EroDay, type FloodReportData, type GaugeDetailView } from './floodTypes';
import { BURN_SCAR_STYLE, FEMA_CLASS_ORDER, FEMA_CLASS_STYLE } from './floodPalette';
import { RISK_LEVELS } from './riskTypes';
import { fmtTs, qpfHex } from './reportParts';
import { ChipStrip, shortDayDate, type LegendItem } from './reportVisuals';

// ── Flood report visuals ─────────────────────────────────────────────────────
// Pure SVG/JSX renderers over data assembleFlood.ts already fetched — the
// flood analog of reportVisuals.tsx, printed through the same pipeline. Every
// chart is an SVG with a viewBox at width 100% (crisp at any page width).
// Meaning-carrying colors are inline attributes/styles, which the print theme
// keeps; neutral ink (axes, labels, the forecast line) is `currentColor`, which
// the print theme flips from white-on-dark to ink-on-paper — a hard-coded
// white would vanish on paper. Nothing hides behind hover: every value a
// reader needs is printed.

// Observed/past series color: reads on the dark screen and on white paper, and
// collides with no flood-category color (the forecast line is neutral ink).
const OBS_COLOR = '#38bdf8';

const isNum = (v: unknown): v is number => typeof v === 'number' && Number.isFinite(v);

/** "18", "18.5", "0.25" — threshold labels drop trailing zeros. */
const trimNum = (v: number, digits = 2) => String(Number(v.toFixed(digits)));

/** m³/s: "3.2", "980", "1,240". */
const fmtFlow = (v: number) => (v < 10 ? v.toFixed(1) : Math.round(v).toLocaleString('en-US'));

/** Inches for chart summaries: "0 in", "<0.01 in", "0.42 in". */
const fmtIn = (v: number) => (v < 0.005 ? '0 in' : v < 0.01 ? '<0.01 in' : `${v.toFixed(2)} in`);

/**
 * A gauge reading in its own unit. Stage to the hundredth (how NWS reports it
 * — it matters a foot below flood stage); kcfs as the rivers panel prints it.
 */
export function fmtGaugeValue(v: number | null | undefined, unit: string): string {
  if (!isNum(v)) return '—';
  if (unit === 'kcfs') return v >= 100 ? Math.round(v).toLocaleString('en-US') : v >= 10 ? v.toFixed(1) : v.toFixed(2);
  return Math.abs(v) >= 1000 ? v.toFixed(0) : v.toFixed(2);
}

/**
 * NWPS timestamps → epoch ms; null for unparseable values and the
 * "0001-01-01T00:00:00Z" sentinel NWPS sends for "no time".
 */
function parseTime(iso: string | null | undefined): number | null {
  if (typeof iso !== 'string' || !iso) return null;
  const ms = Date.parse(iso);
  if (Number.isNaN(ms) || new Date(ms).getUTCFullYear() < 1900) return null;
  return ms;
}

const fmtGaugeTime = (iso: string | null | undefined) => (parseTime(iso) === null ? null : fmtTs(iso as string));

/** Crest dates carry the year — a record from 1937 must say so. */
function fmtLongDate(iso: string | null | undefined): string | null {
  const ms = parseTime(iso);
  return ms === null
    ? null
    : new Date(ms).toLocaleDateString('en-US', { year: 'numeric', month: 'short', day: 'numeric' });
}

// ISO calendar dates are read as calendar dates (UTC), so a label can never
// drift a day with the viewer's time zone.
const WEEKDAYS = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];
function isoParts(iso: string): [number, number, number] | null {
  const m = /^(\d{4})-(\d{2})-(\d{2})/.exec(iso ?? '');
  return m ? [+m[1], +m[2] - 1, +m[3]] : null;
}
const isoWeekday = (iso: string) => {
  const p = isoParts(iso);
  return p ? WEEKDAYS[new Date(Date.UTC(p[0], p[1], p[2])).getUTCDay()] : iso;
};
const isoMonthDay = (iso: string) => {
  const p = isoParts(iso);
  return p ? `${p[1] + 1}/${p[2]}` : iso;
};

// ── Axis helpers ─────────────────────────────────────────────────────────────

/** 1 / 2 / 2.5 / 5 × 10ⁿ step covering `raw`. */
function niceStep(raw: number): number {
  if (!(raw > 0) || !Number.isFinite(raw)) return 1;
  const p = Math.pow(10, Math.floor(Math.log10(raw)));
  const f = raw / p;
  return (f <= 1 ? 1 : f <= 2 ? 2 : f <= 2.5 ? 2.5 : f <= 5 ? 5 : 10) * p;
}

/** Round tick values inside [lo, hi], about `target` of them. */
function niceTicks(lo: number, hi: number, target = 4): number[] {
  const step = niceStep((hi - lo) / target);
  const out: number[] = [];
  for (let v = Math.ceil(lo / step) * step; v <= hi + step * 1e-9 && out.length < 24; v += step) {
    out.push(Number(v.toPrecision(12)));
  }
  return out;
}

/** The smallest round value ≥ v (the top of a zero-based axis). */
const niceCeil = (v: number) => {
  const step = niceStep(v / 4);
  return Math.ceil(v / step - 1e-9) * step;
};

const tickLabel = (v: number) => String(Number(v.toFixed(3)));

/**
 * Right-edge label positions (y ascending = top first) spread at least `gap`
 * apart inside [lo, hi], so two close flood stages never print on top of
 * each other.
 */
function spreadLabels(ys: number[], gap: number, lo: number, hi: number): number[] {
  const out = ys.map((y) => Math.min(Math.max(y, lo), hi));
  for (let i = 1; i < out.length; i++) out[i] = Math.max(out[i], out[i - 1] + gap);
  if (out.length > 0) out[out.length - 1] = Math.min(out[out.length - 1], hi);
  for (let i = out.length - 2; i >= 0; i--) out[i] = Math.min(out[i], out[i + 1] - gap);
  return out;
}

/** "Mon 9/28" / "9/28" at the viewer's local midnight (hydrograph epoch series). */
function localMidnights(t0: number, t1: number): number[] {
  const out: number[] = [];
  const d = new Date(t0 * 1000);
  if (Number.isNaN(d.getTime())) return out;
  d.setHours(24, 0, 0, 0); // next local midnight
  while (d.getTime() / 1000 <= t1 && out.length < 120) {
    out.push(d.getTime() / 1000);
    d.setDate(d.getDate() + 1);
  }
  return out;
}

/** Short line swatch for an HTML legend — the same SVG stroke the chart draws. */
function LineSwatch({ color = 'currentColor', dash, width = 2 }: { color?: string; dash?: string; width?: number }) {
  return (
    <svg width="18" height="6" viewBox="0 0 18 6" className="print-color inline-block shrink-0" aria-hidden="true">
      <line x1="1" x2="17" y1="3" y2="3" stroke={color} strokeWidth={width} strokeDasharray={dash} strokeLinecap="round" />
    </svg>
  );
}

/** Filled swatch for a band (ensemble range). */
function BandSwatch({ color, opacity }: { color: string; opacity: number }) {
  return (
    <svg width="14" height="8" viewBox="0 0 14 8" className="print-color inline-block shrink-0" aria-hidden="true">
      <rect x="0" y="0" width="14" height="8" rx="1.5" fill={color} fillOpacity={opacity} />
    </svg>
  );
}

// ── Flood-category chip ──────────────────────────────────────────────────────
// The rivers layer's CAT colors, so a gauge reads the same on the globe, the
// hero map and every table in the report.

export function CatChip({ cat, short = false }: { cat: FloodCat; short?: boolean }) {
  const color = catColor(cat);
  return (
    <span
      className="print-color inline-flex items-center whitespace-nowrap rounded-full border px-1.5 py-px text-[9px] font-bold uppercase tracking-wider"
      style={{ color, background: `${color}1f`, borderColor: `${color}66` }}
    >
      {short ? CAT[cat]?.short ?? cat : catLabel(cat)}
    </span>
  );
}

// ── Legends ──────────────────────────────────────────────────────────────────

/** WPC outlook risk areas, weakest first (the Day 1 map draws only these four). */
export const ERO_LEGEND: LegendItem[] = ([1, 2, 3, 4] as const).map((c) => ({
  color: ERO_META[c].hex,
  label: `${ERO_META[c].label} (${ERO_META[c].prob})`,
}));

/**
 * FEMA NFHL classes, highest hazard first (the map paints them in reverse).
 * Minimal (X) is drawn on the map as an outline only, so its swatch is a line.
 */
export const FEMA_LEGEND: LegendItem[] = FEMA_CLASS_ORDER.slice()
  .reverse()
  .filter((c) => c !== 'other')
  .map((c) => {
    const st = FEMA_CLASS_STYLE[c];
    if (st.fill === null) return { color: st.stroke, label: st.label, line: true };
    return st.hatch ? { color: st.stroke, label: st.label, hatch: true } : { color: st.fill, label: st.label };
  });

/** Hero-map gauge dots, worst first — the worse of observed and NWS forecast. */
export const GAUGE_LEGEND: LegendItem[] = (['major', 'moderate', 'minor', 'action', 'normal'] as const).map((c) => ({
  color: CAT[c].color,
  label: CAT[c].label,
}));

/** The hatched current-season perimeters on the hero map. */
export const BURN_SCAR_LEGEND: LegendItem = { color: BURN_SCAR_STYLE.color, label: BURN_SCAR_STYLE.label, hatch: true };

// ── Excessive Rainfall Outlook strip ─────────────────────────────────────────

export function EroStrip({ days }: { days: EroDay[] }) {
  const valid = (Array.isArray(days) ? days : [])
    .filter((d) => d && Number.isInteger(d.day) && d.category in ERO_META)
    .sort((a, b) => a.day - b.day);
  return (
    <ChipStrip
      cells={valid.map((d) => {
        const meta = ERO_META[d.category as EroCategory];
        return {
          top: d.day === 1 ? 'Today' : d.date ? shortDayDate(d.date) : `Day ${d.day}`,
          hex: meta.hex,
          bottom: meta.label,
          emph: d.category >= 2,
        };
      })}
    />
  );
}

// ── Gauge hydrograph ─────────────────────────────────────────────────────────
// Observed stage (solid) and the NWS forecast (dashed) against the gauge's
// flood stages. The y scale reaches the NEXT flood stage above the data — the
// one to watch — and stages beyond it are listed under the chart rather than
// flattening the hydrograph into a line at the bottom.

interface Pt {
  t: number;
  v: number;
}

const finitePts = (s: RiverSeriesPoint[] | undefined): Pt[] =>
  (Array.isArray(s) ? s : [])
    .filter((p) => p && isNum(p.t) && isNum(p.v))
    .map((p) => ({ t: p.t, v: p.v }))
    .sort((a, b) => a.t - b.t);

/** Flow-primary gauges classify on flow thresholds, stage gauges on stage. */
export const isFlowGauge = (d: Pick<GaugeDetailView, 'unit' | 'primaryName'>) =>
  (d.unit ?? '').trim().toLowerCase() === 'kcfs' || (d.primaryName ?? '').trim().toLowerCase() === 'flow';

/** Flood-stage lines in the gauge's primary unit, lowest first. */
export function gaugeThresholdLines(d: GaugeDetailView): { cat: RiverThreshold['cat']; value: number }[] {
  const flow = isFlowGauge(d);
  return (Array.isArray(d.thresholds) ? d.thresholds : [])
    .map((t) => ({ cat: t.cat, value: flow ? t.flow : t.stage }))
    .filter((t): t is { cat: RiverThreshold['cat']; value: number } => isNum(t.value) && t.cat in CAT)
    .sort((a, b) => a.value - b.value);
}

/** At least two plottable points — below that there is no hydrograph to draw. */
export const hasHydrograph = (d: GaugeDetailView) =>
  finitePts(d.observedSeries).length + finitePts(d.forecastSeries).length >= 2;

export function HydrographChart({ detail }: { detail: GaugeDetailView }) {
  const obs = finitePts(detail.observedSeries);
  const fc = finitePts(detail.forecastSeries);
  const all = [...obs, ...fc];
  if (all.length < 2) return null;

  const flow = isFlowGauge(detail);
  const unit = detail.unit || (flow ? 'kcfs' : 'ft');
  const W = 640;
  const H = 230;
  const PAD_L = 42;
  const PAD_R = 88; // flood-stage labels ("Moderate 22.5 ft") at the right edge
  const PAD_T = 24; // "now" label + crest label headroom
  const PAD_B = 22; // day labels
  const plotW = W - PAD_L - PAD_R;
  const plotH = H - PAD_T - PAD_B;

  const crestV = isNum(detail.crest?.value) ? detail.crest.value : null;
  const dataMin = Math.min(...all.map((p) => p.v));
  const dataMax = Math.max(...all.map((p) => p.v), crestV ?? -Infinity);
  const lines = gaugeThresholdLines(detail);
  const nextAbove = lines.find((l) => l.value > dataMax);
  const onScale = lines.filter((l) => l.value <= dataMax || l === nextAbove);
  const offScale = lines.filter((l) => !onScale.includes(l));

  let vMin = Math.min(dataMin, ...onScale.map((l) => l.value));
  let vMax = Math.max(dataMax, ...onScale.map((l) => l.value));
  const pad = Math.max((vMax - vMin) * 0.1, Math.abs(vMax) * 0.02, flow ? 0.05 : 0.3);
  vMin -= pad;
  vMax += pad;
  // Flow can't go negative — don't draw an axis that suggests it.
  if (flow && dataMin >= 0) vMin = Math.max(0, vMin);

  const tMin = Math.min(...all.map((p) => p.t));
  const tMax = Math.max(...all.map((p) => p.t));
  const tSpan = tMax - tMin || 1;
  const X = (t: number) => PAD_L + ((Math.min(Math.max(t, tMin), tMax) - tMin) / tSpan) * plotW;
  const Y = (v: number) => PAD_T + (1 - (v - vMin) / (vMax - vMin || 1)) * plotH;
  const toPath = (pts: Pt[]) => pts.map((p, i) => `${i ? 'L' : 'M'}${X(p.t).toFixed(1)},${Y(p.v).toFixed(1)}`).join(' ');

  // The forecast joins the last observation; a gauge with no observed window
  // draws the forecast on its own.
  const fcPath = fc.length ? (obs.length ? [obs[obs.length - 1], ...fc] : fc) : [];
  // "now" = the latest observation (NWPS observes every 15–60 min).
  const nowT = obs.length ? obs[obs.length - 1].t : fc[0].t;

  // Crest: NWPS's crest time, else the forecast series' own peak.
  const crestT = (() => {
    const ms = parseTime(detail.crest?.time);
    if (ms !== null) return ms / 1000;
    return fc.length ? fc.reduce((b, p) => (p.v > b.v ? p : b)).t : null;
  })();
  const showCrest = crestV !== null && crestT !== null && crestT >= tMin - 3600 && crestT <= tMax + 3600;
  const crestCat = detail.crest?.cat ?? null;
  const crestColor = crestCat && catSev(crestCat) >= 1 ? catColor(crestCat) : 'currentColor';

  const yTicks = niceTicks(vMin, vMax, 4);
  const labelYs = spreadLabels(onScale.map((l) => Y(l.value)).reverse(), 10, PAD_T, H - PAD_B).reverse();

  // Day ticks at local midnight; thinned so labels never collide.
  const midnights = localMidnights(tMin, tMax);
  const spanDays = (tMax - tMin) / 86_400;
  const every = Math.max(1, Math.ceil(midnights.length / 7));
  const dayFmt = (t: number) =>
    new Date(t * 1000).toLocaleDateString(
      'en-US',
      spanDays <= 8 ? { weekday: 'short', month: 'numeric', day: 'numeric' } : { month: 'numeric', day: 'numeric' }
    );

  return (
    <div className="print-card overflow-x-auto rounded-lg border border-white/8 bg-white/4 p-2">
      <svg viewBox={`0 0 ${W} ${H}`} className="print-color min-w-[520px] text-white" style={{ width: '100%' }}>
        {/* Flood-category bands above each stage, faint — "in flood" reads as a zone */}
        {onScale.map((l, i) => {
          const top = i + 1 < onScale.length ? Y(onScale[i + 1].value) : PAD_T;
          const y0 = Math.max(PAD_T, Math.min(Y(l.value), H - PAD_B));
          return (
            <rect key={`band-${l.cat}`} x={PAD_L} width={plotW} y={top} height={Math.max(0, y0 - top)} fill={catColor(l.cat)} fillOpacity={0.08} />
          );
        })}
        {yTicks.map((v) => (
          <g key={`y-${v}`}>
            <line x1={PAD_L} x2={PAD_L + plotW} y1={Y(v)} y2={Y(v)} stroke="currentColor" strokeOpacity={0.08} strokeWidth="1" />
            <text x={PAD_L - 4} y={Y(v) + 3} textAnchor="end" fontSize="8" fill="currentColor" fillOpacity={0.45}>{tickLabel(v)}</text>
          </g>
        ))}
        <text x={4} y={PAD_T - 10} fontSize="8" fontWeight="600" fill="currentColor" fillOpacity={0.55}>
          {`${detail.primaryName || (flow ? 'Flow' : 'Stage')} (${unit})`}
        </text>
        {/* Day separators + labels */}
        {midnights.map((t, i) => {
          const x = X(t);
          const labeled = i % every === 0 && x - PAD_L > 14 && PAD_L + plotW - x > 14;
          return (
            <g key={`d-${t}`}>
              <line x1={x} x2={x} y1={PAD_T} y2={H - PAD_B} stroke="currentColor" strokeOpacity={0.07} strokeWidth="1" />
              {labeled && (
                <text x={x} y={H - PAD_B + 12} textAnchor="middle" fontSize="8" fill="currentColor" fillOpacity={0.5}>{dayFmt(t)}</text>
              )}
            </g>
          );
        })}
        {midnights.length === 0 && (
          <>
            <text x={PAD_L} y={H - PAD_B + 12} fontSize="8" fill="currentColor" fillOpacity={0.5}>{fmtTs(new Date(tMin * 1000).toISOString())}</text>
            <text x={PAD_L + plotW} y={H - PAD_B + 12} textAnchor="end" fontSize="8" fill="currentColor" fillOpacity={0.5}>
              {fmtTs(new Date(tMax * 1000).toISOString())}
            </text>
          </>
        )}
        {/* Flood-stage lines, labeled at the right edge */}
        {onScale.map((l, i) => (
          <g key={`th-${l.cat}`}>
            <line x1={PAD_L} x2={PAD_L + plotW} y1={Y(l.value)} y2={Y(l.value)} stroke={catColor(l.cat)} strokeWidth="1.3" strokeOpacity={0.9} />
            <text x={PAD_L + plotW + 4} y={labelYs[i] + 3} fontSize="8" fontWeight="600" fill={catColor(l.cat)}>
              {`${CAT[l.cat].short} ${trimNum(l.value)} ${unit}`}
            </text>
          </g>
        ))}
        {/* "now" marker */}
        <line x1={X(nowT)} x2={X(nowT)} y1={PAD_T - 4} y2={H - PAD_B} stroke="currentColor" strokeOpacity={0.45} strokeWidth="1" strokeDasharray="3 3" />
        <text x={X(nowT)} y={PAD_T - 7} textAnchor="middle" fontSize="8" fontWeight="600" fill="currentColor" fillOpacity={0.7}>now</text>
        {/* Series */}
        {obs.length >= 2 && <path d={toPath(obs)} fill="none" stroke={OBS_COLOR} strokeWidth="2" strokeLinejoin="round" />}
        {obs.length === 1 && <circle cx={X(obs[0].t)} cy={Y(obs[0].v)} r="2.5" fill={OBS_COLOR} />}
        {fcPath.length > 1 && (
          <path d={toPath(fcPath)} fill="none" stroke="currentColor" strokeOpacity={0.85} strokeWidth="2" strokeDasharray="5 3" strokeLinejoin="round" />
        )}
        {/* Forecast crest */}
        {showCrest && crestV !== null && crestT !== null && (() => {
          const cx = X(crestT);
          const cy = Y(crestV);
          const above = cy - 12 >= PAD_T + 2;
          const lx = Math.min(Math.max(cx, PAD_L + 44), PAD_L + plotW - 44);
          const label = `Crest ${fmtGaugeValue(crestV, unit)} ${unit}${crestCat && catSev(crestCat) >= 1 ? ` · ${CAT[crestCat].short}` : ''}`;
          return (
            <g>
              <path d={`M${cx.toFixed(1)},${(cy - 2).toFixed(1)} l-4,-7 l8,0 z`} fill={crestColor} stroke="currentColor" strokeOpacity={0.6} strokeWidth="0.8" />
              <text x={lx} y={above ? cy - 12 : cy + 14} textAnchor="middle" fontSize="8.5" fontWeight="700" fill={crestColor}>
                {label}
              </text>
            </g>
          );
        })()}
      </svg>
      <div className="mt-1 flex flex-wrap items-center gap-x-4 gap-y-1 px-1 text-[9px] text-white/50">
        <span className="flex items-center gap-1.5"><LineSwatch color={OBS_COLOR} /> observed</span>
        {fc.length > 0 && <span className="flex items-center gap-1.5"><LineSwatch dash="4 2" /> NWS forecast</span>}
        {lines.length > 0 && <span>colored lines = flood stages</span>}
        {showCrest && <span>▼ forecast crest</span>}
        {offScale.length > 0 && (
          <span className="text-white/40">
            Above chart: {offScale.map((l) => `${CAT[l.cat].short} ${trimNum(l.value)} ${unit}`).join(' · ')}
          </span>
        )}
      </div>
    </div>
  );
}

// ── Gauge forecast card ──────────────────────────────────────────────────────
// Everything the NWS publishes for one forecast point, printed: where the
// river is, where it's going, what that stage floods, and how it compares to
// the record.

const TREND: Record<'rising' | 'falling' | 'steady', { sym: string; label: string; color: string | null }> = {
  rising: { sym: '▲', label: 'Rising', color: '#fb7185' },
  falling: { sym: '▼', label: 'Falling', color: OBS_COLOR },
  steady: { sym: '▬', label: 'Steady', color: null },
};

export function GaugeDetailCard({ detail }: { detail: GaugeDetailView }) {
  const flow = isFlowGauge(detail);
  const unit = detail.unit || (flow ? 'kcfs' : 'ft');
  const obsV = isNum(detail.observed?.value) ? detail.observed.value : null;
  const obsCat = detail.observed?.cat ?? null;
  const crestV = isNum(detail.crest?.value) ? detail.crest.value : null;
  const crestCat = detail.crest?.cat ?? null;
  const obsTime = fmtGaugeTime(detail.observed?.time);
  const crestTime = fmtGaugeTime(detail.crest?.time);
  const trend = detail.trend ? TREND[detail.trend] : null;
  const lines = gaugeThresholdLines(detail);

  // NWS impact statements and crest history are keyed to river STAGE (ft).
  // On a flow-primary point they can't be compared with the kcfs forecast, so
  // they print without the "reached" highlight rather than a wrong one.
  const impactUnit = flow ? 'ft' : unit;
  const ref = flow ? null : crestV !== null ? { v: crestV, what: 'forecast crest' } : obsV !== null ? { v: obsV, what: 'current stage' } : null;
  const impacts = (Array.isArray(detail.impacts) ? detail.impacts : [])
    .filter((im) => im && isNum(im.stage) && typeof im.statement === 'string' && im.statement.trim())
    .slice()
    .sort((a, b) => b.stage - a.stage); // NWS order: highest stage first
  const reached = (stage: number) => ref !== null && stage <= ref.v;

  const record = detail.recordCrest && isNum(detail.recordCrest.stage) ? detail.recordCrest : null;
  const recordDate = record ? fmtLongDate(record.time) : null;

  return (
    <div className="print-card space-y-2.5 rounded-lg border border-white/8 bg-white/4 p-3">
      <div className="flex flex-wrap items-baseline gap-x-3 gap-y-0.5">
        <span className="text-[13px] font-semibold text-white/90">{detail.name || detail.lid}</span>
        <span className="text-[11px] text-white/45">
          {isNum(detail.distanceMi) ? `${detail.distanceMi.toFixed(1)} mi from the property` : 'distance unknown'} · NWPS {detail.lid}
        </span>
      </div>

      <div className="grid gap-2 sm:grid-cols-2">
        {/* Observed */}
        <div className="rounded-md border border-white/8 px-3 py-2">
          <div className="text-[9px] font-bold uppercase tracking-[0.14em] text-white/35 print-muted">
            Observed {(detail.primaryName || (flow ? 'Flow' : 'Stage')).toLowerCase()}
          </div>
          <div className="mt-0.5 flex flex-wrap items-baseline gap-x-2 gap-y-1">
            <span
              className="print-color text-[18px] font-bold tabular-nums"
              style={obsCat ? { color: catColor(obsCat) } : undefined}
            >
              {fmtGaugeValue(obsV, unit)}
            </span>
            <span className="text-[11px] text-white/50">{unit}</span>
            {obsCat && <CatChip cat={obsCat} />}
            {trend && (
              <span
                className={`text-[11px] font-semibold ${trend.color ? 'print-color' : 'text-white/55'}`}
                style={trend.color ? { color: trend.color } : undefined}
              >
                {trend.sym} {trend.label}
              </span>
            )}
          </div>
          <div className="mt-0.5 text-[10px] text-white/40 print-muted">{obsTime ?? 'observation time unknown'}</div>
        </div>

        {/* Forecast crest */}
        <div className="rounded-md border border-white/8 px-3 py-2">
          <div className="text-[9px] font-bold uppercase tracking-[0.14em] text-white/35 print-muted">NWS forecast crest</div>
          {crestV !== null ? (
            <>
              <div className="mt-0.5 flex flex-wrap items-baseline gap-x-2 gap-y-1">
                <span
                  className="print-color text-[18px] font-bold tabular-nums"
                  style={crestCat ? { color: catColor(crestCat) } : undefined}
                >
                  {fmtGaugeValue(crestV, unit)}
                </span>
                <span className="text-[11px] text-white/50">{unit}</span>
                {crestCat && <CatChip cat={crestCat} />}
              </div>
              <div className="mt-0.5 text-[10px] text-white/40 print-muted">{crestTime ?? 'crest time not given'}</div>
            </>
          ) : (
            <p className="mt-1 text-[11px] text-white/50">No NWS forecast issued for this point — observed only.</p>
          )}
        </div>
      </div>

      {hasHydrograph(detail) ? (
        <HydrographChart detail={detail} />
      ) : (
        <p className="rounded-md border border-white/8 px-3 py-2 text-[11px] text-white/45">
          No hydrograph series returned for this gauge.
        </p>
      )}
      {lines.length === 0 && (
        <p className="text-[10px] text-white/45">
          No flood stages are defined for this gauge — its level is monitored but not flood-classified.
        </p>
      )}

      {impacts.length > 0 && (
        <div>
          <div className="mb-1 text-[9px] font-bold uppercase tracking-[0.14em] text-white/35 print-muted">
            NWS flood impacts{ref ? ` — ● = reached at the ${ref.what} (${fmtGaugeValue(ref.v, unit)} ${unit})` : ''}
          </div>
          {flow && (
            <p className="mb-1 text-[10px] text-white/40">
              Impact statements are keyed to river stage (ft); this point forecasts flow ({unit}), so they are listed for reference.
            </p>
          )}
          <ul className="space-y-1">
            {impacts.map((im, i) => {
              const hit = reached(im.stage);
              return (
                <li
                  key={i}
                  className={`flex gap-2 rounded px-2 py-1 text-[11px] leading-snug ${hit ? 'print-color border-l-2 text-white/85' : 'text-white/55'}`}
                  style={hit ? { background: 'rgba(249,115,22,0.12)', borderLeftColor: '#f97316' } : undefined}
                >
                  <span className="w-3 shrink-0 font-bold" aria-label={hit ? 'reached' : undefined}>{hit ? '●' : ''}</span>
                  <span className="w-14 shrink-0 font-mono font-semibold text-white/75">
                    {`${trimNum(im.stage)} ${impactUnit}`}
                  </span>
                  <span>{im.statement.trim()}</span>
                </li>
              );
            })}
          </ul>
        </div>
      )}

      {(record || detail.forecastReliability || detail.inServiceMsg) && (
        <dl className="grid grid-cols-[auto_1fr] gap-x-3 gap-y-1 border-t border-white/8 pt-2 text-[11px]">
          {record && (
            <>
              <dt className="text-white/40">Record crest</dt>
              <dd className="text-white/70">{`${trimNum(record.stage)} ${impactUnit}${recordDate ? ` · ${recordDate}` : ''}`}</dd>
            </>
          )}
          {detail.forecastReliability && (
            <>
              <dt className="text-white/40">Forecast reliability</dt>
              <dd className="text-white/60">{detail.forecastReliability}</dd>
            </>
          )}
          {detail.inServiceMsg && (
            <>
              <dt className="print-color font-semibold" style={{ color: '#fcd34d' }}>⚠ Out of service</dt>
              <dd className="print-color" style={{ color: '#fcd34d' }}>{detail.inServiceMsg}</dd>
            </>
          )}
        </dl>
      )}
    </div>
  );
}

// ── 48-hour rain timing chart ────────────────────────────────────────────────
// Hourly bars in the WPC ramp (same colors as the rainfall map and chips) with
// the chance of precipitation as a thin line on its own 0–100% scale. Hours
// are local time at the property (the feed's own clock), like WindChart.

const hourLabel = (iso: string) => {
  const hh = Number(iso.slice(11, 13));
  if (Number.isNaN(hh)) return '';
  if (hh === 0) return '12a';
  if (hh === 12) return '12p';
  return hh < 12 ? `${hh}a` : `${hh - 12}p`;
};

export function RainTimingChart({ hourly }: { hourly: NonNullable<FloodReportData['hourlyRain']> }) {
  const times = Array.isArray(hourly?.times) ? hourly.times : [];
  const n = Math.min(times.length, Array.isArray(hourly?.precipIn) ? hourly.precipIn.length : 0);
  if (n === 0) return null;
  const rain = hourly.precipIn.slice(0, n).map((v) => (isNum(v) && v > 0 ? v : 0));
  const prob = Array.from({ length: n }, (_, i) => {
    const v = hourly.probPct?.[i];
    return isNum(v) ? Math.min(100, Math.max(0, v)) : null;
  });
  const hasProb = prob.some((p) => p !== null);

  const W = 640;
  const H = 170;
  const PAD_L = 34;
  const PAD_R = hasProb ? 32 : 8;
  const PAD_T = 12;
  const PAD_B = 30; // two axis rows: hours + day labels
  const plotW = W - PAD_L - PAD_R;
  const plotH = H - PAD_T - PAD_B;
  const peak = Math.max(...rain);
  const top = niceCeil(Math.max(0.25, peak * 1.1));
  const slot = plotW / n;
  const barW = Math.max(1, slot * 0.72);
  const cx = (i: number) => PAD_L + (i + 0.5) * slot;
  const Y = (inches: number) => PAD_T + plotH - (Math.min(inches, top) / top) * plotH;
  const Yp = (pct: number) => PAD_T + plotH - (pct / 100) * plotH;

  // Probability as path segments, broken wherever an hour has no value.
  const probPath = prob
    .map((p, i) => (p === null ? null : `${i === 0 || prob[i - 1] === null ? 'M' : 'L'}${cx(i).toFixed(1)},${Yp(p).toFixed(1)}`))
    .filter(Boolean)
    .join(' ');

  const todayLocal = times[0]?.slice(0, 10);
  const dayLabel = (iso: string) =>
    iso.slice(0, 10) === todayLocal ? 'Today' : `${isoWeekday(iso)} ${isoMonthDay(iso)}`;
  const dayStarts = times
    .slice(0, n)
    .map((t, i) => ({ t, i }))
    .filter(({ t, i }) => i === 0 || t.slice(11, 13) === '00');

  const total = rain.reduce((a, v) => a + v, 0);
  const peakIdx = rain.indexOf(peak);
  const yTicks = niceTicks(0, top, 4).filter((v) => v > 0);

  return (
    <div className="print-card overflow-x-auto rounded-lg border border-white/8 bg-white/4 p-2">
      <svg viewBox={`0 0 ${W} ${H}`} className="print-color min-w-[520px] text-white" style={{ width: '100%' }}>
        {yTicks.map((v) => (
          <g key={v}>
            <line x1={PAD_L} x2={PAD_L + plotW} y1={Y(v)} y2={Y(v)} stroke="currentColor" strokeOpacity={0.08} strokeWidth="1" />
            <text x={PAD_L - 4} y={Y(v) + 3} textAnchor="end" fontSize="8" fill="currentColor" fillOpacity={0.45}>{tickLabel(v)}</text>
          </g>
        ))}
        <text x={4} y={PAD_T - 2} fontSize="8" fontWeight="600" fill="currentColor" fillOpacity={0.55}>in/h</text>
        <line x1={PAD_L} x2={PAD_L + plotW} y1={Y(0)} y2={Y(0)} stroke="currentColor" strokeOpacity={0.25} strokeWidth="1" />
        {hasProb && [0, 50, 100].map((p) => (
          <text key={`p-${p}`} x={PAD_L + plotW + 4} y={Yp(p) + 3} fontSize="8" fill="currentColor" fillOpacity={0.45}>{p}%</text>
        ))}
        {/* Day separators at local midnight */}
        {dayStarts.map(({ t, i }) =>
          i === 0 ? null : (
            <line key={`sep-${t}`} x1={PAD_L + i * slot} x2={PAD_L + i * slot} y1={PAD_T} y2={H - PAD_B} stroke="currentColor" strokeOpacity={0.14} strokeWidth="1" strokeDasharray="2 3" />
          )
        )}
        {rain.map((v, i) =>
          v <= 0 ? null : (
            <rect key={`b-${i}`} x={cx(i) - barW / 2} y={Y(v)} width={barW} height={Math.max(0.8, Y(0) - Y(v))} fill={qpfHex(v)} />
          )
        )}
        {hasProb && probPath && (
          <path d={probPath} fill="none" stroke="currentColor" strokeOpacity={0.6} strokeWidth="1.2" strokeLinejoin="round" />
        )}
        {/* Hour ticks */}
        {times.slice(0, n).map((t, i) =>
          i % 6 === 0 ? (
            <text key={`h-${t}`} x={cx(i)} y={H - 17} textAnchor="middle" fontSize="8" fill="currentColor" fillOpacity={0.45}>
              {hourLabel(t)}
            </text>
          ) : null
        )}
        {/* Day labels under the hours */}
        {dayStarts.map(({ t, i }) => (
          <text key={`day-${t}`} x={PAD_L + i * slot + 2} y={H - 5} textAnchor="start" fontSize="9" fontWeight="600" fill="currentColor" fillOpacity={0.65}>
            {dayLabel(t)}
          </text>
        ))}
      </svg>
      <div className="mt-1 flex flex-wrap items-center gap-x-4 gap-y-1 px-1 text-[9px] text-white/50">
        <span className="flex items-center gap-1.5">
          <BandSwatch color={qpfHex(0.3)} opacity={1} /> hourly rain (in, WPC ramp colors)
        </span>
        {hasProb && (
          <span className="flex items-center gap-1.5">
            <LineSwatch width={1.4} /> chance of precipitation (%)
          </span>
        )}
        <span className="text-white/60">
          {n} h total {fmtIn(total)}
          {peak > 0 && ` · heaviest hour ${fmtIn(peak)} (${hourLabel(times[peakIdx])} ${dayLabel(times[peakIdx])})`}
        </span>
        <span className="text-white/35">local time at the property</span>
      </div>
    </div>
  );
}

// ── Recent rainfall ledger ───────────────────────────────────────────────────
// The past 7 days + today as bars in the WPC ramp: how wet the ground already
// is. Today is still accumulating, so it's marked partial and kept out of the
// 7-day total.

export function RainLedger({ days, todayIso }: { days: { date: string; precipIn: number }[]; todayIso?: string }) {
  const rows = (Array.isArray(days) ? days : []).filter((d) => d && typeof d.date === 'string' && isNum(d.precipIn));
  if (rows.length === 0) return null;
  // The contract puts today last; a caller that knows the property's local
  // date (the hourly feed's first hour) passes it so a missing today can't
  // mislabel yesterday as partial.
  const today = todayIso ?? rows[rows.length - 1].date;
  const max = Math.max(0.5, ...rows.map((d) => d.precipIn));
  const BAR_H = 56;
  const complete = rows.filter((d) => d.date < today);
  const completeTotal = complete.reduce((a, d) => a + d.precipIn, 0);
  const todayRow = rows.find((d) => d.date === today);

  return (
    <div className="print-card rounded-lg border border-white/8 bg-white/4 px-2 py-3">
      <div className="grid gap-1" style={{ gridTemplateColumns: `repeat(${rows.length}, minmax(0, 1fr))` }}>
        {rows.map((d) => {
          const isToday = d.date === today;
          const hPct = d.precipIn < 0.005 ? 0 : Math.max(4, (d.precipIn / max) * 100);
          return (
            <div
              key={d.date}
              className={`flex flex-col items-center gap-1 rounded-md px-0.5 py-1 ${isToday ? 'border border-dashed border-white/25' : ''}`}
            >
              <div className="text-[10px] font-semibold text-white/60">{isToday ? 'Today' : isoWeekday(d.date)}</div>
              <div className="text-[8px] text-white/35">{isoMonthDay(d.date)}</div>
              <div className="relative w-4" style={{ height: BAR_H }}>
                <div className="absolute inset-0 rounded-sm bg-white/6" />
                <div
                  className="print-color absolute inset-x-0 bottom-0 rounded-sm"
                  style={{ height: `${hPct}%`, background: qpfHex(d.precipIn) }}
                />
              </div>
              <div className={`text-[9px] tabular-nums ${d.precipIn >= 0.5 ? 'font-bold text-white/85' : 'text-white/55'}`}>
                {fmtIn(d.precipIn)}
              </div>
              {isToday && <div className="text-[8px] italic text-white/40">partial</div>}
            </div>
          );
        })}
      </div>
      <p className="mt-2 px-1 text-[9px] text-white/50">
        {complete.length === 7
          ? `Past 7 days: ${fmtIn(completeTotal)}`
          : `${fmtIn(completeTotal)} over the ${complete.length} complete ${complete.length === 1 ? 'day' : 'days'} with data (of 7)`}
        {todayRow ? ` · today so far: ${fmtIn(todayRow.precipIn)} (partial day)` : ''}
      </p>
    </div>
  );
}

// ── River discharge chart (GloFAS) ───────────────────────────────────────────
// Past modelled discharge, then the ensemble forecast: median (dashed, like
// every forecast line in the report), the middle 50% of members as a band and
// the full spread as a fainter band. Return-period flows are dashed in the
// risk color of the level each one sets (2-yr Guarded, 5-yr Elevated, 20-yr
// High), so the chart and the section's level can't tell different stories.

const finiteAt = (arr: Array<number | null> | undefined, i: number): number | null => {
  const v = Array.isArray(arr) ? arr[i] : undefined;
  return isNum(v) ? v : null;
};

/** Any finite value in any series — false means there's nothing to chart. */
export function dischargeHasData(d: FloodDischargeResponse | null | undefined): boolean {
  if (!d || !Array.isArray(d.time) || d.time.length === 0) return false;
  const series = [d.discharge, d.median, d.p25, d.p75, d.min, d.max];
  return d.time.some((_, i) => series.some((s) => finiteAt(s, i) !== null));
}

export function DischargeChart({ discharge, todayIso }: { discharge: FloodDischargeResponse; todayIso: string }) {
  if (!dischargeHasData(discharge)) return null;
  const time = discharge.time;
  const n = time.length;
  const day = (i: number) => (typeof time[i] === 'string' ? time[i].slice(0, 10) : '');

  const W = 640;
  const H = 200;
  const PAD_L = 44;
  const PAD_R = 92; // return-period labels ("20-yr 1,240 m³/s")
  const PAD_T = 18;
  const PAD_B = 20;
  const plotW = W - PAD_L - PAD_R;
  const plotH = H - PAD_T - PAD_B;

  // Past = the modelled discharge up to today; the forecast is the ensemble.
  // Without any ensemble values the deterministic series is all there is, so
  // it runs the full window rather than stopping at today.
  const median = time.map((_, i) => finiteAt(discharge.median, i));
  const hasEnsemble = median.some(isNum);
  const past = time.map((_, i) => (!hasEnsemble || day(i) <= todayIso ? finiteAt(discharge.discharge, i) : null));
  const values = [discharge.discharge, discharge.median, discharge.p25, discharge.p75, discharge.min, discharge.max]
    .flatMap((s) => time.map((_, i) => finiteAt(s, i)))
    .filter(isNum);
  const dataMax = values.length ? Math.max(...values) : 0;

  const th = discharge.thresholds;
  const rpLines = th && isNum(th.rp2) && isNum(th.rp5) && isNum(th.rp20)
    ? [
        { label: '2-yr', value: th.rp2, color: RISK_LEVELS.guarded.color },
        { label: '5-yr', value: th.rp5, color: RISK_LEVELS.elevated.color },
        { label: '20-yr', value: th.rp20, color: RISK_LEVELS.high.color },
      ].sort((a, b) => a.value - b.value)
    : [];
  // Same rule as the hydrograph: scale to the next return period above the
  // data, list the rest.
  const nextAbove = rpLines.find((l) => l.value > dataMax);
  const onScale = rpLines.filter((l) => l.value <= dataMax || l === nextAbove);
  const offScale = rpLines.filter((l) => !onScale.includes(l));

  const rawTop = Math.max(dataMax, ...onScale.map((l) => l.value));
  const top = niceCeil((rawTop > 0 ? rawTop : 1) * 1.08);
  const X = (i: number) => PAD_L + (n > 1 ? i / (n - 1) : 0) * plotW;
  const Y = (v: number) => PAD_T + plotH - (Math.max(0, Math.min(v, top)) / top) * plotH;

  // Line through consecutive finite values; isolated points become dots.
  const segments = (vals: Array<number | null>) => {
    const runs: { i: number; v: number }[][] = [];
    let cur: { i: number; v: number }[] = [];
    vals.forEach((v, i) => {
      if (v === null) {
        if (cur.length) runs.push(cur);
        cur = [];
      } else cur.push({ i, v });
    });
    if (cur.length) runs.push(cur);
    return runs;
  };
  const runPath = (run: { i: number; v: number }[]) =>
    run.map((p, k) => `${k ? 'L' : 'M'}${X(p.i).toFixed(1)},${Y(p.v).toFixed(1)}`).join(' ');
  const band = (lo: Array<number | null> | undefined, hi: Array<number | null> | undefined) => {
    const pairs = time.map((_, i) => {
      const a = finiteAt(lo, i);
      const b = finiteAt(hi, i);
      return a !== null && b !== null ? { i, lo: Math.min(a, b), hi: Math.max(a, b) } : null;
    });
    const runs: { i: number; lo: number; hi: number }[][] = [];
    let cur: { i: number; lo: number; hi: number }[] = [];
    pairs.forEach((p) => {
      if (p === null) {
        if (cur.length) runs.push(cur);
        cur = [];
      } else cur.push(p);
    });
    if (cur.length) runs.push(cur);
    return runs
      .filter((r) => r.length >= 2)
      .map((r) => {
        const upper = r.map((p, k) => `${k ? 'L' : 'M'}${X(p.i).toFixed(1)},${Y(p.hi).toFixed(1)}`).join(' ');
        const lower = r.slice().reverse().map((p) => `L${X(p.i).toFixed(1)},${Y(p.lo).toFixed(1)}`).join(' ');
        return `${upper} ${lower} Z`;
      });
  };

  // Today: its own column, else placed by date between the neighbouring days.
  const todayX = (() => {
    const exact = time.findIndex((_, i) => day(i) === todayIso);
    if (exact >= 0) return X(exact);
    const t = Date.parse(`${todayIso}T00:00:00Z`);
    const t0 = Date.parse(`${day(0)}T00:00:00Z`);
    const t1 = Date.parse(`${day(n - 1)}T00:00:00Z`);
    if ([t, t0, t1].some(Number.isNaN) || t < t0 || t > t1 || t1 === t0) return null;
    return PAD_L + ((t - t0) / (t1 - t0)) * plotW;
  })();

  const yTicks = niceTicks(0, top, 4).filter((v) => v > 0);
  const every = Math.max(1, Math.ceil(n / 8));
  const labelYs = spreadLabels(onScale.map((l) => Y(l.value)).reverse(), 10, PAD_T, H - PAD_B).reverse();
  const pastRuns = segments(past);
  const medianRuns = segments(median);

  return (
    <div className="print-card overflow-x-auto rounded-lg border border-white/8 bg-white/4 p-2">
      <svg viewBox={`0 0 ${W} ${H}`} className="print-color min-w-[520px] text-white" style={{ width: '100%' }}>
        {yTicks.map((v) => (
          <g key={v}>
            <line x1={PAD_L} x2={PAD_L + plotW} y1={Y(v)} y2={Y(v)} stroke="currentColor" strokeOpacity={0.08} strokeWidth="1" />
            <text x={PAD_L - 4} y={Y(v) + 3} textAnchor="end" fontSize="8" fill="currentColor" fillOpacity={0.45}>
              {v >= 1000 ? Math.round(v).toLocaleString('en-US') : tickLabel(v)}
            </text>
          </g>
        ))}
        <text x={4} y={PAD_T - 6} fontSize="8" fontWeight="600" fill="currentColor" fillOpacity={0.55}>m³/s</text>
        <line x1={PAD_L} x2={PAD_L + plotW} y1={Y(0)} y2={Y(0)} stroke="currentColor" strokeOpacity={0.25} strokeWidth="1" />
        {time.map((_, i) =>
          i % every === 0 ? (
            <text key={`x-${i}`} x={X(i)} y={H - 6} textAnchor="middle" fontSize="8" fill="currentColor" fillOpacity={0.5}>
              {isoMonthDay(day(i))}
            </text>
          ) : null
        )}
        {band(discharge.min, discharge.max).map((d, k) => (
          <path key={`mm-${k}`} d={d} fill={OBS_COLOR} fillOpacity={0.12} stroke="none" />
        ))}
        {band(discharge.p25, discharge.p75).map((d, k) => (
          <path key={`iq-${k}`} d={d} fill={OBS_COLOR} fillOpacity={0.3} stroke="none" />
        ))}
        {onScale.map((l, k) => (
          <g key={l.label}>
            <line x1={PAD_L} x2={PAD_L + plotW} y1={Y(l.value)} y2={Y(l.value)} stroke={l.color} strokeWidth="1.3" strokeDasharray="6 4" />
            <text x={PAD_L + plotW + 4} y={labelYs[k] + 3} fontSize="8" fontWeight="600" fill={l.color}>
              {`${l.label} ${fmtFlow(l.value)} m³/s`}
            </text>
          </g>
        ))}
        {todayX !== null && (
          <>
            <line x1={todayX} x2={todayX} y1={PAD_T - 4} y2={H - PAD_B} stroke="currentColor" strokeOpacity={0.45} strokeWidth="1" strokeDasharray="3 3" />
            <text x={todayX} y={PAD_T - 7} textAnchor="middle" fontSize="8" fontWeight="600" fill="currentColor" fillOpacity={0.7}>today</text>
          </>
        )}
        {pastRuns.map((r, k) =>
          r.length > 1 ? (
            <path key={`p-${k}`} d={runPath(r)} fill="none" stroke={OBS_COLOR} strokeWidth="2" strokeLinejoin="round" />
          ) : (
            <circle key={`p-${k}`} cx={X(r[0].i)} cy={Y(r[0].v)} r="2.2" fill={OBS_COLOR} />
          )
        )}
        {medianRuns.map((r, k) =>
          r.length > 1 ? (
            <path key={`m-${k}`} d={runPath(r)} fill="none" stroke="currentColor" strokeOpacity={0.85} strokeWidth="2" strokeDasharray="5 3" strokeLinejoin="round" />
          ) : (
            <circle key={`m-${k}`} cx={X(r[0].i)} cy={Y(r[0].v)} r="2.2" fill="currentColor" fillOpacity={0.85} />
          )
        )}
      </svg>
      <div className="mt-1 flex flex-wrap items-center gap-x-4 gap-y-1 px-1 text-[9px] text-white/50">
        <span className="flex items-center gap-1.5">
          <LineSwatch color={OBS_COLOR} /> {hasEnsemble ? 'past (model)' : 'modelled discharge (no ensemble returned)'}
        </span>
        {hasEnsemble && (
          <>
            <span className="flex items-center gap-1.5"><LineSwatch dash="4 2" /> ensemble median</span>
            <span className="flex items-center gap-1.5"><BandSwatch color={OBS_COLOR} opacity={0.3} /> middle 50% of members</span>
            <span className="flex items-center gap-1.5"><BandSwatch color={OBS_COLOR} opacity={0.12} /> full ensemble range</span>
          </>
        )}
        {rpLines.length > 0 ? (
          <span>dashed = return-period flows</span>
        ) : (
          <span className="text-white/40">return-period flows unavailable — trend only</span>
        )}
        {offScale.length > 0 && (
          <span className="text-white/40">Above chart: {offScale.map((l) => `${l.label} ${fmtFlow(l.value)} m³/s`).join(' · ')}</span>
        )}
      </div>
    </div>
  );
}
