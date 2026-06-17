import { useEffect, useRef, useState } from 'react';

interface FngEntry {
  value: string;
  value_classification: string;
  timestamp: string;
}

interface FngResponse {
  name: string;
  data: FngEntry[];
}

const REFRESH_MS = 5 * 60_000;

const COLOR_STOPS: Array<{ min: number; color: string; label: string }> = [
  { min: 75, color: '#2ecc71', label: 'Extreme Greed' },
  { min: 55, color: '#27ae60', label: 'Greed' },
  { min: 45, color: '#f39c12', label: 'Neutral' },
  { min: 25, color: '#e67e22', label: 'Fear' },
  { min: 0,  color: '#e74c3c', label: 'Extreme Fear' },
];

function colorForValue(v: number) {
  return (COLOR_STOPS.find((s) => v >= s.min) ?? COLOR_STOPS[COLOR_STOPS.length - 1]).color;
}

// Semicircular SVG gauge, 0 at left (180°), 100 at right (0°).
function Gauge({ value }: { value: number }) {
  const radius = 68;
  const cx = 80;
  const cy = 80;
  const circumference = Math.PI * radius; // half-circle
  // Offset = 0 means full arc visible (value=100); offset=circumference hides arc (value=0).
  const offset = circumference * (1 - value / 100);
  const color = colorForValue(value);

  // Needle angle: -180° at 0, 0° at 100.
  const angleDeg = -180 + value * 1.8;
  const angleRad = (angleDeg * Math.PI) / 180;
  const nx = cx + (radius - 10) * Math.cos(angleRad);
  const ny = cy + (radius - 10) * Math.sin(angleRad);

  return (
    <svg viewBox="0 0 160 90" className="w-full">
      {/* Track */}
      <path
        d={`M ${cx - radius} ${cy} A ${radius} ${radius} 0 0 1 ${cx + radius} ${cy}`}
        fill="none"
        stroke="#ffffff12"
        strokeWidth="14"
        strokeLinecap="round"
      />
      {/* Value arc */}
      <path
        d={`M ${cx - radius} ${cy} A ${radius} ${radius} 0 0 1 ${cx + radius} ${cy}`}
        fill="none"
        stroke={color}
        strokeWidth="14"
        strokeLinecap="round"
        strokeDasharray={`${circumference}`}
        strokeDashoffset={`${offset}`}
        style={{ transition: 'stroke-dashoffset 1.2s ease, stroke 0.8s ease' }}
      />
      {/* Needle */}
      <line
        x1={cx}
        y1={cy}
        x2={nx}
        y2={ny}
        stroke={color}
        strokeWidth="2.5"
        strokeLinecap="round"
        style={{ transition: 'all 1.2s ease' }}
      />
      <circle cx={cx} cy={cy} r="4" fill={color} style={{ transition: 'fill 0.8s ease' }} />
      {/* Value label */}
      <text x={cx} y={cy - 14} textAnchor="middle" fill={color} fontSize="22" fontWeight="bold" fontFamily="monospace" style={{ transition: 'fill 0.8s ease' }}>
        {value}
      </text>
    </svg>
  );
}

export function FearGreedWidget() {
  const [current, setCurrent] = useState<FngEntry | null>(null);
  const [history, setHistory] = useState<FngEntry[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const cancelledRef = useRef(false);

  useEffect(() => {
    cancelledRef.current = false;
    const load = async () => {
      try {
        const r = await fetch('https://api.alternative.me/fng/?limit=30&format=json');
        if (!r.ok) throw new Error(`HTTP ${r.status}`);
        const json = (await r.json()) as FngResponse;
        if (cancelledRef.current) return;
        const data = json.data ?? [];
        setCurrent(data[0] ?? null);
        setHistory(data.slice(1, 8)); // last 7 days
        setError(null);
      } catch (e) {
        if (cancelledRef.current) return;
        setError(e instanceof Error ? e.message : 'Fetch failed');
      } finally {
        if (!cancelledRef.current) setLoading(false);
      }
    };
    load();
    const id = setInterval(load, REFRESH_MS);
    return () => {
      cancelledRef.current = true;
      clearInterval(id);
    };
  }, []);

  if (loading) return <div className="py-6 text-center text-sm text-white/40">Loading…</div>;
  if (error) return <div className="py-4 text-center text-sm text-red-400">{error}</div>;
  if (!current) return <div className="py-4 text-center text-sm text-white/40">No data</div>;

  const val = parseInt(current.value, 10);
  const color = colorForValue(val);
  const classLabel = current.value_classification;
  const updated = new Date(parseInt(current.timestamp, 10) * 1000).toLocaleDateString();

  return (
    <div className="space-y-4">
      <div className="text-center">
        <Gauge value={val} />
        <div className="mt-1 text-[13px] font-semibold" style={{ color }}>{classLabel}</div>
        <div className="text-[11px] text-white/35">as of {updated}</div>
      </div>

      {history.length > 0 && (
        <div>
          <div className="mb-1.5 text-[10px] font-semibold uppercase tracking-wider text-white/30">
            Past 7 days
          </div>
          <div className="flex gap-1">
            {history.map((h, i) => {
              const hv = parseInt(h.value, 10);
              const hc = colorForValue(hv);
              const d = new Date(parseInt(h.timestamp, 10) * 1000);
              return (
                <div key={i} className="flex flex-1 flex-col items-center gap-0.5" title={`${d.toLocaleDateString()}: ${h.value_classification}`}>
                  <div className="text-[11px] font-semibold tabular-nums" style={{ color: hc }}>{hv}</div>
                  <div className="h-1 w-full rounded-full" style={{ backgroundColor: hc, opacity: 0.6 }} />
                  <div className="text-[9px] text-white/25">{d.toLocaleDateString('en-US', { weekday: 'short' })}</div>
                </div>
              );
            })}
          </div>
        </div>
      )}

      <p className="text-[11px] leading-snug text-white/40">
        The Fear &amp; Greed Index measures crypto-market sentiment on a 0–100 scale.
        Values below 25 signal extreme fear (potential buying opportunity); above 75 indicates extreme greed (potential correction ahead).
      </p>
      <a
        href="https://alternative.me/crypto/fear-and-greed-index/"
        target="_blank"
        rel="noreferrer"
        className="inline-block text-xs text-accent underline underline-offset-2 hover:text-accent/80"
      >
        Source: alternative.me →
      </a>
    </div>
  );
}
