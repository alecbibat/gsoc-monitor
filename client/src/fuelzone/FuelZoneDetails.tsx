import { rgbCss } from '../layers/fuel/fbfm40';
import { formatRadius } from './fuelZoneStore';
import type { FuelZoneResult, FuelRisk, RiskLevel } from './zonalStats';

interface Props {
  payload: FuelZoneResult;
}

const ACRES_PER_M2 = 1 / 4046.8564224;

function fmtPct(pct: number): string {
  if (pct > 0 && pct < 0.1) return '<0.1%';
  return `${pct >= 10 ? pct.toFixed(0) : pct.toFixed(1)}%`;
}

function fmtArea(areaM2: number): string {
  const acres = areaM2 * ACRES_PER_M2;
  const km2 = areaM2 / 1_000_000;
  const acresStr =
    acres >= 1000 ? Math.round(acres).toLocaleString() : acres.toFixed(acres >= 10 ? 0 : 1);
  const km2Str = km2 >= 10 ? Math.round(km2).toLocaleString() : km2.toFixed(km2 >= 1 ? 1 : 2);
  return `${acresStr} acres · ${km2Str} km²`;
}

function fmtCoord(lon: number, lat: number): string {
  const ns = lat >= 0 ? 'N' : 'S';
  const ew = lon >= 0 ? 'E' : 'W';
  return `${Math.abs(lat).toFixed(3)}°${ns}, ${Math.abs(lon).toFixed(3)}°${ew}`;
}

// --- Risk card --------------------------------------------------------------

const RISK_STYLE: Record<RiskLevel, { text: string; border: string; bar: string }> = {
  'Low':       { text: 'text-emerald-400', border: 'border-emerald-500/25', bar: 'bg-emerald-400' },
  'Moderate':  { text: 'text-yellow-400',  border: 'border-yellow-500/25',  bar: 'bg-yellow-400' },
  'High':      { text: 'text-amber-400',   border: 'border-amber-500/25',   bar: 'bg-amber-400' },
  'Very High': { text: 'text-orange-400',  border: 'border-orange-500/25',  bar: 'bg-orange-400' },
  'Extreme':   { text: 'text-red-500',     border: 'border-red-500/30',     bar: 'bg-red-500' },
};

const SPREAD_COLOR: Record<FuelRisk['spreadCat'], string> = {
  'Slow':      'text-emerald-400',
  'Moderate':  'text-yellow-400',
  'Fast':      'text-amber-400',
  'Very Fast': 'text-red-400',
};

const FLAME_COLOR: Record<FuelRisk['flameCat'], string> = {
  'Short':     'text-emerald-400',
  'Moderate':  'text-yellow-400',
  'Long':      'text-amber-400',
  'Very Long': 'text-red-400',
};

