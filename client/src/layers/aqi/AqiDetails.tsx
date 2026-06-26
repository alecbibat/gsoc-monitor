import type { AqiStation } from '../../types';

interface Props {
  payload: AqiStation;
}

// Official EPA AQI color scale.
const CATEGORY_STYLE: Record<number, { bg: string; text: string; label: string; desc: string }> = {
  1: { bg: 'bg-green-500/20',  text: 'text-green-400',  label: 'Good',                          desc: 'Air quality is satisfactory with little or no risk.' },
  2: { bg: 'bg-yellow-400/20', text: 'text-yellow-300', label: 'Moderate',                      desc: 'Acceptable, but some pollutants may be a concern for sensitive individuals.' },
  3: { bg: 'bg-orange-500/20', text: 'text-orange-400', label: 'Unhealthy for Sensitive Groups', desc: 'Sensitive groups (elderly, children, heart/lung conditions) should limit exposure.' },
  4: { bg: 'bg-red-500/20',    text: 'text-red-400',    label: 'Unhealthy',                     desc: 'Everyone may begin to experience health effects.' },
  5: { bg: 'bg-purple-700/20', text: 'text-purple-400', label: 'Very Unhealthy',                desc: 'Health alert — everyone may experience serious health effects.' },
  6: { bg: 'bg-rose-900/20',   text: 'text-rose-400',   label: 'Hazardous',                     desc: 'Emergency conditions — the entire population is likely to be affected.' },
};

const PARAM_LABEL: Record<string, string> = {
  'PM2.5': 'PM2.5 (fine particles)',
  'PM10':  'PM10 (coarse particles)',
  'O3':    'Ozone (O₃)',
  'CO':    'Carbon Monoxide (CO)',
  'NO2':   'Nitrogen Dioxide (NO₂)',
  'SO2':   'Sulfur Dioxide (SO₂)',
};

function timeAgo(sec?: number): string {
  if (!sec) return '—';
  const mins = Math.max(0, Math.round(Date.now() / 1000 / 60 - sec / 60));
  if (mins < 1) return 'just now';
  if (mins < 60) return `${mins} min ago`;
  const h = Math.floor(mins / 60);
  return `${h}h ${mins % 60}m ago`;
}

export function AqiDetails({ payload }: Props) {
  const { source, aqi, categoryNum, categoryName, parameter, reportingArea, state,
          hourObserved, timezone, all } = payload;
  const style = CATEGORY_STYLE[categoryNum] ?? CATEGORY_STYLE[1];
  const isPa = source === 'purpleair';

  return (
    <div className="space-y-3">
      {/* AQI badge */}
      <div className={`flex items-center gap-3 rounded-lg px-3 py-2.5 ${style.bg}`}>
        <span className={`text-4xl font-black tabular-nums ${style.text}`}>{aqi}</span>
        <div>
          <div className={`flex items-center gap-1.5 text-sm font-bold ${style.text}`}>
            {style.label}
            {isPa && (
              <span className="rounded bg-white/10 px-1 py-0.5 text-[9px] font-semibold uppercase tracking-wide text-white/50">
                est.
              </span>
            )}
          </div>
          <div className="text-[11px] text-white/50 leading-snug mt-0.5">{style.desc}</div>
        </div>
      </div>

      {isPa ? (
        <>
          <dl className="grid grid-cols-[auto_1fr] gap-x-3 gap-y-1.5 text-[13px]">
            <dt className="text-white/40">Sensor</dt>
            <dd className="truncate" title={reportingArea}>{reportingArea}</dd>

            <dt className="text-white/40">PM2.5 (corrected)</dt>
            <dd className="tabular-nums">
              {payload.pm25 ?? '—'} µg/m³
              {payload.pm25Raw != null && (
                <span className="ml-1 text-white/35">(raw {payload.pm25Raw})</span>
              )}
            </dd>

            {payload.humidity != null && (
              <>
                <dt className="text-white/40">Humidity</dt>
                <dd className="tabular-nums">{payload.humidity}%</dd>
              </>
            )}
            {payload.confidence != null && (
              <>
                <dt className="text-white/40">Confidence</dt>
                <dd className="tabular-nums">{payload.confidence}/100</dd>
              </>
            )}

            <dt className="text-white/40">Updated</dt>
            <dd>{timeAgo(payload.lastSeen)}</dd>

            <dt className="text-white/40">Source</dt>
            <dd>PurpleAir sensor</dd>
          </dl>

          <p className="rounded-lg bg-white/5 px-3 py-2 text-[11px] leading-relaxed text-white/45">
            Low-cost community sensor. AQI is estimated from PM2.5 using the US EPA
            correction (Barkjohn 2021) so it lines up with the AirNow reference
            monitors — treat it as an indicative reading, not a regulatory one.
          </p>
        </>
      ) : (
        <>
          {/* All parameters at this station */}
          {all.length > 1 && (
            <div className="space-y-1">
              <div className="text-[10px] font-semibold uppercase tracking-wider text-white/30">
                All pollutants
              </div>
              <div className="space-y-1">
                {[...all].sort((a, b) => b.aqi - a.aqi).map((p) => {
                  const entry = Object.entries(CATEGORY_STYLE).find(([, v]) => v.label === p.category);
                  const s = CATEGORY_STYLE[entry ? Number(entry[0]) : 1] ?? CATEGORY_STYLE[1];
                  return (
                    <div key={p.parameter} className="flex items-center justify-between text-[12px]">
                      <span className="text-white/60">{PARAM_LABEL[p.parameter] ?? p.parameter}</span>
                      <span className={`font-bold tabular-nums ${s.text}`}>{p.aqi}</span>
                    </div>
                  );
                })}
              </div>
            </div>
          )}

          {all.length === 1 && (
            <div className="text-[12px] text-white/50">
              Dominant pollutant: {PARAM_LABEL[parameter] ?? parameter}
            </div>
          )}

          <dl className="grid grid-cols-[auto_1fr] gap-x-3 gap-y-1.5 text-[13px]">
            <dt className="text-white/40">Reporting area</dt>
            <dd>{reportingArea}{state ? `, ${state}` : ''}</dd>

            <dt className="text-white/40">Observed</dt>
            <dd>{hourObserved}:00 {timezone}</dd>

            <dt className="text-white/40">Source</dt>
            <dd>US EPA AirNow</dd>
          </dl>
        </>
      )}
    </div>
  );
}
