import { useEffect, useState } from 'react';
import { RISK_RINGS, type RiskTarget } from './riskTypes';
import { WILDFIRE_FEEDS, type FeedProgress, type FeedResult } from './feedManifest';

// ── Risk-report loading screen: radar scope + feed acquisition console ───────
// Everything animated here is real: the scope's rings are the report's actual
// analysis rings (1/5/25/100 mi, log-spaced like real range rings), and the
// console rows flip as each feed's fetch settles in assembleWildfire — no
// fake staged progress, matching the report's fail-honest rule. A feed the
// report will call unavailable shows DOWN here, not LOCK.

const SIZE = 300;
const C = SIZE / 2;
const R = 136;
const SWEEP_S = 3.6; // one sweep revolution — blip delays sync to this

// Ember blips the sweep "detects" each pass: deterministic polar positions
// (degrees clockwise from north — the sweep's own coordinate system) so the
// scope reads identically on every open and never re-rolls on re-render.
const BLIPS = [
  { deg: 38, f: 0.55, r: 2.6 },
  { deg: 96, f: 0.82, r: 2.0 },
  { deg: 141, f: 0.34, r: 3.0 },
  { deg: 205, f: 0.66, r: 2.4 },
  { deg: 252, f: 0.88, r: 1.8 },
  { deg: 297, f: 0.48, r: 2.8 },
  { deg: 338, f: 0.72, r: 2.0 },
];

// Log-spaced ring radius, like a real range scope: 1 mi lands at 0.22·R,
// 100 mi at 0.94·R.
const ringFrac = (miles: number) => 0.22 + (Math.log10(miles) / 2) * 0.72;

const blipXY = (deg: number, f: number): [number, number] => {
  const a = (deg * Math.PI) / 180;
  return [C + Math.sin(a) * f * R, C - Math.cos(a) * f * R];
};

