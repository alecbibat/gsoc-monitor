// Centred ops-console status bar for the auth screen.
// Symmetric layout: subsystem columns flank a segmented ring "operational"
// gauge; "VIRTUAL WAR ROOM" header on top, live uplink telemetry + deployment
// timestamp on the bottom.

import { useEffect, useRef, useState } from 'react';

const BUILD_ISO: string =
  typeof __BUILD_TIME__ === 'string' ? __BUILD_TIME__ : new Date().toISOString();

const SYSTEMS: [string, boolean][] = [
  ['Crisis Management',   true],
  ['Earthquake Monitor',  true],
  ['Flight Tracking',     true],
  ['Maritime Tracking',   true],
  ['Weather Radar',       true],
  ['Satellite Tracking',  true],
  ['Lightning Detection', true],
  ['Hurricane Tracking',  true],
  ['Fire Detection',      true],
  ['News Intelligence',   true],
];

const operational = SYSTEMS.filter(([, up]) => up).length;
const left = SYSTEMS.slice(0, 5);
const right = SYSTEMS.slice(5);

function fmtDeploy(iso: string): { date: string; time: string } {
  const d = new Date(iso);
  const date = d.toLocaleDateString('en-US', { day: 'numeric', month: 'short', year: 'numeric' });
  const time = d.toLocaleTimeString('en-US', {
    hour: '2-digit', minute: '2-digit', hour12: false, timeZoneName: 'short',
  });
  return { date, time };
}

// Live downlink telemetry: seeds from the Network Information API when present,
// then random-walks for a real-time "war room" readout. Values shown in kbps.
function Sparkline({ data, w = 56, h = 16 }: { data: number[]; w?: number; h?: number }) {
  if (data.length < 2) return <svg width={w} height={h} />;
  const max = Math.max(...data);
  const min = Math.min(...data);
  const span = max - min || 1;
  const pts = data
    .map((v, i) => {
      const x = (i / (data.length - 1)) * w;
      const y = h - ((v - min) / span) * (h - 2) - 1;
      return `${x.toFixed(1)},${y.toFixed(1)}`;
    })
    .join(' ');
  return (
    <svg width={w} height={h} className="shrink-0 overflow-visible">
      <polyline
        points={pts}
        fill="none"
        stroke="#3ddcff"
        strokeWidth="1.2"
        strokeLinejoin="round"
        strokeLinecap="round"
        style={{ filter: 'drop-shadow(0 0 2px rgba(61,220,255,0.5))' }}
      />
    </svg>
  );
}

function ConnectionMeter() {
  const baseRef = useRef<number>(
    // navigator.connection.downlink is in Mbps; fall back to a plausible base.
    ((navigator as unknown as { connection?: { downlink?: number } }).connection?.downlink ?? 0) ||
      6 + Math.random() * 9,
  );
  const [hist, setHist] = useState<number[]>(() =>
    Array.from({ length: 20 }, (_, i) => baseRef.current * (0.8 + 0.2 * Math.sin(i / 2))),
  );

  useEffect(() => {
    let cur = baseRef.current;
    const id = window.setInterval(() => {
      const base = baseRef.current;
      cur += (Math.random() - 0.5) * base * 0.3;
      cur = Math.max(base * 0.4, Math.min(base * 1.3, cur));
      setHist((h) => [...h.slice(-23), cur]);
    }, 650);
    return () => window.clearInterval(id);
  }, []);

  const kbps = Math.round((hist[hist.length - 1] ?? baseRef.current) * 1000);

  return (
    <div className="flex items-center gap-2">
      <span className="font-mono text-[8px] uppercase tracking-[0.16em] text-white/30">Downlink</span>
      <Sparkline data={hist} />
      <span className="font-mono text-[10px] font-semibold tabular-nums text-accent/80">
        {kbps.toLocaleString()}
        <span className="ml-0.5 text-[8px] font-normal text-white/30">kbps</span>
      </span>
    </div>
  );
}

function Dot({ up }: { up: boolean }) {
  return (
    <span
      className={`h-[5px] w-[5px] shrink-0 rounded-full ${
        up ? 'bg-accent-ok shadow-[0_0_4px_rgba(82,227,164,0.6)]' : 'bg-accent-danger'
      }`}
    />
  );
}

