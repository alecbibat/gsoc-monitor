import { useEffect, useMemo, useState } from 'react';
import { api } from '../../api/client';
import {
  speedColorHex,
  cardinal16,
  convertSpeed,
  formatSpeed,
  WIND_UNIT_LABEL,
  type WindUnit,
} from './windProbe';

import { useWindUnit } from './windUnitStore';
import type { WindForecast } from '../../types';

interface Payload {
  lon: number;
  lat: number;
  cardinal: string;
  fromDeg: number;
  toDeg: number;
  speedMps: number;
  speedMph: number;
}

const MAX_HOURS = 48;
const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
const WEEKDAYS = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];

function fmtHour(hh: number): string {
  const h12 = hh % 12 === 0 ? 12 : hh % 12;
  return `${h12}${hh < 12 ? 'a' : 'p'}`;
}
function fmtHourLong(hh: number): string {
  const h12 = hh % 12 === 0 ? 12 : hh % 12;
  return `${h12} ${hh < 12 ? 'AM' : 'PM'}`;
}

// Weekday/month-day from a "YYYY-MM-DD" calendar date, computed in UTC so the
// browser's timezone can't shift it by a day.
function weekday(dateStr: string): string {
  const [y, m, d] = dateStr.split('-').map(Number);
  return WEEKDAYS[new Date(Date.UTC(y, m - 1, d)).getUTCDay()];
}
function monthDay(dateStr: string): string {
  return `${MONTHS[Number(dateStr.slice(5, 7)) - 1]} ${Number(dateStr.slice(8, 10))}`;
}

// A north-up arrow rotated to point the way the wind blows (flow = from + 180).
function DirArrow({ fromDeg, color, size = 16 }: { fromDeg: number; color: string; size?: number }) {
  const flow = (fromDeg + 180) % 360;
  return (
    <svg width={size} height={size} viewBox="0 0 16 16" className="shrink-0">
      <g transform={`rotate(${flow} 8 8)`}>
        <path
          d="M8 2 L12 9 L9.2 9 L9.2 14 L6.8 14 L6.8 9 L4 9 Z"
          fill={color}
          stroke="#0a1722"
          strokeWidth="0.8"
          strokeLinejoin="round"
        />
      </g>
    </svg>
  );
}

function UnitToggle({ unit, setUnit }: { unit: WindUnit; setUnit: (u: WindUnit) => void }) {
  return (
    <div className="flex items-center gap-0.5 rounded-lg bg-black/30 p-0.5">
      {(['mph', 'kt', 'ms'] as WindUnit[]).map((u) => (
        <button
          key={u}
          onClick={() => setUnit(u)}
          className={`rounded px-2 py-0.5 text-[10px] font-semibold transition ${
            unit === u ? 'bg-accent/20 text-accent' : 'text-white/45 hover:text-white/70'
          }`}
        >
          {WIND_UNIT_LABEL[u]}
        </button>
      ))}
    </div>
  );
}

interface HourPoint {
  hh: number;
  date: string;
  speedMps: number;
  gustMps: number;
  dir: number;
}

// Slice the hourly arrays to the next MAX_HOURS starting at the forecast point's
// current local hour. Speeds stay in m/s — the component converts for display.
function buildWindow(fc: WindForecast): { hours: HourPoint[]; peak: HourPoint | null } {
  const { time, speed, dir, gust } = fc.hourly;
  // Property-local "now" as a "YYYY-MM-DDTHH" prefix: shift the instant by the
  // point's UTC offset, then read the UTC fields back (ISO sorts chronologically).
  const nowPrefix = new Date(Date.now() + fc.utcOffsetSeconds * 1000).toISOString().slice(0, 13);
  let start = time.findIndex((t) => t.slice(0, 13) >= nowPrefix);
  if (start < 0) start = 0;

  const hours: HourPoint[] = [];
  let peak: HourPoint | null = null;
  for (let i = start; i < time.length && hours.length < MAX_HOURS; i++) {
    const h: HourPoint = {
      hh: Number(time[i].slice(11, 13)),
      date: time[i].slice(0, 10),
      speedMps: speed[i],
      gustMps: gust[i],
      dir: dir[i],
    };
    hours.push(h);
    if (!peak || h.gustMps > peak.gustMps) peak = h;
  }
  return { hours, peak };
}

function niceScale(maxDisplay: number, unit: WindUnit): number {
  const step = unit === 'ms' ? 2 : 5;
  const min = unit === 'ms' ? 4 : 10;
  return Math.max(min, Math.ceil(maxDisplay / step) * step);
}

