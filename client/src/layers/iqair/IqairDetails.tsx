import { useEffect, useMemo, useState } from 'react';
import { api } from '../../api/client';
import { CATEGORY_STYLE, aqiCategory, aqiColor } from './aqiScale';
import type { AirQualityForecast, IqairCity, IqairForecastHour } from '../../types';

interface Props {
  payload: IqairCity;
}

const MAX_HOURS = 48;
const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
const WEEKDAYS = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];

const PARAM_LABEL: Record<string, string> = {
  'PM2.5': 'PM2.5 (fine particles)',
  PM10: 'PM10 (coarse particles)',
  O3: 'Ozone (O₃)',
  CO: 'Carbon Monoxide (CO)',
  NO2: 'Nitrogen Dioxide (NO₂)',
  SO2: 'Sulfur Dioxide (SO₂)',
};

function fmtHour(hh: number): string {
  const h12 = hh % 12 === 0 ? 12 : hh % 12;
  return `${h12}${hh < 12 ? 'a' : 'p'}`;
}

// Weekday/month-day from "YYYY-MM-DD", computed in UTC so the browser's
// timezone can't shift the calendar day.
function weekday(dateStr: string): string {
  const [y, m, d] = dateStr.split('-').map(Number);
  return WEEKDAYS[new Date(Date.UTC(y, m - 1, d)).getUTCDay()];
}
function monthDay(dateStr: string): string {
  return `${MONTHS[Number(dateStr.slice(5, 7)) - 1]} ${Number(dateStr.slice(8, 10))}`;
}

function timeAgo(ms: number | null): string {
  if (!ms) return '—';
  const mins = Math.max(0, Math.round((Date.now() - ms) / 60_000));
  if (mins < 1) return 'just now';
  if (mins < 60) return `${mins} min ago`;
  const h = Math.floor(mins / 60);
  if (h < 24) return `${h}h ${mins % 60}m ago`;
  return `${Math.floor(h / 24)}d ago`;
}

interface HourPoint {
  hh: number;
  date: string;
  aqi: number;
}

// Slice the forecast's hourly arrays to the next MAX_HOURS starting at the
// point's current local hour, skipping null (past-horizon) values.
function buildWindow(fc: AirQualityForecast): { hours: HourPoint[]; peak: HourPoint | null } {
  const { time, aqi } = fc.hourly;
  const nowPrefix = new Date(Date.now() + fc.utcOffsetSeconds * 1000).toISOString().slice(0, 13);
  const start = time.findIndex((t) => t.slice(0, 13) >= nowPrefix);
  // Entirely-past window: a long-degraded upstream can serve a stale cached
  // forecast — render nothing rather than presenting old hours as upcoming
  // (the staleness note below tells the user what happened).
  if (start < 0) return { hours: [], peak: null };

  const hours: HourPoint[] = [];
  let peak: HourPoint | null = null;
  for (let i = start; i < time.length && hours.length < MAX_HOURS; i++) {
    const v = aqi[i];
    if (v == null) continue;
    const h: HourPoint = { hh: Number(time[i].slice(11, 13)), date: time[i].slice(0, 10), aqi: v };
    hours.push(h);
    if (!peak || h.aqi > peak.aqi) peak = h;
  }
  return { hours, peak };
}

// Paid-tier IQAir hourly entries → the same HourPoint shape, localized with the
// point's UTC offset (IQAir timestamps are UTC).
function buildIqairWindow(entries: IqairForecastHour[], utcOffsetSeconds: number): HourPoint[] {
  const hours: HourPoint[] = [];
  for (const e of entries) {
    const ms = Date.parse(e.ts);
    if (!Number.isFinite(ms) || !Number.isFinite(e.aqius)) continue;
    if (ms < Date.now() - 3_600_000) continue; // skip already-past hours
    const local = new Date(ms + utcOffsetSeconds * 1000).toISOString();
    hours.push({ hh: Number(local.slice(11, 13)), date: local.slice(0, 10), aqi: e.aqius });
    if (hours.length >= 72) break;
  }
  return hours;
}

// --- Hourly AQI chart (viewBox units, modeled on the wind forecast chart) ----
const PAD_L = 24;
const PAD_R = 4;
const STEP = 7;
const BAR_TOP = 8;
const BAR_BOT = 104;
const BAR_H = BAR_BOT - BAR_TOP;
const LABEL_Y = BAR_BOT + 13;
const CHART_H = LABEL_Y + 4;

function niceScale(maxAqi: number): number {
  return Math.max(100, Math.ceil(maxAqi / 50) * 50);
}

