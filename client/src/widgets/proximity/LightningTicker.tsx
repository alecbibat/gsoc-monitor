import { useEffect, useState } from 'react';
import { useLightningStatus } from '../../layers/lightning/lightningStore';

// Live global lightning activity, sampled from the Blitzortung feed the
// Lightning layer maintains. The rate is only live while that layer is on, so
// we fall back to a hint otherwise.
const SAMPLE_MS = 2_000;
const MAX_POINTS = 48; // ~96 s of trail

const BOLT = '#ffd60a';

function Sparkline({ data }: { data: number[] }) {
  if (data.length < 2) return <div className="h-7" />;
  const max = Math.max(1, ...data);
  const n = data.length;
  const pts = data.map((v, i) => {
    const x = (i / (n - 1)) * 100;
    const y = 26 - (v / max) * 24; // 2px headroom top, baseline at 28
    return `${x.toFixed(1)},${y.toFixed(1)}`;
  });
  const line = pts.join(' ');
  return (
    <svg viewBox="0 0 100 28" preserveAspectRatio="none" className="h-7 w-full">
      <defs>
        <linearGradient id="lightning-grad" x1="0" y1="0" x2="0" y2="1">
          <stop offset="0%" stopColor={BOLT} stopOpacity="0.35" />
          <stop offset="100%" stopColor={BOLT} stopOpacity="0" />
        </linearGradient>
      </defs>
      <polygon points={`0,28 ${line} 100,28`} fill="url(#lightning-grad)" />
      <polyline
        points={line}
        fill="none"
        stroke={BOLT}
        strokeWidth="1.5"
        strokeLinejoin="round"
        vectorEffect="non-scaling-stroke"
      />
    </svg>
  );
}

export function LightningTicker() {
  const rate = useLightningStatus((s) => s.ratePerMin);
  const connected = useLightningStatus((s) => s.connected);
  const [history, setHistory] = useState<number[]>([]);

  // Sample the live rate into a rolling buffer for the sparkline.
  useEffect(() => {
    if (!connected) {
      setHistory([]);
      return;
    }
    const sample = () =>
      setHistory((h) => [...h, useLightningStatus.getState().ratePerMin].slice(-MAX_POINTS));
    sample();
    const id = setInterval(sample, SAMPLE_MS);
    return () => clearInterval(id);
  }, [connected]);

  return (
    <div className="rounded-lg border border-white/8 bg-white/5 px-3 py-2.5">
      <div className="flex items-center justify-between">
        <span className="flex items-center gap-1.5 text-[10px] font-semibold uppercase tracking-widest text-white/40">
          <span aria-hidden>⚡</span> Lightning
        </span>
        {connected ? (
          <span className="flex items-center gap-1.5 text-[10px] font-semibold" style={{ color: BOLT }}>
            <span className="relative flex h-2 w-2">
              <span
                className="absolute inline-flex h-full w-full animate-ping rounded-full opacity-75"
                style={{ background: BOLT }}
              />
              <span className="relative inline-flex h-2 w-2 rounded-full" style={{ background: BOLT }} />
            </span>
            LIVE
          </span>
        ) : (
          <span className="text-[10px] text-white/25">idle</span>
        )}
      </div>

      {connected ? (
        <>
          <div className="mt-1 flex items-baseline gap-1.5">
            <span
              className="text-[26px] font-bold leading-none tabular-nums transition-transform"
              style={{ color: BOLT }}
            >
              {rate.toLocaleString()}
            </span>
            <span className="text-[11px] text-white/40">strikes/min · global</span>
          </div>
          <div className="mt-1.5">
            <Sparkline data={history} />
          </div>
        </>
      ) : (
        <div className="mt-1 text-[11px] leading-snug text-white/35">
          Feed idle — enable the <span className="text-white/55">Lightning</span> layer for live
          global strike activity.
        </div>
      )}
    </div>
  );
}