// --- Hourly chart geometry (viewBox units) ---
const PAD_L = 20;
const PAD_R = 4;
const STEP = 7;
const ARROW_Y = 9;
const BAR_TOP = 20;
const BAR_BOT = 116;
const BAR_H = BAR_BOT - BAR_TOP;
const LABEL_Y = BAR_BOT + 13;
const CHART_H = LABEL_Y + 4;

function HourlyChart({
  hours,
  unit,
  niceMax,
}: {
  hours: HourPoint[];
  unit: WindUnit;
  niceMax: number;
}) {
  const chartW = PAD_L + hours.length * STEP + PAD_R;
  const barW = STEP - 2.4;
  return (
    <svg
      viewBox={`0 0 ${chartW} ${CHART_H}`}
      width="100%"
      preserveAspectRatio="xMidYMid meet"
      className="block"
    >
      {[0, 0.5, 1].map((f) => {
        const y = BAR_BOT - f * BAR_H;
        return (
          <g key={f}>
            <line x1={PAD_L} y1={y} x2={chartW - PAD_R} y2={y} stroke="#ffffff14" strokeWidth="0.6" />
            <text x={PAD_L - 3} y={y + 2.5} textAnchor="end" fontSize="6.5" fill="#ffffff55">
              {Math.round(niceMax * f)}
            </text>
          </g>
        );
      })}

      {hours.map((h, i) => {
        const x = PAD_L + i * STEP + STEP / 2;
        const speedDisp = convertSpeed(h.speedMps, unit);
        const gustDisp = convertSpeed(h.gustMps, unit);
        const sh = (speedDisp / niceMax) * BAR_H;
        const gy = BAR_BOT - (gustDisp / niceMax) * BAR_H;
        const showMarker = h.hh % 6 === 0;
        return (
          <g key={i}>
            {h.hh === 0 && i > 0 && (
              <line x1={x - STEP / 2} y1={BAR_TOP} x2={x - STEP / 2} y2={BAR_BOT} stroke="#ffffff1f" strokeWidth="0.6" strokeDasharray="2 2" />
            )}
            <line x1={x - barW / 2} y1={gy} x2={x + barW / 2} y2={gy} stroke="#ffffff70" strokeWidth="1.2" />
            <rect
              x={x - barW / 2}
              y={BAR_BOT - sh}
              width={barW}
              height={Math.max(0.5, sh)}
              rx="0.8"
              fill={speedColorHex(h.speedMps)}
            />
            {showMarker && (
              <g transform={`translate(${x} ${ARROW_Y}) rotate(${(h.dir + 180) % 360})`}>
                <path
                  d="M0 -4.5 L3 2.5 L1 2.5 L1 5 L-1 5 L-1 2.5 L-3 2.5 Z"
                  fill={speedColorHex(h.speedMps)}
                  stroke="#0a1722"
                  strokeWidth="0.5"
                  strokeLinejoin="round"
                />
              </g>
            )}
            {showMarker && (
              <text x={x} y={LABEL_Y} textAnchor="middle" fontSize="6" fill="#ffffff66">
                {h.hh === 0 ? monthDay(h.date) : fmtHour(h.hh)}
              </text>
            )}
          </g>
        );
      })}
    </svg>
  );
}

