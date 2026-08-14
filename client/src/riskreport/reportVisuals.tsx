import type { OutlookDayCell, WildfireReportData } from './riskTypes';

// ── Visual widgets for the risk report ───────────────────────────────────────
// Pure SVG/JSX renderers over data the assembly already fetched — print-safe
// (SVG prints crisply; the print stylesheet keeps meaning-carrying colors).

// WMO weather code → emoji + label.
export function weatherGlyph(code: number): { icon: string; label: string } {
  if (code === 0) return { icon: '☀️', label: 'Clear' };
  if (code <= 2) return { icon: '🌤️', label: 'Partly cloudy' };
  if (code === 3) return { icon: '☁️', label: 'Overcast' };
  if (code === 45 || code === 48) return { icon: '🌫️', label: 'Fog' };
  if (code >= 51 && code <= 57) return { icon: '🌦️', label: 'Drizzle' };
  if (code >= 61 && code <= 67) return { icon: '🌧️', label: 'Rain' };
  if (code >= 71 && code <= 77) return { icon: '🌨️', label: 'Snow' };
  if (code >= 80 && code <= 82) return { icon: '🌦️', label: 'Showers' };
  if (code === 85 || code === 86) return { icon: '🌨️', label: 'Snow showers' };
  if (code >= 95) return { icon: '⛈️', label: 'Thunderstorms' };
  return { icon: '🌡️', label: '—' };
}

const dayName = (iso: string) => {
  const d = new Date(`${iso}T12:00:00`);
  return Number.isNaN(d.getTime())
    ? iso
    : d.toLocaleDateString('en-US', { weekday: 'short' });
};

// ── 10-day forecast strip (Wunderground-style) ───────────────────────────────
// Each day: glyph, precip probability, a hi/lo bar positioned against the
// period's full temperature span (so warm and cold days read at a glance),
// and max wind/gust.

