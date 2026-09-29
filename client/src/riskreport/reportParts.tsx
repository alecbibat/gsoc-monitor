import type { ReactNode } from 'react';
import { RISK_LEVELS, RISK_RINGS, type RiskLevel, type SectionResult } from './riskTypes';
import { QPF_LEGEND } from '../layers/precip/precipStore';
import type { StripCell } from './reportVisuals';

// ── Building blocks shared by every hazard's report body ─────────────────────
// Level chips, stat cards, the section frame (with its honest "Unavailable"
// state), the WPC rainfall chips/ramp and the sources footer. Print-safe: the
// same classes the shared print pipeline already themes.

export function fmtTs(iso: string) {
  try { return new Date(iso).toLocaleString('en-US', { month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit', timeZoneName: 'short' }); }
  catch { return iso; }
}

export const num = (v: number | undefined | null, digits = 0) =>
  v === undefined || v === null || Number.isNaN(v) ? '—' : v.toFixed(digits);

export function LevelBadge({ level, size = 'md' }: { level: RiskLevel; size?: 'md' | 'lg' }) {
  const def = RISK_LEVELS[level];
  return (
    <span
      className={`print-color inline-flex items-center gap-1.5 rounded-full border font-bold uppercase tracking-widest ${
        size === 'lg' ? 'px-3 py-1 text-[12px]' : 'px-2 py-0.5 text-[9px]'
      }`}
      style={{ color: def.color, background: `${def.color}1c`, borderColor: `${def.color}55` }}
    >
      <span className="h-1.5 w-1.5 rounded-full" style={{ background: def.color }} />
      {def.label}
    </span>
  );
}

export function StatCard({ label, value, sub }: { label: string; value: string; sub?: string }) {
  return (
    <div className="print-card rounded-lg border border-white/8 bg-white/4 px-3.5 py-3">
      <div className="text-[9px] font-bold uppercase tracking-[0.14em] text-white/35 print-muted">{label}</div>
      <div className="mt-1 text-[15px] font-semibold text-white/85">{value}</div>
      {sub && <div className="mt-0.5 text-[10px] text-white/40 print-muted">{sub}</div>}
    </div>
  );
}

export function Section({ section, children }: { section: SectionResult; children?: ReactNode }) {
  return (
    <section className="print-card">
      <div className="mb-2 flex items-center gap-3">
        <h2 className="text-[11px] font-bold uppercase tracking-[0.14em] text-white/50">{section.title}</h2>
        {section.unavailable ? (
          <span className="rounded-full border border-white/15 bg-white/5 px-2 py-0.5 text-[9px] font-bold uppercase tracking-widest text-white/40">
            Unavailable
          </span>
        ) : (
          <>
            {section.countLabel && (
              <span className="rounded-full border border-white/15 bg-white/6 px-2 py-0.5 text-[9px] font-bold uppercase tracking-widest text-white/55">
                {section.countLabel}
              </span>
            )}
            {/* A count-framed section only shows a risk chip when it actually
                raises risk — "None active · Low" was answering two questions. */}
            {(!section.countLabel || section.level !== 'low') && <LevelBadge level={section.level} />}
          </>
        )}
      </div>
      {section.unavailable ? (
        <p className="rounded-lg border border-white/8 bg-white/4 px-4 py-3 text-[12px] text-white/45">{section.unavailable}</p>
      ) : (
        <>
          {section.drivers.length > 0 && (
            <ul className="mb-2 space-y-0.5 text-[12px] text-white/70">
              {section.drivers.map((d, i) => (
                <li key={i}>· {d}</li>
              ))}
            </ul>
          )}
          {children}
        </>
      )}
    </section>
  );
}

/** Heading for a block that is not a leveled section (maps, charts, forecast). */
export function BlockTitle({ children }: { children: ReactNode }) {
  return <h2 className="mb-2 text-[11px] font-bold uppercase tracking-[0.14em] text-white/50">{children}</h2>;
}

// Chip color from the exact WPC ramp the map renders — below the first ramp
// step (0.01 in) the map draws nothing, so the chip goes neutral gray.
export const qpfHex = (inches: number): string => {
  let rgb: [number, number, number] | null = null;
  for (const s of QPF_LEGEND) {
    if (inches >= s.inches) rgb = s.rgb;
    else break;
  }
  return rgb ? `rgb(${rgb[0]}, ${rgb[1]}, ${rgb[2]})` : '#4b5563';
};

/** Site rainfall chips (24/48/72 h, and 5 days when present), WPC ramp colors. */
export function rainCells(rain: { in24?: number; in48?: number; in72?: number; in120?: number }): StripCell[] {
  const windows: Array<[string, number | undefined]> = [
    ['Next 24 h', rain.in24],
    ['Next 48 h', rain.in48],
    ['Next 72 h', rain.in72],
    ['Next 5 days', rain.in120],
  ];
  return windows
    .filter((w): w is [string, number] => w[1] !== undefined)
    .map(([top, v]) => ({
      top,
      hex: qpfHex(v),
      bottom: v < 0.005 ? 'None' : v < 0.01 ? '<0.01 in' : `${v.toFixed(2)} in`,
      emph: v >= 0.5,
    }));
}

// The exact WPC accumulation ramp under the rainfall map (mirrors the globe
// layer's PrecipLegend; tick labels are approximate positions on the ramp).
export function QpfRampLegend() {
  return (
    <div className="px-1">
      <div className="print-color flex h-2.5 overflow-hidden rounded-sm ring-1 ring-white/10">
        {QPF_LEGEND.map((s) => (
          <div
            key={s.inches}
            className="flex-1"
            style={{ background: `rgb(${s.rgb[0]}, ${s.rgb[1]}, ${s.rgb[2]})` }}
            title={`${s.inches}"`}
          />
        ))}
      </div>
      <div className="mt-0.5 flex justify-between text-[8px] tabular-nums text-white/40">
        <span>0.01&quot;</span>
        <span>0.5</span>
        <span>1</span>
        <span>2</span>
        <span>5</span>
        <span>20+</span>
      </div>
    </div>
  );
}

/** Sources, known gaps and the generated/advisory line closing every report. */
export function SourcesFooter({
  sources,
  gaps,
  generatedAt,
}: {
  sources: { name: string; detail: string }[];
  gaps: string[];
  generatedAt: string;
}) {
  return (
    <section className="print-card border-t border-white/8 pt-4">
      <h2 className="mb-2 text-[10px] font-bold uppercase tracking-[0.14em] text-white/35">Sources</h2>
      <ul className="space-y-0.5 text-[10px] text-white/40 print-muted">
        {sources.map((s, i) => (
          <li key={i}><span className="text-white/60">{s.name}</span> — {s.detail}</li>
        ))}
      </ul>
      {gaps.length > 0 && (
        <p className="mt-3 text-[10px] leading-relaxed text-white/30 print-muted">
          Not yet factored: {gaps.join(' · ')}
        </p>
      )}
      <p className="mt-3 text-center text-[9px] text-white/25 print-muted">
        Generated {fmtTs(generatedAt)} · fixed analysis rings ({RISK_RINGS.map((r) => r.label).join(' / ')}) · advisory product, verify against official sources before acting
      </p>
    </section>
  );
}
