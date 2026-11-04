import type { CSSProperties, ReactNode } from 'react';

// Building blocks for the compact one-line keys in the map legend panel
// (MapLegends): one row per active layer, so each key has to read at a glance
// in a single line. Two shapes cover every layer:
//   - KeyRamp: a colour bar, smooth or in hard steps, with tick labels under
//     the colours they name (continuous and stepped scales);
//   - KeySteps: a row of map symbols, each over a short label (classes).
// Each step's full wording is its hover title, and the layer's full legend is
// one click away in the panel. Store-free, like the full legends.

export interface RampTick {
  /** Position along the bar: 0 = left edge, 1 = right edge. */
  at: number;
  label: string;
}

/** Places a tick label: flush with the bar at either end, else centred on its point. */
export function tickStyle(at: number): CSSProperties {
  if (at <= 0) return { left: 0 };
  if (at >= 1) return { right: 0 };
  return { left: `${at * 100}%`, transform: 'translateX(-50%)' };
}

/** A tick under step `index` of `count` equal steps; the first and last sit flush with the ends. */
export function stepTick(index: number, count: number, label: string): RampTick {
  if (index <= 0) return { at: 0, label };
  if (index >= count - 1) return { at: 1, label };
  return { at: (index + 0.5) / count, label };
}

/** Short age for a class bound in minutes: 2 → "2m", 60 → "1h", 720 → "12h". */
export function ageLabel(minutes: number): string {
  return minutes < 60 ? `${minutes}m` : `${Math.round((minutes / 60) * 10) / 10}h`;
}

/** A row of tick labels positioned along a bar of the same width. */
export function KeyTicks({ ticks }: { ticks: readonly RampTick[] }) {
  return (
    <div className="relative h-[11px] text-[9px] leading-[11px] tabular-nums text-white/50">
      {ticks.map((t) => (
        <span key={`${t.at}:${t.label}`} className="absolute top-0 whitespace-nowrap" style={tickStyle(t.at)}>
          {t.label}
        </span>
      ))}
    </div>
  );
}

/**
 * A colour bar with ticks. Hard steps by default — one block per colour, each
 * titled when `stepTitles` is given; `smooth` blends them into a gradient.
 */
export function KeyRamp({
  colors,
  smooth = false,
  stepTitles,
  ticks,
}: {
  colors: readonly string[];
  smooth?: boolean;
  stepTitles?: readonly string[];
  ticks: readonly RampTick[];
}) {
  return (
    <div>
      {smooth ? (
        <div
          className="h-2 rounded-sm ring-1 ring-white/10"
          style={{ background: `linear-gradient(to right, ${colors.join(', ')})` }}
        />
      ) : (
        <div className="flex h-2 overflow-hidden rounded-sm ring-1 ring-white/10">
          {colors.map((c, i) => (
            <div key={i} className="flex-1" style={{ backgroundColor: c }} title={stepTitles?.[i]} />
          ))}
        </div>
      )}
      <div className="mt-0.5">
        <KeyTicks ticks={ticks} />
      </div>
    </div>
  );
}

export interface KeyStep {
  id: string;
  /** The symbol as the map draws it (swatch, glyph…), at most 12px tall. */
  symbol: ReactNode;
  /** A word or two; `title` carries the full wording. */
  label: string;
  title?: string;
}

/** Symbols spread across the row, each over its label — first and last flush with the edges. */
export function KeySteps({ steps }: { steps: readonly KeyStep[] }) {
  return (
    <div className="flex items-start justify-between gap-1">
      {steps.map((s) => (
        <div key={s.id} title={s.title} className="flex min-w-0 flex-col items-center gap-[3px]">
          <span className="flex h-3 items-center justify-center">{s.symbol}</span>
          <span className="max-w-full truncate text-[9px] leading-[11px] text-white/55">{s.label}</span>
        </div>
      ))}
    </div>
  );
}

/** A 10px square swatch; the caller passes the layer's own fill/outline so it matches the map. */
export function Swatch({ className = '', style }: { className?: string; style: CSSProperties }) {
  return <span className={`block h-2.5 w-2.5 shrink-0 rounded-[2px] ${className}`} style={style} />;
}
