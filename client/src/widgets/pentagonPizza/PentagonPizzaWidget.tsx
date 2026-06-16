import { useEffect, useRef, useState } from 'react';
import { api } from '../../api/client';
import type { PizzaBusyness, PizzaPlaceBusyness } from '../../types';
import { baselineActivity, doughconFor, PIZZERIAS } from './pizzaIndex';

const HISTORY = 60; // samples kept for the sparkline
const ANIM_MS = 1500; // gauge easing cadence
const REFRESH_MS = 5 * 60_000; // how often we re-poll BestTime (server caches 15m)

function clamp(n: number): number {
  return Math.max(0, Math.min(100, n));
}

// Semicircular gauge needle angle: 0 -> -90deg (left), 100 -> +90deg (right).
function needleAngle(index: number): number {
  return -90 + (index / 100) * 180;
}

interface RenderPlace {
  name: string;
  area: string;
  value: number; // busyness 0-100 (live when we have it, else modeled)
  live: boolean; // true when `value` is real BestTime data
  delta: number | null; // live vs typical (positive = busier than usual)
}

// True when BestTime actually returned at least one live reading.
function liveReadings(data: PizzaBusyness | null): PizzaPlaceBusyness[] {
  if (!data || data.source !== 'besttime') return [];
  return data.places.filter((p) => p.live != null);
}

export function PentagonPizzaWidget() {
  const [data, setData] = useState<PizzaBusyness | null>(null);
  const dataRef = useRef<PizzaBusyness | null>(null);
  dataRef.current = data;

  const [index, setIndex] = useState(() => baselineActivity(new Date()));
  const indexRef = useRef(index);
  indexRef.current = index;
  const [history, setHistory] = useState<number[]>(() => {
    const seed = baselineActivity(new Date());
    return Array.from({ length: HISTORY }, () => seed);
  });

  // Poll the BestTime-backed endpoint; failures just leave us in modeled mode.
  useEffect(() => {
    let cancelled = false;
    const fetchData = async () => {
      try {
        const res = await api.pizza();
        if (!cancelled) setData(res);
      } catch {
        if (!cancelled) setData({ source: 'error', places: [], updated: Date.now() });
      }
    };
    fetchData();
    const id = setInterval(fetchData, REFRESH_MS);
    return () => {
      cancelled = true;
      clearInterval(id);
    };
  }, []);

  // Ease the gauge toward its target (live busyness, or the modeled baseline).
  useEffect(() => {
    const id = setInterval(() => {
      const lives = liveReadings(dataRef.current);
      const isLive = lives.length > 0;
      const target = isLive
        ? Math.max(...lives.map((p) => p.live as number))
        : baselineActivity(new Date());
      const jitter = (Math.random() - 0.5) * (isLive ? 2 : 8);
      const next = clamp(indexRef.current + (target - indexRef.current) * 0.3 + jitter);
      setIndex(next);
      setHistory((h) => [...h.slice(1 - HISTORY), next]);
    }, ANIM_MS);
    return () => clearInterval(id);
  }, []);

  const dc = doughconFor(index);
  const lives = liveReadings(data);
  const isLive = lives.length > 0;

  // Choose what to list: real venues from BestTime, or the modeled lineup.
  const places: RenderPlace[] = isLive
    ? (data as PizzaBusyness).places.map((p) => ({
        name: p.name,
        area: p.area,
        value: p.live != null ? p.live : clamp(p.forecast ?? index),
        live: p.live != null,
        delta: p.delta,
      }))
    : PIZZERIAS.map((p) => ({
        name: p.name,
        area: p.area,
        value: clamp(index + p.offset),
        live: false,
        delta: null,
      }));

  // Sparkline path.
  const w = 100;
  const h = 28;
  const pts = history
    .map((v, i) => `${(i / (HISTORY - 1)) * w},${h - (v / 100) * h}`)
    .join(' ');

  return (
    <div className="space-y-4">
      {/* Source badge */}
      <div className="flex items-center justify-between text-[11px]">
        {isLive ? (
          <span className="flex items-center gap-1.5 font-semibold text-accent-ok">
            <span className="h-1.5 w-1.5 animate-pulse rounded-full bg-accent-ok" />
            BESTTIME · LIVE
          </span>
        ) : (
          <span className="rounded bg-white/10 px-1.5 py-0.5 font-semibold text-white/50">
            MODELED
          </span>
        )}
        <span className="text-white/30">Pentagon, Arlington VA</span>
      </div>

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
              style={{ transition: 'stroke-dasharray 1.2s ease, stroke 0.6s ease' }}
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
              style={{ transition: 'transform 1.2s ease, stroke 0.6s ease' }}
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
            {isLive ? 'Peak busyness' : 'Activity index'}{' '}
            <span className="tabular-nums text-white/80">{Math.round(index)}</span>/100
          </div>
        </div>
      </div>

      {/* Sparkline */}
      <div>
        <div className="mb-1 text-[11px] uppercase tracking-widest text-white/40">
          {isLive ? 'Busyness trend' : 'Order-volume trend'}
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
        {places.map((p) => (
          <div key={`${p.name}-${p.area}`} className="flex items-center gap-2 text-[12px]">
            <div className="w-28 shrink-0 truncate">
              <span className="text-white/80">{p.name}</span>{' '}
              <span className="text-white/35">· {p.area}</span>
            </div>
            <div className="h-1.5 flex-1 overflow-hidden rounded-full bg-white/10">
              <div
                className="h-full rounded-full"
                style={{
                  width: `${p.value}%`,
                  backgroundColor: doughconFor(p.value).color,
                  opacity: p.live ? 1 : 0.55,
                  transition: 'width 1.2s ease, background-color 0.6s ease',
                }}
              />
            </div>
            {p.delta != null && p.delta >= 12 ? (
              <span className="w-7 shrink-0 text-right text-accent-warn" title="Busier than usual">
                ▲
              </span>
            ) : (
              <span className="w-7 shrink-0 text-right tabular-nums text-white/50">
                {Math.round(p.value)}
              </span>
            )}
          </div>
        ))}
      </div>

      <p className="text-[11px] leading-snug text-white/35">
        {isLive ? (
          <>
            Live foot-traffic from BestTime (Google-style busyness). DOUGHCON tracks the
            busiest monitored pizzeria; <span className="text-accent-warn">▲</span> marks venues
            busier than their typical level for this hour.
          </>
        ) : (
          <>
            <span className="rounded bg-white/10 px-1 py-0.5 font-semibold text-white/50">
              MODELED
            </span>{' '}
            Showing a time-of-day estimate — no live BestTime data
            {data?.source === 'no-key' ? ' (set BESTTIME_API_KEY_PRIVATE to enable it).' : '.'}
          </>
        )}
      </p>
    </div>
  );
}
