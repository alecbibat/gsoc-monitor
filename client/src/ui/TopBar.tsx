import { useEffect, useState } from 'react';
import { SearchBar } from './SearchBar';
import { WidgetLauncher } from '../widgets/WidgetLauncher';
import { useScreensaverStore } from '../screensaver/screensaverStore';
import type { ScreensaverMode } from '../screensaver/screensaverStore';
import { useCesiumViewer } from '../cesium/CesiumContext';
import { resetCamera } from '../cesium/flyTo';
import { useTrackedHistory } from './useTrackedHistory';

function ScreensaverButton({
  mode,
  label,
  title,
}: {
  mode: ScreensaverMode;
  label: string;
  title: string;
}) {
  const active = useScreensaverStore((s) => s.active);
  const currentMode = useScreensaverStore((s) => s.mode);
  const toggle = useScreensaverStore((s) => s.toggle);

  const isOn = active && currentMode === mode;

  return (
    <button
      onClick={() => toggle(mode)}
      className={`pointer-events-auto flex items-center gap-1.5 rounded-lg border px-2.5 py-1.5 text-[11px] font-semibold tracking-widest shadow-panel backdrop-blur-sm transition-all ${
        isOn
          ? 'border-accent/40 bg-accent/10 text-accent'
          : 'border-white/10 bg-ink-900/80 text-white/40 hover:text-white/70'
      }`}
      title={title}
    >
      <span
        className={`h-1.5 w-1.5 rounded-full ${isOn ? 'animate-pulse bg-accent' : 'bg-white/20'}`}
      />
      {label}
    </button>
  );
}

function LiveClock() {
  const [now, setNow] = useState(() => new Date());
  useEffect(() => {
    const id = setInterval(() => setNow(new Date()), 1000);
    return () => clearInterval(id);
  }, []);

  const time = now.toLocaleTimeString([], {
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
    hour12: false,
  });
  const tzAbbr =
    new Intl.DateTimeFormat('en-US', { timeZoneName: 'short' })
      .formatToParts(now)
      .find((p) => p.type === 'timeZoneName')?.value ?? '';
  const fullDate = now.toLocaleDateString([], {
    weekday: 'long',
    year: 'numeric',
    month: 'long',
    day: 'numeric',
  });

  return (
    <div
      className="pointer-events-auto flex items-baseline gap-1.5 rounded-lg border border-white/10 bg-ink-900/80 px-3 py-2 shadow-panel backdrop-blur-sm"
      title={fullDate}
    >
      <span className="font-mono text-[13px] font-semibold tabular-nums tracking-wider text-white/90">
        {time}
      </span>
      <span className="text-[10px] font-semibold uppercase tracking-wider text-white/35">
        {tzAbbr}
      </span>
    </div>
  );
}

function ResetCameraButton() {
  const viewer = useCesiumViewer();
  return (
    <button
      onClick={() => viewer && resetCamera(viewer)}
      disabled={!viewer}
      className="pointer-events-auto flex items-center gap-1.5 rounded-lg border border-white/10 bg-ink-900/80 px-2.5 py-1.5 text-[11px] font-semibold tracking-widest text-white/40 shadow-panel backdrop-blur-sm transition-all hover:text-white/70 disabled:opacity-40"
      title="Reset camera to the home view"
    >
      <svg
        viewBox="0 0 24 24"
        className="h-3.5 w-3.5"
        fill="none"
        stroke="currentColor"
        strokeWidth="2"
        strokeLinecap="round"
        strokeLinejoin="round"
      >
        <circle cx="12" cy="12" r="9" />
        <path d="M12 3v3M12 18v3M3 12h3M18 12h3" />
        <circle cx="12" cy="12" r="2" fill="currentColor" stroke="none" />
      </svg>
      RESET
    </button>
  );
}

// Tiny SVG sparkline for the items-tracked counter.
function Sparkline({ history }: { history: number[] }) {
  if (history.length < 2) return null;
  const W = 48;
  const H = 18;
  const max = Math.max(...history, 1);
  const pts = history
    .map((v, i) => {
      const x = (i / (history.length - 1)) * W;
      const y = H - (v / max) * H * 0.9 + H * 0.05;
      return `${x.toFixed(1)},${y.toFixed(1)}`;
    })
    .join(' ');
  return (
    <svg width={W} height={H} className="shrink-0 opacity-50">
      <polyline
        points={pts}
        fill="none"
        stroke="currentColor"
        strokeWidth="1.5"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </svg>
  );
}

// Live "N items tracked" pill with rolling sparkline.
function TrackedCounter() {
  const { total, history } = useTrackedHistory();
  return (
    <div
      className="pointer-events-auto flex items-center gap-2 rounded-lg border border-white/10 bg-ink-900/80 px-3 py-2 text-white/60 shadow-panel backdrop-blur-sm"
      title="Total items currently tracked across all active layers"
    >
      <Sparkline history={history} />
      <div className="flex flex-col items-end leading-none">
        <span className="font-mono text-[15px] font-bold tabular-nums text-white/85">
          {total.toLocaleString()}
        </span>
        <span className="text-[9px] font-semibold uppercase tracking-wider text-white/30">
          tracked
        </span>
      </div>
    </div>
  );
}

export function TopBar() {
  return (
    <div className="pointer-events-none absolute inset-x-0 top-0 z-20 flex items-start justify-between gap-4 p-4">
      {/* Left: identity + camera controls + screensaver modes */}
      <div className="flex items-center gap-3">
        <div className="pointer-events-auto flex items-center gap-2 rounded-lg border border-white/10 bg-ink-900/80 px-3 py-2 shadow-panel backdrop-blur-sm">
          <span className="h-2 w-2 animate-pulse rounded-full bg-accent-ok shadow-glow" />
          <span className="font-mono text-[13px] font-semibold tracking-[0.2em] text-white/90">
            GSOC<span className="text-accent">MONITOR</span>
          </span>
        </div>
        <LiveClock />
        <TrackedCounter />
        <ResetCameraButton />
        <ScreensaverButton
          mode="global"
          label="GLOBAL"
          title="Globe rotates and visits active alerts, earthquakes, and strategic POIs"
        />
        <ScreensaverButton
          mode="national-parks"
          label="PARKS"
          title="Tour national parks and office locations with county highlighting"
        />
        <ScreensaverButton
          mode="pins"
          label="PINS"
          title="Orbit each tracked property location with a cinematic close-up"
        />
        <ScreensaverButton
          mode="iss"
          label="ISS"
          title="Follow the International Space Station in real time"
        />
      </div>
      {/* Right: widgets + search */}
      <div className="flex items-center gap-3">
        <WidgetLauncher />
        <div className="pointer-events-auto">
          <SearchBar />
        </div>
      </div>
    </div>
  );
}