function Scope() {
  return (
    <div className="relative" style={{ width: SIZE, height: SIZE }}>
      {/* Targeting brackets */}
      {[
        'left-0 top-0 border-l border-t',
        'right-0 top-0 border-r border-t',
        'left-0 bottom-0 border-l border-b',
        'right-0 bottom-0 border-r border-b',
      ].map((pos) => (
        <span key={pos} className={`absolute h-4 w-4 border-accent/40 ${pos}`} />
      ))}

      <svg width={SIZE} height={SIZE} viewBox={`0 0 ${SIZE} ${SIZE}`} aria-hidden>
        <defs>
          <radialGradient id="risk-scan-disc">
            <stop offset="0%" stopColor="rgba(61,220,255,0.07)" />
            <stop offset="70%" stopColor="rgba(61,220,255,0.02)" />
            <stop offset="100%" stopColor="rgba(61,220,255,0)" />
          </radialGradient>
        </defs>

        <circle cx={C} cy={C} r={R} fill="url(#risk-scan-disc)" stroke="rgba(61,220,255,0.35)" strokeWidth="1" />

        {/* Bezel ticks — minor every 6°, major every 30° */}
        {Array.from({ length: 60 }, (_, i) => {
          const major = i % 5 === 0;
          const a = (i * 6 * Math.PI) / 180;
          const [dx, dy] = [Math.sin(a), -Math.cos(a)];
          const inner = R - (major ? 9 : 4);
          return (
            <line
              key={i}
              x1={C + dx * R} y1={C + dy * R}
              x2={C + dx * inner} y2={C + dy * inner}
              stroke={major ? 'rgba(61,220,255,0.32)' : 'rgba(61,220,255,0.14)'}
              strokeWidth="1"
            />
          );
        })}

        {/* Radial spokes — crosshair brighter than diagonals */}
        {Array.from({ length: 8 }, (_, i) => {
          const a = (i * 45 * Math.PI) / 180;
          const [dx, dy] = [Math.sin(a), -Math.cos(a)];
          return (
            <line
              key={i}
              x1={C} y1={C} x2={C + dx * R} y2={C + dy * R}
              stroke={i % 2 === 0 ? 'rgba(230,241,245,0.09)' : 'rgba(230,241,245,0.04)'}
              strokeWidth="1"
            />
          );
        })}

        {/* The report's actual analysis rings */}
        {RISK_RINGS.map((ring) => {
          const r = ringFrac(ring.miles) * R;
          return (
            <g key={ring.id}>
              <circle cx={C} cy={C} r={r} fill="none" stroke="rgba(61,220,255,0.22)" strokeWidth="1" strokeDasharray="3 5" />
              <text
                x={C + 3} y={C - r + 9}
                fontSize="7" fontFamily="'JetBrains Mono', monospace"
                fill="rgba(230,241,245,0.38)"
              >
                {ring.label}
              </text>
            </g>
          );
        })}

        {/* Ember blips — each ignites as the sweep passes its bearing (negative
            delay keeps the cycle live from the first frame); the static 0.45
            opacity is the reduced-motion rendering. */}
        {BLIPS.map((b, i) => {
          const [x, y] = blipXY(b.deg, b.f);
          const delay = `${((b.deg / 360) * SWEEP_S - SWEEP_S).toFixed(2)}s`;
          return (
            <g key={i} className="risk-scan-blip" opacity="0.45" style={{ animationDelay: delay }}>
              <circle cx={x} cy={y} r={b.r * 2.4} fill="rgba(251,146,60,0.22)" />
              <circle cx={x} cy={y} r={b.r} fill="#fb923c" />
            </g>
          );
        })}
      </svg>

      {/* Rotating sweep — conic trail behind a bright leading edge at 12
          o'clock, spinning clockwise. Sits above the blips so they read as
          returns glowing through the beam. */}
      <div
        className="risk-scan-sweep pointer-events-none absolute rounded-full"
        style={{
          inset: C - R,
          background:
            'conic-gradient(from 0deg, transparent 0deg, transparent 285deg, rgba(251,146,60,0.02) 297deg, rgba(251,146,60,0.16) 344deg, rgba(255,200,150,0.5) 358deg, rgba(255,224,189,0.85) 360deg)',
        }}
      />

      {/* Slow counter-rotating outer dial */}
      <div className="risk-scan-dial pointer-events-none absolute inset-[3px] rounded-full border border-dashed border-accent/15" />

      {/* The property at scope center */}
      <div className="pointer-events-none absolute left-1/2 top-1/2 h-2 w-2 -translate-x-1/2 -translate-y-1/2">
        <span className="risk-scan-echo absolute -inset-1.5 rounded-full border border-orange-400/60" />
        <span className="absolute inset-0 rotate-45 bg-orange-300 shadow-[0_0_10px_rgba(251,146,60,0.9)]" />
      </div>
    </div>
  );
}

function StatusDot({ result }: { result: FeedResult | undefined }) {
  if (result === 'ok')
    return <span className="risk-scan-lock h-[7px] w-[7px] flex-none rounded-full bg-accent-ok shadow-[0_0_6px_rgba(82,227,164,0.7)]" />;
  if (result === 'failed')
    return <span className="risk-scan-lock h-[7px] w-[7px] flex-none rounded-full bg-accent-danger shadow-[0_0_6px_rgba(255,93,93,0.7)]" />;
  if (result === 'skipped')
    return <span className="h-[7px] w-[7px] flex-none rounded-full border border-white/25" />;
  return <span className="risk-scan-wait h-[7px] w-[7px] flex-none rounded-full border border-amber-300/70" />;
}

const STATE_WORD: Record<FeedResult | 'pending', { word: string; cls: string }> = {
  pending: { word: 'SCAN', cls: 'risk-scan-wait text-amber-300/70' },
  ok: { word: 'LOCK', cls: 'text-accent-ok/90' },
  failed: { word: 'DOWN', cls: 'text-accent-danger/90' },
  skipped: { word: 'SKIP', cls: 'text-white/45' },
};