// Segmented radial gauge: one arc per system, lit green when operational.
function Gauge({ value, total }: { value: number; total: number }) {
  const cx = 50, cy = 50, r = 39, sw = 7, gapDeg = 8;
  const seg = 360 / total;
  const polar = (deg: number): [number, number] => {
    const a = ((deg - 90) * Math.PI) / 180;
    return [cx + r * Math.cos(a), cy + r * Math.sin(a)];
  };
  const arc = (i: number) => {
    const [x1, y1] = polar(i * seg + gapDeg / 2);
    const [x2, y2] = polar((i + 1) * seg - gapDeg / 2);
    return `M ${x1.toFixed(2)} ${y1.toFixed(2)} A ${r} ${r} 0 0 1 ${x2.toFixed(2)} ${y2.toFixed(2)}`;
  };

  return (
    <div className="flex shrink-0 flex-col items-center">
      <div className="relative h-[78px] w-[78px]">
        <svg viewBox="0 0 100 100" className="h-full w-full -rotate-90">
          {Array.from({ length: total }, (_, i) => {
            const on = i < value;
            return (
              <path
                key={i}
                d={arc(i)}
                fill="none"
                strokeWidth={sw}
                strokeLinecap="round"
                stroke={on ? '#52e3a4' : 'rgba(255,255,255,0.08)'}
                style={on ? { filter: 'drop-shadow(0 0 2px rgba(82,227,164,0.7))' } : undefined}
              />
            );
          })}
        </svg>
        <div className="absolute inset-0 flex items-center justify-center">
          <span className="font-mono text-[16px] font-bold tabular-nums text-white/90">
            {value}
            <span className="text-white/30">/{total}</span>
          </span>
        </div>
      </div>
      <span className="mt-1.5 text-center font-mono text-[8px] font-semibold uppercase leading-tight tracking-[0.18em] text-accent-ok/70">
        Systems<br />Operational
      </span>
    </div>
  );
}

export function StatusPanel() {
  const { date, time } = fmtDeploy(BUILD_ISO);

  return (
    <div
      className="select-none rounded-xl border border-accent/10 bg-ink-950/55 px-5 py-3 shadow-[0_0_0_1px_rgba(61,220,255,0.05),0_8px_40px_rgba(0,0,0,0.55)] backdrop-blur-md"
      aria-hidden="true"
    >
      {/* Header */}
      <div className="mb-3 flex items-center justify-center gap-2">
        <span className="relative flex h-2 w-2 shrink-0">
          <span className="absolute inline-flex h-full w-full animate-ping rounded-full bg-accent-ok opacity-60" />
          <span className="relative inline-flex h-2 w-2 rounded-full bg-accent-ok" />
        </span>
        <span className="font-mono text-[10px] font-bold uppercase tracking-[0.26em] text-white/70">
          Virtual War Room
        </span>
      </div>

      {/* Body: left column · gauge · right column */}
      <div className="flex items-center justify-center gap-5 sm:gap-8">
        {/* Left column (names hug the gauge, right-aligned) */}
        <div className="hidden w-36 flex-col gap-2 sm:flex">
          {left.map(([name, up]) => (
            <div key={name} className="flex items-center justify-end gap-1.5">
              <span className="font-mono text-[8.5px] uppercase tracking-[0.1em] text-white/45">{name}</span>
              <Dot up={up} />
            </div>
          ))}
        </div>

        <Gauge value={operational} total={SYSTEMS.length} />

        {/* Right column (names hug the gauge, left-aligned) */}
        <div className="hidden w-36 flex-col gap-2 sm:flex">
          {right.map(([name, up]) => (
            <div key={name} className="flex items-center justify-start gap-1.5">
              <Dot up={up} />
              <span className="font-mono text-[8.5px] uppercase tracking-[0.1em] text-white/45">{name}</span>
            </div>
          ))}
        </div>
      </div>

      {/* Footer: live telemetry + deploy timestamp */}
      <div className="mt-3 flex flex-col items-center gap-1.5 border-t border-white/6 pt-2.5">
        <ConnectionMeter />
        <span className="font-mono text-[9px] uppercase tracking-[0.12em] text-white/35">
          Last Deploy <span className="text-accent/60">{date} · {time}</span>
        </span>
      </div>
    </div>
  );
}