export function ForecastStrip({ forecast }: { forecast: Extract<WildfireReportData['forecastDaily'], { days: unknown }> }) {
  const days = forecast.days.slice(0, 10);
  if (days.length === 0) return null;
  const allMax = Math.max(...days.map((d) => d.tMaxF));
  const allMin = Math.min(...days.map((d) => d.tMinF));
  const span = Math.max(1, allMax - allMin);
  const TRACK_H = 64;

  return (
    <div className="print-card overflow-x-auto rounded-lg border border-white/8 bg-white/4 px-2 py-3">
      <div className="flex min-w-[620px]">
        {days.map((d) => {
          const g = weatherGlyph(d.code);
          const topPct = ((allMax - d.tMaxF) / span) * 100;
          const heightPct = Math.max(8, ((d.tMaxF - d.tMinF) / span) * 100);
          const wet = d.precipProbPct >= 40;
          return (
            <div key={d.date} className="flex min-w-0 flex-1 flex-col items-center gap-1 border-r border-white/5 px-1 last:border-0">
              <div className="text-[10px] font-semibold text-white/60">{dayName(d.date)}</div>
              <div className="text-[18px] leading-none" title={g.label}>{g.icon}</div>
              <div className={`text-[9px] ${wet ? 'print-color font-semibold text-sky-300' : 'text-white/30'}`} style={wet ? { color: '#7dd3fc' } : undefined}>
                {Math.round(d.precipProbPct)}%
              </div>
              {/* Temperature bar against the 10-day span */}
              <div className="relative w-3" style={{ height: TRACK_H }}>
                <div className="absolute inset-x-1 inset-y-0 rounded-full bg-white/6" />
                <div
                  className="print-color absolute inset-x-0 rounded-full"
                  style={{
                    top: `${topPct}%`,
                    height: `${heightPct}%`,
                    background: 'linear-gradient(#fb923c, #38bdf8)',
                  }}
                  title={`${Math.round(d.tMaxF)}° / ${Math.round(d.tMinF)}°`}
                />
              </div>
              <div className="text-[10px] font-semibold text-white/80">{Math.round(d.tMaxF)}°</div>
              <div className="text-[9px] text-white/40">{Math.round(d.tMinF)}°</div>
              <div className="mt-0.5 text-[8px] text-white/35" title={`gusts ${Math.round(d.gustMaxMph)} mph`}>
                {Math.round(d.windMaxMph)} mph
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
}

// ── 48-hour wind chart ───────────────────────────────────────────────────────
// Speed area + gust dashed line, direction arrows along the top, hour labels.

export function WindChart({ hourly }: { hourly: NonNullable<WildfireReportData['windHourly']> }) {
  const n = hourly.speedMph.length;
  if (n === 0) return null;
  const W = 640;
  const H = 164;
  const PAD_L = 30;
  const PAD_B = 30; // two axis rows: hours + day labels
  const PAD_T = 22;
  const plotW = W - PAD_L - 6;
  const plotH = H - PAD_T - PAD_B;
  const maxV = Math.max(10, ...hourly.gustMph, ...hourly.speedMph) * 1.15;
  const x = (i: number) => PAD_L + (i / Math.max(1, n - 1)) * plotW;
  const y = (v: number) => PAD_T + plotH - (v / maxV) * plotH;

  const speedPath = hourly.speedMph.map((v, i) => `${i === 0 ? 'M' : 'L'}${x(i).toFixed(1)},${y(v).toFixed(1)}`).join(' ');
  const gustPath = hourly.gustMph.map((v, i) => `${i === 0 ? 'M' : 'L'}${x(i).toFixed(1)},${y(v).toFixed(1)}`).join(' ');
  const areaPath = `${speedPath} L${x(n - 1).toFixed(1)},${y(0)} L${x(0).toFixed(1)},${y(0)} Z`;

  const hourLabel = (iso: string) => {
    const hh = Number(iso.slice(11, 13));
    if (Number.isNaN(hh)) return '';
    if (hh === 0) return '12a';
    if (hh === 12) return '12p';
    return hh < 12 ? `${hh}a` : `${hh - 12}p`;
  };
  // "Today" / "Fri 8/15" for a local ISO hour string.
  const todayLocal = hourly.times[0]?.slice(0, 10);
  const dayLabel = (iso: string) => {
    if (iso.slice(0, 10) === todayLocal) return 'Today';
    const d = new Date(`${iso.slice(0, 10)}T12:00:00`);
    return Number.isNaN(d.getTime())
      ? iso.slice(5, 10)
      : d.toLocaleDateString('en-US', { weekday: 'short', month: 'numeric', day: 'numeric' });
  };
  // Day boundaries (local midnight) for separators + the start of each day span.
  const dayStarts = hourly.times
    .map((t, i) => ({ t, i }))
    .filter(({ t, i }) => i === 0 || t.slice(11, 13) === '00');

  const gridLines = [0.25, 0.5, 0.75, 1].map((f) => Math.round(maxV * f));

  return (
    <div className="print-card overflow-x-auto rounded-lg border border-white/8 bg-white/4 p-2">
      <svg viewBox={`0 0 ${W} ${H}`} className="print-color min-w-[520px]" style={{ width: '100%' }}>
        {gridLines.map((v) => (
          <g key={v}>
            <line x1={PAD_L} x2={W - 6} y1={y(v)} y2={y(v)} stroke="rgba(255,255,255,0.08)" strokeWidth="1" />
            <text x={PAD_L - 4} y={y(v) + 3} textAnchor="end" fontSize="8" fill="rgba(255,255,255,0.4)">{v}</text>
          </g>
        ))}
        {/* Day separators at local midnight */}
        {dayStarts.map(({ t, i }) =>
          i === 0 ? null : (
            <line key={`sep-${t}`} x1={x(i)} x2={x(i)} y1={PAD_T - 14} y2={H - PAD_B} stroke="rgba(255,255,255,0.14)" strokeWidth="1" strokeDasharray="2 3" />
          )
        )}
        <path d={areaPath} fill="rgba(61,220,255,0.14)" />
        <path d={speedPath} fill="none" stroke="#3ddcff" strokeWidth="2" />
        <path d={gustPath} fill="none" stroke="#fbbf24" strokeWidth="1.5" strokeDasharray="4 3" />
        {/* Direction arrows every 4 h — pointing where the wind blows TOWARD.
            The legend lives below the chart in HTML so nothing overlaps them. */}
        {hourly.dirDeg.map((deg, i) =>
          i % 4 === 0 ? (
            <g key={i} transform={`translate(${x(i)}, ${PAD_T - 10}) rotate(${(deg + 180) % 360})`}>
              <path d="M0,-5 L3,3 L0,1 L-3,3 Z" fill="rgba(255,255,255,0.55)" />
            </g>
          ) : null
        )}
        {/* Hour ticks */}
        {hourly.times.map((t, i) =>
          i % 8 === 0 ? (
            <text key={t} x={x(i)} y={H - 17} textAnchor="middle" fontSize="8" fill="rgba(255,255,255,0.4)">
              {hourLabel(t)}
            </text>
          ) : null
        )}
        {/* Day labels under the hours */}
        {dayStarts.map(({ t, i }) => (
          <text key={`day-${t}`} x={x(i) + 2} y={H - 5} textAnchor="start" fontSize="9" fontWeight="600" fill="rgba(255,255,255,0.6)">
            {dayLabel(t)}
          </text>
        ))}
      </svg>
      <div className="mt-1 flex items-center gap-4 px-1 text-[9px] text-white/50">
        <span className="flex items-center gap-1.5">
          <span className="print-color inline-block h-0.5 w-4 rounded" style={{ background: '#3ddcff' }} /> sustained (mph)
        </span>
        <span className="flex items-center gap-1.5">
          <span className="print-color inline-block h-0.5 w-4 rounded border-t border-dashed" style={{ borderColor: '#fbbf24' }} /> gusts (mph)
        </span>
        <span className="text-white/35">↑ arrows = direction the wind blows toward · local time at the property</span>
      </div>
    </div>
  );
}

// "Today" / "Fri 8/15" for an ISO date (null-safe — outlook dates can be null).
export const shortDayDate = (iso: string | null) => {
  if (!iso) return '—';
  const d = new Date(`${iso}T12:00:00`);
  return Number.isNaN(d.getTime())
    ? iso
    : d.toLocaleDateString('en-US', { weekday: 'short', month: 'numeric', day: 'numeric' });
};

// A compact swatch legend row — fuel groups, outlook classes, smoke density,
// lightning age. `line: true` renders a short bar instead of a square (for
// outline-styled overlays). Print-safe: swatches keep their colors on paper.
export function LegendRow({ items, className }: { items: { color: string; label: string; line?: boolean }[]; className?: string }) {
  return (
    <div className={`flex flex-wrap items-center gap-x-3 gap-y-1 px-1 ${className ?? ''}`}>
      {items.map((it) => (
        <span key={it.label} className="flex items-center gap-1.5 text-[9px] text-white/50">
          <span
            className={`print-color inline-block shrink-0 ${
              it.line ? 'h-1 w-4 rounded-full' : 'h-2.5 w-2.5 rounded-[2px] ring-1 ring-white/15'
            }`}
            style={{ background: it.color }}
          />
          {it.label}
        </span>
      ))}
    </div>
  );
}

// ── Summary chip strip — one colored cell per period ─────────────────────────
// The shared "forecast summarized on top of the map" format: label, colored
// bar, value. Used by the outlook (7 PSA days) and rainfall (24/48/72 h).
export interface StripCell {
  top: string;
  hex: string;
  bottom: string;
  emph?: boolean;
}

export function ChipStrip({ cells }: { cells: StripCell[] }) {
  if (cells.length === 0) return null;
  return (
    <div
      className="print-card grid gap-1"
      style={{ gridTemplateColumns: `repeat(${cells.length}, minmax(0, 1fr))` }}
    >
      {cells.map((c, i) => (
        <div key={i} className="rounded-lg border border-white/8 bg-white/4 px-1 py-1.5 text-center">
          <div className="text-[9px] font-semibold text-white/55">{c.top}</div>
          <div className="print-color mx-auto mt-1 h-2 w-full max-w-[46px] rounded-full" style={{ background: c.hex }} />
          <div className={`mt-1 text-[8px] leading-tight ${c.emph ? 'font-bold text-white/85' : 'text-white/45'}`}>
            {c.bottom}
          </div>
        </div>
      ))}
    </div>
  );
}

// 7-day outlook strip — one cell per day for the site's PSA.
export function OutlookStrip({ days }: { days: OutlookDayCell[] }) {
  return (
    <ChipStrip
      cells={days.map((d, i) => ({
        top: i === 0 ? 'Today' : shortDayDate(d.date),
        hex: d.hex,
        bottom: d.label,
        emph: d.sig,
      }))}
    />
  );
}

// A snapshot image block with a caption; renders nothing when the snapshot
// failed (null) so a tile outage never leaves a broken image in the report.
export function MapFigure({ src, caption, className }: { src: string | null; caption: string; className?: string }) {
  if (!src) return null;
  return (
    <figure className={`print-card overflow-hidden rounded-lg border border-white/10 ${className ?? ''}`}>
      <img src={src} alt={caption} className="block w-full" />
      <figcaption className="bg-white/4 px-3 py-1.5 text-[9px] text-white/40 print-muted">{caption}</figcaption>
    </figure>
  );
}