export function WindForecastDetails({ payload }: { payload: Payload }) {
  const { lat, lon } = payload;
  const unit = useWindUnit((s) => s.unit);
  const setUnit = useWindUnit((s) => s.setUnit);
  const [fc, setFc] = useState<WindForecast | null>(null);
  const [err, setErr] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    setFc(null);
    setErr(null);
    api
      .windForecast(lat, lon)
      .then((d) => !cancelled && setFc(d))
      .catch(() => !cancelled && setErr('Forecast unavailable'));
    return () => {
      cancelled = true;
    };
  }, [lat, lon]);

  const win = useMemo(() => (fc ? buildWindow(fc) : null), [fc]);

  if (err) {
    return (
      <div className="rounded-lg bg-white/5 px-3 py-4 text-[13px] leading-relaxed text-white/60">
        {err}. The forecast feed (NOAA GFS via Open-Meteo) didn’t respond — try again shortly.
      </div>
    );
  }
  if (!fc || !win) {
    return (
      <div className="flex items-center gap-2 px-1 py-6 text-[13px] text-white/50">
        <span className="h-3.5 w-3.5 animate-spin rounded-full border-2 border-white/20 border-t-white/70" />
        Loading wind forecast…
      </div>
    );
  }

  const u = WIND_UNIT_LABEL[unit];
  // Always use the pin's captured grid values for speed/direction so the card
  // matches the on-globe arrow (both come from the same GFS bilinear sample).
  // Gust comes from the forecast API since the static grid has no gust data.
  const nowSpeed = formatSpeed(payload.speedMps, unit);
  const nowGust = win.hours[0] ? formatSpeed(win.hours[0].gustMps, unit) : null;
  const nowColor = speedColorHex(payload.speedMps);

  // Chart scale in the display unit, off the windowed gust peak.
  const maxGustDisp = win.hours.reduce((m, h) => Math.max(m, convertSpeed(h.gustMps, unit)), 0);
  const niceMax = niceScale(maxGustDisp, unit);

  return (
    <div className="space-y-3">
      {/* Unit toggle */}
      <div className="flex justify-end">
        <UnitToggle unit={unit} setUnit={setUnit} />
      </div>

      {/* Now headline */}
      <div className="flex items-center gap-3 rounded-lg bg-white/5 px-3 py-2.5">
        <DirArrow fromDeg={payload.fromDeg} color={nowColor} size={34} />
        <div className="min-w-0 flex-1">
          <div className="flex items-baseline gap-1">
            <span className="text-3xl font-black tabular-nums text-white">{nowSpeed}</span>
            <span className="text-[12px] text-white/45">{u}</span>
            {nowGust != null && Number(nowGust) > Number(nowSpeed) && (
              <span className="ml-1 text-[12px] text-white/45">gusts {nowGust}</span>
            )}
          </div>
          <div className="text-[12px] font-semibold text-white/75">
            from {payload.cardinal}
            <span className="ml-1.5 font-normal text-white/35">now · GFS</span>
          </div>
        </div>
      </div>

      {/* Peak gust callout */}
      {win.peak && (
        <div className="flex items-center gap-2 rounded-lg border border-amber-400/25 bg-amber-400/[0.07] px-3 py-2">
          <span className="text-[15px]">⚡</span>
          <div className="min-w-0 flex-1 text-[12px]">
            <span className="font-semibold text-amber-200/90">
              Peak gust {formatSpeed(win.peak.gustMps, unit)} {u}
            </span>
            <span className="ml-1 text-white/45">
              {weekday(win.peak.date)} {fmtHourLong(win.peak.hh)} · next {win.hours.length}h
            </span>
          </div>
        </div>
      )}

      {/* Hourly chart */}
      <div>
        <div className="mb-1 flex items-center justify-between">
          <span className="text-[10px] font-semibold uppercase tracking-wider text-white/35">
            Hourly · sustained ({u})
          </span>
          <span className="flex items-center gap-1 text-[10px] text-white/35">
            <span className="inline-block h-2 w-3 rounded-sm bg-white/40" /> wind
            <span className="ml-1.5 inline-block h-[2px] w-3 bg-white/70" /> gust
          </span>
        </div>
        <HourlyChart hours={win.hours} unit={unit} niceMax={niceMax} />
      </div>

      {/* 7-day outlook */}
      <div>
        <div className="mb-1.5 text-[10px] font-semibold uppercase tracking-wider text-white/35">
          7-day outlook · max ({u})
        </div>
        <div className="flex gap-1">
          {fc.daily.time.map((d, i) => (
            <div
              key={d}
              className="flex flex-1 flex-col items-center gap-0.5 rounded-md bg-white/[0.04] py-1.5"
              title={`${weekday(d)} · max ${formatSpeed(fc.daily.speedMax[i], unit)} ${u}, gusts ${formatSpeed(
                fc.daily.gustMax[i],
                unit
              )} ${u}, from ${cardinal16(fc.daily.dirDominant[i])}`}
            >
              <span className="text-[10px] font-semibold text-white/55">{weekday(d)}</span>
              <DirArrow fromDeg={fc.daily.dirDominant[i]} color={speedColorHex(fc.daily.speedMax[i])} size={15} />
              <span className="font-mono text-[12px] font-bold tabular-nums text-white/85">
                {formatSpeed(fc.daily.speedMax[i], unit)}
              </span>
              <span className="font-mono text-[9px] tabular-nums text-white/35">
                g{formatSpeed(fc.daily.gustMax[i], unit)}
              </span>
            </div>
          ))}
        </div>
      </div>

      {/* Footer */}
      <dl className="grid grid-cols-[auto_1fr] gap-x-3 gap-y-1.5 border-t border-white/10 pt-2.5 text-[12px]">
        <dt className="text-white/40">Point</dt>
        <dd className="font-mono text-white/70">
          {Math.abs(lat).toFixed(3)}°{lat >= 0 ? 'N' : 'S'}, {Math.abs(lon).toFixed(3)}°
          {lon >= 0 ? 'E' : 'W'}
        </dd>
        <dt className="text-white/40">Local time</dt>
        <dd className="text-white/70">
          {fc.timezone} ({fc.timezoneAbbr})
        </dd>
        <dt className="text-white/40">Source</dt>
        <dd className="text-white/70">NOAA GFS · Open-Meteo</dd>
      </dl>
    </div>
  );
}