function Console({ feeds, elapsed }: { feeds: FeedProgress; elapsed: number }) {
  const done = WILDFIRE_FEEDS.filter((f) => feeds[f.id] !== undefined).length;
  const total = WILDFIRE_FEEDS.length;

  return (
    <div className="w-[340px] max-w-full">
      <div className="flex items-baseline gap-3 border-b border-white/10 pb-2">
        <span className="text-[9px] font-bold uppercase tracking-[0.22em] text-white/40">Feed acquisition</span>
        <span className="ml-auto font-mono text-[10px] tabular-nums text-amber-300/80">T+{elapsed.toFixed(1)}s</span>
        <span className="font-mono text-[10px] tabular-nums text-white/45">{done}/{total}</span>
      </div>

      <div className="mt-2 h-[3px] overflow-hidden rounded-full bg-white/10">
        <div
          className="h-full rounded-full bg-gradient-to-r from-accent to-amber-400 transition-[width] duration-500 ease-out"
          style={{ width: `${(done / total) * 100}%` }}
        />
      </div>

      <ul className="mt-3 space-y-[7px]">
        {WILDFIRE_FEEDS.map((f, i) => {
          const result = feeds[f.id];
          const state = STATE_WORD[result ?? 'pending'];
          return (
            <li key={f.id} className="risk-scan-row flex items-center gap-2.5" style={{ animationDelay: `${i * 60}ms` }}>
              <StatusDot result={result} />
              <span className={`text-[11px] leading-none ${result ? 'text-white/75' : 'text-white/45'}`}>{f.label}</span>
              <span className="ml-auto font-mono text-[8px] tracking-wider text-white/40">{f.source}</span>
              <span className={`w-9 text-right font-mono text-[8px] font-bold tracking-widest ${state.cls}`}>{state.word}</span>
            </li>
          );
        })}
      </ul>
    </div>
  );
}

const fmtCoord = (v: number, pos: string, neg: string) =>
  `${Math.abs(v).toFixed(3)}° ${v >= 0 ? pos : neg}`;

export function RiskScanLoading({ target, feeds }: { target: RiskTarget; feeds: FeedProgress }) {
  const pending = WILDFIRE_FEEDS.find((f) => feeds[f.id] === undefined);
  const [elapsed, setElapsed] = useState(0);
  useEffect(() => {
    // Keyed on target identity: open() always creates a fresh target object,
    // so retargeting mid-load restarts the clock without a remount.
    setElapsed(0);
    const t0 = performance.now();
    const id = window.setInterval(() => setElapsed((performance.now() - t0) / 1000), 100);
    return () => window.clearInterval(id);
  }, [target]);

  return (
    <div
      className="flex min-h-[80vh] flex-col items-center justify-center gap-9 px-6 py-12"
      style={{ backgroundImage: 'radial-gradient(ellipse 70% 55% at 50% 45%, rgba(61,220,255,0.05), transparent)' }}
    >
      <div className="flex flex-col items-center gap-10 lg:flex-row lg:items-center lg:gap-16">
        <div>
          <Scope />
          <div className="mt-4 text-center font-mono">
            <div className="text-[10px] uppercase tracking-[0.2em] text-white/60">
              {target.groupIcon} {target.name}
            </div>
            <div className="mt-1 text-[9px] tabular-nums text-white/40">
              {fmtCoord(target.lat, 'N', 'S')} · {fmtCoord(target.lon, 'E', 'W')} · rings {RISK_RINGS.map((r) => r.miles).join('/')} mi
            </div>
          </div>
        </div>
        <Console feeds={feeds} elapsed={elapsed} />
      </div>

      {/* Live terminal line: names whatever the assembly is actually waiting
          on right now (first pending feed in manifest order). */}
      <p className="font-mono text-[10px] text-white/45">
        {pending === undefined
          ? 'All feeds settled — compositing report'
          : pending.id === 'maps'
            ? `Rendering exposure maps — ${pending.source}`
            : `Acquiring ${pending.label.toLowerCase()} — ${pending.source}`}
        <span className="risk-scan-cursor ml-1.5 inline-block h-[11px] w-[5px] translate-y-[2px] bg-amber-300/80" />
      </p>
    </div>
  );
}