function RiskCard({ risk }: { risk: FuelRisk | null }) {
  if (!risk) return null;
  const s = RISK_STYLE[risk.level];
  return (
    <div className={`rounded-lg border bg-white/[0.03] px-3 py-2.5 ${s.border}`}>
      <div className="mb-2 text-[10px] font-semibold uppercase tracking-wider text-white/35">
        Fire Behavior Potential
      </div>

      {/* Level label + numeric score */}
      <div className="flex items-baseline justify-between">
        <span className={`text-[17px] font-black uppercase tracking-wide ${s.text}`}>
          {risk.level}
        </span>
        <span className="font-mono text-[11px] text-white/35">{risk.score} / 100</span>
      </div>

      {/* Score bar */}
      <div className="mb-3 mt-1.5 h-1.5 w-full overflow-hidden rounded-full bg-white/10">
        <div className={`h-full rounded-full ${s.bar}`} style={{ width: `${risk.score}%` }} />
      </div>

      {/* Sub-indicators */}
      <div className="mb-2.5 flex gap-5">
        <div>
          <div className="text-[9px] uppercase tracking-wider text-white/30">Spread Rate</div>
          <div className={`text-[12px] font-semibold ${SPREAD_COLOR[risk.spreadCat]}`}>
            {risk.spreadCat}
          </div>
        </div>
        <div>
          <div className="text-[9px] uppercase tracking-wider text-white/30">Flame Length</div>
          <div className={`text-[12px] font-semibold ${FLAME_COLOR[risk.flameCat]}`}>
            {risk.flameCat}
          </div>
        </div>
      </div>

      {/* Driver bullets */}
      {risk.drivers.length > 0 && (
        <ul className="space-y-1 border-t border-white/5 pt-2">
          {risk.drivers.map((d, i) => (
            <li key={i} className="flex items-start gap-1.5 text-[11px] leading-snug text-white/50">
              <span className="mt-0.5 shrink-0 text-white/20">•</span>
              {d}
            </li>
          ))}
        </ul>
      )}

      <div className="mt-2 text-[9px] text-white/20">
        Fuel-model potential · standard fire weather
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------

export function FuelZoneDetails({ payload }: Props) {
  const { totalPixels, areaM2, burnablePct, classes, groups, risk } = payload;

  if (totalPixels === 0) {
    return (
      <div className="space-y-3">
        <div className="rounded-lg bg-white/5 px-3 py-4 text-[13px] leading-relaxed text-white/60">
          No LANDFIRE fuel data in this area. The{' '}
          {payload.shape === 'polygon' ? 'polygon' : 'circle'} falls outside the
          continental-US coverage of the fuel-model raster — most likely over
          ocean or beyond the CONUS border.
        </div>
        <Footer payload={payload} />
      </div>
    );
  }

  const burnableLabel =
    burnablePct >= 66 ? 'mostly burnable' : burnablePct >= 33 ? 'mixed' : 'mostly nonburnable';

  return (
    <div className="space-y-3.5">
      {/* Headline: burnable share + area */}
      <div className="rounded-lg bg-white/5 px-3 py-2.5">
        <div className="flex items-baseline justify-between">
          <span className="text-3xl font-black tabular-nums text-amber-300">
            {fmtPct(burnablePct)}
          </span>
          <span className="text-[11px] uppercase tracking-wider text-white/40">{burnableLabel}</span>
        </div>
        <div className="mt-0.5 text-[12px] text-white/55">
          burnable fuels across {fmtArea(areaM2)}
        </div>
      </div>

      {/* Risk assessment */}
      <RiskCard risk={risk} />

      {/* Stacked group bar */}
      <div>
        <div className="flex h-3 w-full overflow-hidden rounded-full">
          {groups.map((g) => (
            <div
              key={g.key}
              style={{ width: `${g.pct}%`, backgroundColor: rgbCss(g.rgb) }}
              title={`${g.label} · ${fmtPct(g.pct)}`}
            />
          ))}
        </div>

        {/* Group rollup rows */}
        <div className="mt-2 space-y-1">
          {groups.map((g) => (
            <div key={g.key} className="flex items-center gap-2 text-[12px]">
              <span
                className="h-2.5 w-2.5 shrink-0 rounded-[2px]"
                style={{ backgroundColor: rgbCss(g.rgb) }}
              />
              <span className="flex-1 text-white/70">{g.label}</span>
              {!g.burnable && (
                <span className="text-[9px] uppercase tracking-wide text-white/30">non-burn</span>
              )}
              <span className="font-mono font-semibold tabular-nums text-white/80">
                {fmtPct(g.pct)}
              </span>
            </div>
          ))}
        </div>
      </div>

      {/* Individual fuel models */}
      <div>
        <div className="mb-1.5 text-[10px] font-semibold uppercase tracking-wider text-white/30">
          Fuel models ({classes.length})
        </div>
        <div className="space-y-1.5">
          {classes.map((c) => (
            <div key={c.value} className="space-y-0.5">
              <div className="flex items-center gap-2 text-[12px]">
                <span
                  className="h-3 w-3 shrink-0 rounded-[2px] ring-1 ring-white/10"
                  style={{ backgroundColor: rgbCss(c.rgb) }}
                />
                <span className="w-9 shrink-0 font-mono font-semibold text-white/80">{c.code}</span>
                <span className="flex-1 truncate text-white/50" title={c.name}>
                  {c.name}
                </span>
                <span className="font-mono tabular-nums text-white/70">{fmtPct(c.pct)}</span>
              </div>
              <div className="ml-5 h-1 w-full overflow-hidden rounded-full bg-white/5">
                <div
                  className="h-full rounded-full"
                  style={{ width: `${c.pct}%`, backgroundColor: rgbCss(c.rgb) }}
                />
              </div>
            </div>
          ))}
        </div>
      </div>

      <Footer payload={payload} />
    </div>
  );
}

function Footer({ payload }: { payload: FuelZoneResult }) {
  const { center, radiusM, vertexCount, totalPixels, shape } = payload;
  return (
    <dl className="grid grid-cols-[auto_1fr] gap-x-3 gap-y-1.5 border-t border-white/10 pt-2.5 text-[12px]">
      <dt className="text-white/40">{shape === 'polygon' ? 'Centroid' : 'Center'}</dt>
      <dd className="font-mono text-white/70">{fmtCoord(center.lon, center.lat)}</dd>

      {shape === 'polygon' ? (
        <>
          <dt className="text-white/40">Vertices</dt>
          <dd className="text-white/70">{vertexCount}-point boundary</dd>
        </>
      ) : (
        <>
          <dt className="text-white/40">Radius</dt>
          <dd className="text-white/70">{formatRadius(radiusM)}</dd>
        </>
      )}

      {totalPixels > 0 && (
        <>
          <dt className="text-white/40">Cells</dt>
          <dd className="text-white/70">{totalPixels.toLocaleString()} × 30 m</dd>
        </>
      )}

      <dt className="text-white/40">Source</dt>
      <dd className="text-white/70">{payload.version}</dd>
    </dl>
  );
}