function AqiChart({ hours, niceMax }: { hours: HourPoint[]; niceMax: number }) {
  const chartW = PAD_L + hours.length * STEP + PAD_R;
  const barW = STEP - 2.4;
  // The Moderate/USG boundary is the reference line worth calling out.
  const y100 = BAR_BOT - (100 / niceMax) * BAR_H;
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
      {niceMax > 100 && (
        <line
          x1={PAD_L}
          y1={y100}
          x2={chartW - PAD_R}
          y2={y100}
          stroke="#ff7e0055"
          strokeWidth="0.7"
          strokeDasharray="3 2"
        />
      )}

      {hours.map((h, i) => {
        const x = PAD_L + i * STEP + STEP / 2;
        const bh = Math.min(1, h.aqi / niceMax) * BAR_H;
        const showMarker = h.hh % 6 === 0;
        return (
          <g key={i}>
            {h.hh === 0 && i > 0 && (
              <line
                x1={x - STEP / 2}
                y1={BAR_TOP}
                x2={x - STEP / 2}
                y2={BAR_BOT}
                stroke="#ffffff1f"
                strokeWidth="0.6"
                strokeDasharray="2 2"
              />
            )}
            <rect
              x={x - barW / 2}
              y={BAR_BOT - bh}
              width={barW}
              height={Math.max(0.5, bh)}
              rx="0.8"
              fill={aqiColor(h.aqi)}
            />
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

export function IqairDetails({ payload }: Props) {
  const { lat, lon, aqi, categoryNum, mainPollutant } = payload;
  const style = CATEGORY_STYLE[categoryNum] ?? CATEGORY_STYLE[aqiCategory(aqi)] ?? CATEGORY_STYLE[1];

  const [fc, setFc] = useState<AirQualityForecast | null>(null);
  const [err, setErr] = useState<string | null>(null);
  const [reloadKey, setReloadKey] = useState(0);

  useEffect(() => {
    let cancelled = false;
    setFc(null);
    setErr(null);
    api
      .airQualityForecast(lat, lon)
      .then((d) => !cancelled && setFc(d))
      .catch(() => !cancelled && setErr('Forecast unavailable'));
    return () => {
      cancelled = true;
    };
  }, [lat, lon, reloadKey]);

  const win = useMemo(() => (fc ? buildWindow(fc) : null), [fc]);
  // Paid-tier IQAir forecast, localized with the CAMS response's UTC offset
  // once it arrives (falls back to UTC hour labels until then).
  const iqairHours = useMemo(
    () =>
      payload.forecasts?.length
        ? buildIqairWindow(payload.forecasts, fc?.utcOffsetSeconds ?? 0)
        : [],
    [payload.forecasts, fc?.utcOffsetSeconds]
  );

  const place = [payload.city, payload.state, payload.country].filter(Boolean).join(', ');

  return (
    <div className="space-y-3">
      {/* AQI badge */}
      <div className={`flex items-center gap-3 rounded-lg px-3 py-2.5 ${style.bg}`}>
        <span className={`text-4xl font-black tabular-nums ${style.text}`}>{aqi}</span>
        <div>
          <div className={`text-sm font-bold ${style.text}`}>{style.label}</div>
          <div className="mt-0.5 text-[11px] leading-snug text-white/50">{style.desc}</div>
        </div>
      </div>

      {/* Current weather at the station */}
      {(payload.tempC != null || payload.humidity != null || payload.windMs != null) && (
        <div className="flex flex-wrap gap-1.5">
          {payload.tempC != null && (
            <span className="rounded bg-white/5 px-2 py-1 text-[11px] tabular-nums text-white/65">
              🌡 {payload.tempC}°C / {Math.round((payload.tempC * 9) / 5 + 32)}°F
            </span>
          )}
          {payload.humidity != null && (
            <span className="rounded bg-white/5 px-2 py-1 text-[11px] tabular-nums text-white/65">
              💧 {payload.humidity}%
            </span>
          )}
          {payload.windMs != null && (
            <span className="rounded bg-white/5 px-2 py-1 text-[11px] tabular-nums text-white/65">
              🌬 {Math.round(payload.windMs * 2.237)} mph
            </span>
          )}
        </div>
      )}

      <dl className="grid grid-cols-[auto_1fr] gap-x-3 gap-y-1.5 text-[13px]">
        <dt className="text-white/40">Main pollutant</dt>
        <dd>{PARAM_LABEL[mainPollutant] ?? mainPollutant}</dd>

        <dt className="text-white/40">Location</dt>
        <dd className="truncate" title={place}>{place}</dd>

        <dt className="text-white/40">Observed</dt>
        <dd>{timeAgo(payload.observedAt)}</dd>

        <dt className="text-white/40">Source</dt>
        <dd>IQAir AirVisual · nearest station</dd>
      </dl>

      {/* IQAir's own forecast — present only when the API key's plan includes it */}
      {iqairHours.length > 0 && (
        <div>
          <div className="mb-1 text-[10px] font-semibold uppercase tracking-wider text-white/35">
            IQAir forecast · AQI (US)
          </div>
          <AqiChart
            hours={iqairHours}
            niceMax={niceScale(iqairHours.reduce((m, h) => Math.max(m, h.aqi), 0))}
          />
        </div>
      )}

      {/* Per-point model forecast (CAMS) */}
      <div className="border-t border-white/10 pt-2.5">
        <div className="mb-1.5 text-[10px] font-semibold uppercase tracking-wider text-white/35">
          Air-quality forecast · this point
        </div>

        {err && (
          <div className="space-y-2 rounded-lg bg-white/5 px-3 py-3 text-[12px] leading-relaxed text-white/60">
            <p>{err}. The CAMS feed (via Open-Meteo) can be briefly rate-limited — try again.</p>
            <button
              onClick={() => setReloadKey((k) => k + 1)}
              className="rounded-md border border-white/15 bg-white/5 px-3 py-1.5 text-[12px] font-semibold text-white/80 transition hover:bg-white/10"
            >
              Retry
            </button>
          </div>
        )}

        {!err && (!fc || !win) && (
          <div className="flex items-center gap-2 px-1 py-4 text-[13px] text-white/50">
            <span className="h-3.5 w-3.5 animate-spin rounded-full border-2 border-white/20 border-t-white/70" />
            Loading forecast…
          </div>
        )}

        {!err && fc && win && (
          <div className="space-y-3">
            {/* Staleness notice — the server serves its last good forecast when
                the upstream is down, which can be hours old. */}
            {(win.hours.length === 0 || Date.now() - fc.updated > 6 * 3_600_000) && (
              <div className="rounded-lg border border-sky-400/25 bg-sky-400/[0.07] px-3 py-2 text-[12px] leading-snug text-white/55">
                {win.hours.length === 0
                  ? 'This forecast has lapsed — the upstream feed appears degraded. '
                  : ''}
                Retrieved {timeAgo(fc.updated)}.
              </div>
            )}

            {/* Peak callout */}
            {win.peak && win.peak.aqi > 100 && (
              <div className="flex items-center gap-2 rounded-lg border border-amber-400/25 bg-amber-400/[0.07] px-3 py-2">
                <span className="text-[15px]">⚠️</span>
                <div className="min-w-0 flex-1 text-[12px]">
                  <span className="font-semibold text-amber-200/90">
                    Peaks at AQI {win.peak.aqi} ({CATEGORY_STYLE[aqiCategory(win.peak.aqi)].label})
                  </span>
                  <span className="ml-1 text-white/45">
                    {weekday(win.peak.date)} {fmtHour(win.peak.hh)} · next {win.hours.length}h
                  </span>
                </div>
              </div>
            )}

            {/* 48h hourly chart */}
            {win.hours.length > 0 && (
              <div>
                <div className="mb-1 text-[10px] font-semibold uppercase tracking-wider text-white/35">
                  Hourly · AQI (US)
                </div>
                <AqiChart
                  hours={win.hours}
                  niceMax={niceScale(win.hours.reduce((m, h) => Math.max(m, h.aqi), 0))}
                />
              </div>
            )}

            {/* Daily outlook */}
            {fc.daily.time.length > 0 && (
              <div>
                <div className="mb-1.5 text-[10px] font-semibold uppercase tracking-wider text-white/35">
                  {fc.daily.time.length}-day outlook · max AQI
                </div>
                <div className="flex gap-1">
                  {fc.daily.time.map((d, i) => (
                    <div
                      key={d}
                      className="flex flex-1 flex-col items-center gap-0.5 rounded-md bg-white/[0.04] py-1.5"
                      title={`${weekday(d)} ${monthDay(d)} · max AQI ${fc.daily.aqiMax[i]} (${
                        CATEGORY_STYLE[aqiCategory(fc.daily.aqiMax[i])].label
                      }), avg ${fc.daily.aqiMean[i]}`}
                    >
                      <span className="text-[10px] font-semibold text-white/55">{weekday(d)}</span>
                      <span
                        className="rounded px-1.5 py-0.5 font-mono text-[13px] font-bold tabular-nums"
                        style={{
                          color: aqiColor(fc.daily.aqiMax[i]),
                          backgroundColor: `${aqiColor(fc.daily.aqiMax[i])}1f`,
                        }}
                      >
                        {fc.daily.aqiMax[i]}
                      </span>
                      <span className="font-mono text-[9px] tabular-nums text-white/35">
                        avg {fc.daily.aqiMean[i]}
                      </span>
                    </div>
                  ))}
                </div>
              </div>
            )}

            <p className="text-[10px] leading-relaxed text-white/30">
              Model forecast · {fc.source} · local time {fc.timezone}
              {payload.forecasts?.length
                ? ''
                : ' · IQAir per-city forecasts require a paid API plan; this uses the free CAMS model instead'}
            </p>
          </div>
        )}
      </div>
    </div>
  );
}
