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

export function AqiDetails({ payload }: Props) {
  const { aqi, categoryNum, categoryName, parameter, reportingArea, state,
          hourObserved, timezone, all } = payload;
  const style = CATEGORY_STYLE[categoryNum] ?? CATEGORY_STYLE[1];

  return (
    <div className="space-y-3">
      {/* AQI badge */}
      <div className={`flex items-center gap-3 rounded-lg px-3 py-2.5 ${style.bg}`}>
        <span className={`text-4xl font-black tabular-nums ${style.text}`}>{aqi}</span>
        <div>
          <div className={`text-sm font-bold ${style.text}`}>{style.label}</div>
          <div className="text-[11px] text-white/50 leading-snug mt-0.5">{style.desc}</div>
        </div>
      </div>

      {/* All parameters at this station */}
      {all.length > 1 && (
        <div className="space-y-1">
          <div className="text-[10px] font-semibold uppercase tracking-wider text-white/30">
            All pollutants
          </div>
          <div className="space-y-1">
            {[...all].sort((a, b) => b.aqi - a.aqi).map((p) => {
              const s = CATEGORY_STYLE[
                Object.entries(CATEGORY_STYLE).find(([, v]) => v.label === p.category)?.[0]
                  ? Number(Object.entries(CATEGORY_STYLE).find(([, v]) => v.label === p.category)![0])
                  : 1
              ] ?? CATEGORY_STYLE[1];
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
    </div>
  );
}
