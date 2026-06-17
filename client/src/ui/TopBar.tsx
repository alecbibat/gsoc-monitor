import { useEffect, useState } from 'react';
import { SearchBar } from './SearchBar';
import { WidgetLauncher } from '../widgets/WidgetLauncher';
import { useScreensaverStore } from '../screensaver/screensaverStore';
import type { ScreensaverMode } from '../screensaver/screensaverStore';
import { useCesiumViewer } from '../cesium/CesiumContext';
import { resetCamera } from '../cesium/flyTo';

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

// Live local clock shown next to the title. Ticks once a second; shows the
// browser's local time plus its timezone abbreviation (e.g. EDT), with the full
// date on hover.
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

// Returns the camera to the default global overview.
function ResetCameraButton() {
  const viewer = useCesiumViewer();
  return (
    <button
      onClick={() => viewer && resetCamera(viewer)}
      disabled={!viewer}
      className="pointer-events-auto flex items-center gap-1.5 rounded-lg border border-white/10 bg-ink-900/80 px-2.5 py-1.5 text-[11px] font-semibold tracking-widest text-white/40 shadow-panel backdrop-blur-sm transition-all hover:text-white/70 disabled:opacity-40"
      title="Reset camera to the home view"
    >
      <svg viewBox="0 0 24 24" className="h-3.5 w-3.5" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
        <circle cx="12" cy="12" r="9" />
        <path d="M12 3v3M12 18v3M3 12h3M18 12h3" />
        <circle cx="12" cy="12" r="2" fill="currentColor" stroke="none" />
      </svg>
      RESET
    </button>
  );
}

export function TopBar() {
  return (
    <div className="pointer-events-none absolute inset-x-0 top-0 z-20 flex items-start justify-between gap-4 p-4">
      {/* Left: identity + view controls */}
      <div className="flex items-center gap-3">
        <div className="pointer-events-auto flex items-center gap-2 rounded-lg border border-white/10 bg-ink-900/80 px-3 py-2 shadow-panel backdrop-blur-sm">
          <span className="h-2 w-2 animate-pulse rounded-full bg-accent-ok shadow-glow" />
          <span className="font-mono text-[13px] font-semibold tracking-[0.2em] text-white/90">
            GSOC<span className="text-accent">MONITOR</span>
          </span>
        </div>
        <LiveClock />
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
          mode="iss"
          label="ISS"
          title="Follow the International Space Station in real time"
        />
      </div>
      {/* Right: tools + search */}
      <div className="flex items-center gap-3">
        <WidgetLauncher />
        <div className="pointer-events-auto">
          <SearchBar />
        </div>
      </div>
    </div>
  );
}
