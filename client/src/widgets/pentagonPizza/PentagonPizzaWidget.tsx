import { useEffect, useRef, useState } from 'react';
import {
  baselineActivity,
  doughconFor,
  nextSample,
  PIZZERIAS,
} from './pizzaIndex';

const HISTORY = 60; // samples kept for the sparkline
const TICK_MS = 3000;

function clamp(n: number): number {
  return Math.max(0, Math.min(100, n));
}

// Semicircular gauge needle angle: 0 -> -90deg (left), 100 -> +90deg (right).
function needleAngle(index: number): number {
  return -90 + (index / 100) * 180;
}

export function PentagonPizzaWidget() {
  const [index, setIndex] = useState(() => baselineActivity(new Date()));
  const [history, setHistory] = useState<number[]>(() => {
    const seed = baselineActivity(new Date());
    return Array.from({ length: HISTORY }, () => seed);
  });
  const indexRef = useRef(index);
  indexRef.current = index;

  useEffect(() => {
    const id = setInterval(() => {
      const next = nextSample(indexRef.current);
      setIndex(next);
      setHistory((h) => [...h.slice(1 - HISTORY), next]);
    }, TICK_MS);
    return () => clearInterval(id);
  }, []);

  const dc = doughconFor(index);

  // Build the sparkline path.
  const w = 100;
  const h = 28;
  const pts = history
    .map((v, i) => `${(i / (HISTORY - 1)) * w},${h - (v / 100) * h}`)
    .join(' ');

  return (
    <div className="space-y-4">
      {/* DOUGHCON readout */}
      <div className="flex items-center gap-4">
        <div className="relative h-20 w-36 shrink-0">
          <svg viewBox="0 0 120 70" className="h-full w-full">
            <path
              d="M10 60 A50 50 0 0 1 110 60"
              fill="none"
              stroke="rgba(255,255,255,0.12)"
              strokeWidth="8"
              strokeLinecap="round"
            />
            <path
              d="M10 60 A50 50 0 0 1 110 60"
              fill="none"
              stroke={dc.color}
              strokeWidth="8"
              strokeLinecap="round"
              strokeDasharray={`${(index / 100) * 157} 157`}
              style={{ transition: 'stroke-dasharray 0.8s ease, stroke 0.4s ease' }}
            />
            <line
              x1="60"
              y1="60"
              x2="60"
              y2="20"
              stroke={dc.color}
              strokeWidth="3"
              strokeLinecap="round"
              transform={`rotate(${needleAngle(index)} 60 60)`}
              style={{ transition: 'transform 0.8s ease, stroke 0.4s ease' }}
            />
            <circle cx="60" cy="60" r="4" fill={dc.color} />
          </svg>
        </div>
        <div className="min-w-0">
          <div className="text-[11px] uppercase tracking-widest text-white/40">Doughcon</div>
          <div className="flex items-baseline gap-2">
            <span className="text-4xl font-bold tabular-nums" style={{ color: dc.color }}>
              {dc.level}
            </span>
            <span className="text-sm font-semibold tracking-wide" style={{ color: dc.color }}>
              {dc.label}
            </span>
          </div>
          <div className="text-[12px] text-white/50">
            Activity index <span className="tabular-nums text-white/80">{Math.round(index)}</span>/100
          </div>
        </div>
      </div>

      {/* Sparkline */}
      <div>
        <div className="mb-1 text-[11px] uppercase tracking-widest text-white/40">
          Order-volume trend
        </div>
        <svg viewBox={`0 0 ${w} ${h}`} className="h-8 w-full" preserveAspectRatio="none">
          <polyline points={pts} fill="none" stroke={dc.color} strokeWidth="1.5" />
        </svg>
      </div>

      {/* Per-pizzeria busyness */}
      <div className="space-y-1.5">
        <div className="text-[11px] uppercase tracking-widest text-white/40">
          Monitored pizzerias
        </div>
        {PIZZERIAS.map((p) => {
          const busy = clamp(index + p.offset);
          return (
            <div key={p.name} className="flex items-center gap-2 text-[12px]">
              <div className="w-28 shrink-0 truncate">
                <span className="text-white/80">{p.name}</span>{' '}
                <span className="text-white/35">· {p.area}</span>
              </div>
              <div className="h-1.5 flex-1 overflow-hidden rounded-full bg-white/10">
                <div
                  className="h-full rounded-full"
                  style={{
                    width: `${busy}%`,
                    backgroundColor: doughconFor(busy).color,
                    transition: 'width 0.8s ease, background-color 0.4s ease',
                  }}
                />
              </div>
              <span className="w-7 shrink-0 text-right tabular-nums text-white/50">
                {Math.round(busy)}
              </span>
            </div>
          );
        })}
      </div>

      <p className="text-[11px] leading-snug text-white/35">
        <span className="rounded bg-white/10 px-1 py-0.5 font-semibold text-white/50">
          SIMULATED
        </span>{' '}
        Heuristic signal modelled on local time of day — not a live data feed and not
        affiliated with the DoD. Wire in a Places/BestTime key to drive it from real
        busyness data.
      </p>
    </div>
  );
}
