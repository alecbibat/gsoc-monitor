import { useEffect, useRef, useState } from 'react';
import { api } from '../../api/client';
import type { FloodCat, RiverDetail, RiverSeriesPoint, RiverThreshold } from '../../types';
import { CAT, catColor, catLabel } from './riverMeta';

interface Payload {
  lid: string;
  name: string;
  state: string;
  cat: FloodCat;
  stage: number | null;
  unit: string;
  flow: number | null;
  flowUnit: string;
  isFlow: boolean;
}

const TREND: Record<string, { sym: string; cls: string; label: string }> = {
  rising: { sym: '▲', cls: 'text-rose-400', label: 'Rising' },
  falling: { sym: '▼', cls: 'text-sky-400', label: 'Falling' },
  steady: { sym: '▬', cls: 'text-white/50', label: 'Steady' },
};

function fmtNum(v: number | null | undefined, unit: string): string {
  if (v === null || v === undefined || !Number.isFinite(v)) return '—';
  if (unit === 'kcfs') return v >= 100 ? Math.round(v).toLocaleString() : v.toFixed(1);
  return Math.abs(v) >= 1000 ? v.toFixed(1) : v.toFixed(2);
}
function fmtTime(iso: string | null | undefined): string {
  if (!iso) return '';
  const d = new Date(iso);
  if (Number.isNaN(d.getTime()) || d.getUTCFullYear() < 1900) return '';
  return d.toLocaleString(undefined, { month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' });
}
function fmtDate(iso: string): string {
  if (!iso) return '';
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return '';
  return d.toLocaleDateString(undefined, { year: 'numeric', month: 'short', day: 'numeric' });
}

// Horizontal "where the river sits vs its flood stages" bar.
function ThresholdBar({
  thresholds,
  current,
  crest,
  unit,
}: {
  thresholds: RiverThreshold[];
  current: number | null;
  crest: number | null;
  unit: string;
}) {
  const ths = thresholds
    .filter((t) => t.stage != null)
    .map((t) => ({ cat: t.cat, stage: t.stage as number }))
    .sort((a, b) => a.stage - b.stage);
  if (!ths.length) return null;

  const vals = ths.map((t) => t.stage);
  if (current != null) vals.push(current);
  if (crest != null) vals.push(crest);
  let lo = Math.min(...vals);
  let hi = Math.max(...vals);
  const pad = Math.max((hi - lo) * 0.12, 0.5);
  lo -= pad;
  hi += pad;
  const W = 300;
  const x = (v: number) => 8 + ((v - lo) / (hi - lo || 1)) * (W - 16);
  const barY = 24;
  const barH = 11;

  const segs: { x0: number; x1: number; color: string }[] = [
    { x0: x(lo), x1: x(ths[0].stage), color: catColor('normal') },
  ];
  for (let i = 0; i < ths.length; i++) {
    segs.push({
      x0: x(ths[i].stage),
      x1: i + 1 < ths.length ? x(ths[i + 1].stage) : x(hi),
      color: catColor(ths[i].cat),
    });
  }

  return (
    <svg viewBox={`0 0 ${W} 52`} width="100%" className="block">
      {segs.map((s, i) => (
        <rect key={i} x={s.x0} y={barY} width={Math.max(0, s.x1 - s.x0)} height={barH} fill={s.color} opacity={0.85} />
      ))}
      {ths.map((t, i) => (
        <g key={i}>
          <line x1={x(t.stage)} y1={barY - 2} x2={x(t.stage)} y2={barY + barH + 2} stroke="#0a0e1a" strokeWidth="1" />
          <text x={x(t.stage)} y={barY + barH + 10} textAnchor="middle" fontSize="6.5" fill="#ffffff80">
            {t.stage}
          </text>
        </g>
      ))}
      {crest != null && (
        <path
          d={`M ${x(crest)} ${barY + barH + 2} l -3.2 5 l 6.4 0 z`}
          fill="none"
          stroke="#ffd23f"
          strokeWidth="1.2"
        />
      )}
      {current != null && (
        <g>
          <line x1={x(current)} y1={barY - 4} x2={x(current)} y2={barY + barH + 4} stroke="#ffffff" strokeWidth="1.6" />
          <path d={`M ${x(current)} ${barY - 4} l -3.2 -5 l 6.4 0 z`} fill="#ffffff" />
          <text x={x(current)} y={barY - 11} textAnchor="middle" fontSize="7.5" fontWeight="bold" fill="#ffffff">
            {fmtNum(current, unit)}
          </text>
        </g>
      )}
    </svg>
  );
}

// Stage hydrograph: observed history + forecast, with flood-stage threshold
// lines. Hovering reveals a crosshair and the time + value at that point.
function StageChart({
  observed,
  forecast,
  thresholds,
  unit,
}: {
  observed: RiverSeriesPoint[];
  forecast: RiverSeriesPoint[];
  thresholds: RiverThreshold[];
  unit: string;
}) {
  const [hover, setHover] = useState<number | null>(null);
  const wrapRef = useRef<HTMLDivElement>(null);

  const all: Array<{ t: number; v: number; forecast: boolean }> = [
    ...observed.map((p) => ({ t: p.t, v: p.v, forecast: false })),
    ...forecast.map((p) => ({ t: p.t, v: p.v, forecast: true })),
  ];
  if (all.length < 2) return null;
  const W = 300;
  const H = 132;
  const padL = 4;
  const padR = 30;
  const padT = 8;
  const padB = 16;
  const ths = thresholds.filter((t) => t.stage != null).map((t) => ({ cat: t.cat, stage: t.stage as number }));

  const tMin = Math.min(...all.map((p) => p.t));
  const tMax = Math.max(...all.map((p) => p.t));
  let vMin = Math.min(...all.map((p) => p.v), ...ths.map((t) => t.stage));
  let vMax = Math.max(...all.map((p) => p.v), ...ths.map((t) => t.stage));
  const vpad = Math.max((vMax - vMin) * 0.08, 0.3);
  vMin -= vpad;
  vMax += vpad;

  const X = (t: number) => padL + ((t - tMin) / (tMax - tMin || 1)) * (W - padL - padR);
  const Y = (v: number) => padT + (1 - (v - vMin) / (vMax - vMin || 1)) * (H - padT - padB);
  const toPath = (pts: RiverSeriesPoint[]) =>
    pts.map((p, i) => `${i ? 'L' : 'M'} ${X(p.t).toFixed(1)} ${Y(p.v).toFixed(1)}`).join(' ');
  const nowX = forecast.length ? X(forecast[0].t) : null;
  const fcPath = forecast.length ? [observed[observed.length - 1], ...forecast] : [];

  const h = hover != null ? all[hover] : null;
  const hx = h ? X(h.t) : 0;
  const tipLeft = Math.min(86, Math.max(14, (hx / W) * 100));

  return (
    <div
      ref={wrapRef}
      className="relative"
      onPointerMove={(e) => {
        const el = wrapRef.current;
        if (!el) return;
        const r = el.getBoundingClientRect();
        const vbX = ((e.clientX - r.left) / r.width) * W; // back into viewBox units
        const t = tMin + ((vbX - padL) / (W - padL - padR || 1)) * (tMax - tMin);
        let best = 0;
        let bd = Infinity;
        for (let i = 0; i < all.length; i++) {
          const dd = Math.abs(all[i].t - t);
          if (dd < bd) {
            bd = dd;
            best = i;
          }
        }
        setHover(best);
      }}
      onPointerLeave={() => setHover(null)}
    >
      <svg viewBox={`0 0 ${W} ${H}`} width="100%" className="block">
        {ths.map((t, i) => (
          <g key={i}>
            <line
              x1={padL}
              y1={Y(t.stage)}
              x2={W - padR}
              y2={Y(t.stage)}
              stroke={catColor(t.cat)}
              strokeWidth="0.7"
              strokeDasharray="3 2"
              opacity="0.7"
            />
            <text x={W - padR + 2} y={Y(t.stage) + 2.2} fontSize="6" fill={catColor(t.cat)}>
              {CAT[t.cat].short}
            </text>
          </g>
        ))}
        {nowX != null && (
          <line x1={nowX} y1={padT} x2={nowX} y2={H - padB} stroke="#ffffff35" strokeWidth="0.7" strokeDasharray="2 2" />
        )}
        <path d={toPath(observed)} fill="none" stroke="#9fd8ff" strokeWidth="1.5" />
        {fcPath.length > 1 && <path d={toPath(fcPath)} fill="none" stroke="#ffd23f" strokeWidth="1.5" strokeDasharray="3 2" />}
        {h && (
          <g>
            <line x1={hx} y1={padT} x2={hx} y2={H - padB} stroke="#ffffff80" strokeWidth="0.7" />
            <circle
              cx={hx}
              cy={Y(h.v)}
              r="2.6"
              fill={h.forecast ? '#ffd23f' : '#9fd8ff'}
              stroke="#04161c"
              strokeWidth="0.8"
            />
          </g>
        )}
        <text x={padL} y={H - 4} fontSize="6" fill="#ffffff55">
          {fmtTime(new Date(tMin * 1000).toISOString())}
        </text>
        <text x={W - padR} y={H - 4} textAnchor="end" fontSize="6" fill="#ffffff55">
          {fmtTime(new Date(tMax * 1000).toISOString())}
        </text>
      </svg>
      {h && (
        <div
          className="pointer-events-none absolute top-0 z-10 -translate-x-1/2 whitespace-nowrap rounded-md border border-white/10 bg-ink-900/95 px-2 py-1 text-center shadow-panel"
          style={{ left: `${tipLeft}%` }}
        >
          <div className="text-[11px] font-semibold leading-tight text-white">
            {fmtTime(new Date(h.t * 1000).toISOString())}
          </div>
          <div
            className="mt-0.5 text-[10px] leading-none"
            style={{ color: h.forecast ? '#ffd23f' : '#9fd8ff' }}
          >
            {fmtNum(h.v, unit)} {unit}
            {h.forecast ? ' · forecast' : ''}
          </div>
        </div>
      )}
    </div>
  );
}

export function RiverDetails({ payload }: { payload: Payload }) {
  const [d, setD] = useState<RiverDetail | null>(null);
  const [err, setErr] = useState(false);
  const [reload, setReload] = useState(0);

  useEffect(() => {
    let cancelled = false;
    setD(null);
    setErr(false);
    api
      .riverDetail(payload.lid)
      .then((res) => !cancelled && setD(res))
      .catch(() => !cancelled && setErr(true));
    return () => {
      cancelled = true;
    };
  }, [payload.lid, reload]);

  // Headline uses the freshest available source (detail once loaded, else the
  // value carried in from the clicked point).
  const cat = d?.observed.cat ?? payload.cat;
  const meta = CAT[cat] ?? CAT.none;
  const primaryName = d?.primaryName ?? (payload.isFlow ? 'Flow' : 'Stage');
  const unit = d?.unit ?? payload.unit;
  const value = d ? d.observed.value : payload.stage;
  const flow = d ? d.observed.flow : payload.flow;
  const flowUnit = d?.flowUnit ?? payload.flowUnit;
  const trend = d?.trend ? TREND[d.trend] : null;
  // Flow-primary gauges classify against flow thresholds, not stage; map the
  // threshold dimension to whatever the gauge's primary reading is so the bar
  // and hydrograph lines line up with the plotted values.
  const displayThresholds = d
    ? d.thresholds.map((t) => ({ cat: t.cat, stage: d.isFlow ? t.flow : t.stage, flow: t.flow }))
    : [];

  return (
    <div className="space-y-3">
      {/* Headline */}
      <div className="rounded-lg px-3 py-2.5" style={{ backgroundColor: `${meta.color}22` }}>
        <div className="flex items-baseline gap-2">
          <span className="text-3xl font-black tabular-nums" style={{ color: meta.color }}>
            {fmtNum(value, unit)}
          </span>
          <span className="text-[12px] text-white/50">
            {unit} {primaryName.toLowerCase()}
          </span>
          {trend && (
            <span className={`ml-auto text-[12px] font-semibold ${trend.cls}`}>
              {trend.sym} {trend.label}
            </span>
          )}
        </div>
        <div className="mt-0.5 flex items-center gap-2">
          <span className="text-[13px] font-bold" style={{ color: meta.color }}>
            {catLabel(cat)}
          </span>
          {!payload.isFlow && flow != null && (
            <span className="text-[11px] text-white/45">· {fmtNum(flow, flowUnit)} {flowUnit} flow</span>
          )}
          {d?.observed.time && <span className="ml-auto text-[10px] text-white/35">{fmtTime(d.observed.time)}</span>}
        </div>
      </div>

      {err && (
        <div className="space-y-2 rounded-lg bg-white/5 px-3 py-3 text-[12px] text-white/55">
          <p>Couldn’t load this gauge’s detail (NOAA NWPS didn’t respond).</p>
          <button
            onClick={() => setReload((k) => k + 1)}
            className="rounded-md border border-white/15 bg-white/5 px-3 py-1.5 text-[12px] font-semibold text-white/80 transition hover:bg-white/10"
          >
            Retry
          </button>
        </div>
      )}

      {!d && !err && (
        <div className="flex items-center gap-2 px-1 py-4 text-[12px] text-white/50">
          <span className="h-3.5 w-3.5 animate-spin rounded-full border-2 border-white/20 border-t-white/70" />
          Loading gauge detail…
        </div>
      )}

      {d && (
        <>
          {/* Stage vs flood thresholds */}
          {d.thresholds.length > 0 ? (
            <div>
              <div className="mb-0.5 text-[10px] font-semibold uppercase tracking-wider text-white/30">
                Stage vs flood thresholds ({d.unit})
              </div>
              <ThresholdBar
                thresholds={displayThresholds}
                current={d.observed.value}
                crest={d.forecastCrest.value}
                unit={d.unit}
              />
              <div className="flex gap-3 text-[9px] text-white/35">
                <span>▲ now</span>
                {d.forecastCrest.value != null && <span className="text-amber-300/70">▽ forecast crest</span>}
              </div>
            </div>
          ) : (
            <div className="rounded-lg bg-white/5 px-3 py-2 text-[11px] text-white/45">
              No flood thresholds are defined for this gauge — level is monitored, but it isn’t flood-classified.
            </div>
          )}

          {/* Forecast crest */}
          {d.forecastCrest.value != null && (
            <div className="flex items-center gap-2 rounded-lg border border-sky-400/20 bg-sky-400/[0.06] px-3 py-2 text-[12px]">
              <span className="text-[14px]">🔮</span>
              <span className="text-white/70">
                Forecast crest <span className="font-bold text-white">{fmtNum(d.forecastCrest.value, d.unit)} {d.unit}</span>
                {d.forecastCrest.cat && d.forecastCrest.cat !== 'normal' && (
                  <span className="ml-1" style={{ color: catColor(d.forecastCrest.cat) }}>({catLabel(d.forecastCrest.cat)})</span>
                )}
              </span>
              {d.forecastCrest.time && <span className="ml-auto text-white/40">{fmtTime(d.forecastCrest.time)}</span>}
            </div>
          )}

          {/* Hydrograph */}
          {(d.observedSeries.length > 1 || d.forecastSeries.length > 0) && (
            <div>
              <div className="mb-1 flex items-center justify-between">
                <span className="text-[10px] font-semibold uppercase tracking-wider text-white/30">
                  {primaryName} · 14-day + forecast
                </span>
                <span className="flex items-center gap-1.5 text-[9px] text-white/35">
                  <span className="inline-block h-[2px] w-3 bg-[#9fd8ff]" /> obs
                  <span className="ml-1 inline-block h-[2px] w-3 bg-[#ffd23f]" /> fcst
                </span>
              </div>
              <StageChart
                observed={d.observedSeries}
                forecast={d.forecastSeries}
                thresholds={displayThresholds}
                unit={d.unit}
              />
            </div>
          )}

          {/* Impacts */}
          {d.impacts.length > 0 && (
            <div>
              <div className="mb-1 text-[10px] font-semibold uppercase tracking-wider text-white/30">
                Impacts near current level
              </div>
              <ul className="space-y-1">
                {d.impacts.map((im, i) => (
                  <li key={i} className="flex gap-2 text-[11px] leading-snug text-white/55">
                    <span className="shrink-0 font-mono font-semibold text-white/70">{im.stage}{d.unit}</span>
                    <span>{im.statement}</span>
                  </li>
                ))}
              </ul>
            </div>
          )}

          {/* Crests + footer */}
          <dl className="grid grid-cols-[auto_1fr] gap-x-3 gap-y-1.5 border-t border-white/10 pt-2.5 text-[12px]">
            {d.recentCrest && (
              <>
                <dt className="text-white/40">Recent crest</dt>
                <dd className="text-white/70">
                  {fmtNum(d.recentCrest.stage, d.unit)} {d.unit} · {fmtDate(d.recentCrest.time)}
                </dd>
              </>
            )}
            {d.recordCrest && (
              <>
                <dt className="text-white/40">Record crest</dt>
                <dd className="text-white/70">
                  {fmtNum(d.recordCrest.stage, d.unit)} {d.unit} · {fmtDate(d.recordCrest.time)}
                </dd>
              </>
            )}
            <dt className="text-white/40">Location</dt>
            <dd className="text-white/70">
              {[d.county && `${d.county} County`, d.state].filter(Boolean).join(', ') || '—'}
            </dd>
            {d.usgsId && (
              <>
                <dt className="text-white/40">USGS</dt>
                <dd>
                  <a
                    href={`https://waterdata.usgs.gov/monitoring-location/${d.usgsId}/`}
                    target="_blank"
                    rel="noreferrer"
                    className="text-accent hover:underline"
                  >
                    {d.usgsId}
                  </a>
                </dd>
              </>
            )}
            <dt className="text-white/40">Source</dt>
            <dd className="text-white/70">NOAA NWPS · gauge {d.lid}</dd>
          </dl>

          {d.inServiceMsg && <p className="text-[10px] text-amber-300/70">⚠ {d.inServiceMsg}</p>}
          {d.forecastReliability && d.forecastCrest.value == null && (
            <p className="text-[10px] text-white/30">{d.forecastReliability}</p>
          )}
        </>
      )}
    </div>
  );
}
