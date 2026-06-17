import { useEffect, useLayoutEffect, useRef, useState } from 'react';
import { SearchBar } from './SearchBar';
import { WidgetLauncher } from '../widgets/WidgetLauncher';
import { ScreensaverControls } from './ScreensaverControls';
import { InfoPanel } from './InfoPanel';
import { useCesiumViewer } from '../cesium/CesiumContext';
import { resetCamera } from '../cesium/flyTo';
import { useTrackedHistory } from './useTrackedHistory';
import { useUiStore } from './uiStore';
import { useMeasureStore } from '../measure/measureStore';
import {
  fullscreenElement,
  fullscreenSupported,
  requestFullscreen,
  exitFullscreen,
  onFullscreenChange,
  isStandalone,
  isIOS,
} from './fullscreen';

function HamburgerButton() {
  const toggle = useUiStore((s) => s.toggleSidebar);
  return (
    <button
      onClick={toggle}
      className="pointer-events-auto flex items-center justify-center rounded-lg border border-white/10 bg-ink-900/80 p-2.5 text-white/70 shadow-panel backdrop-blur-sm transition hover:text-white md:hidden"
      aria-label="Toggle menu"
    >
      <svg
        width="18"
        height="18"
        viewBox="0 0 24 24"
        fill="none"
        stroke="currentColor"
        strokeWidth="2"
        strokeLinecap="round"
      >
        <path d="M4 6h16M4 12h16M4 18h16" />
      </svg>
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
      className="pointer-events-auto hidden items-baseline gap-1.5 rounded-lg border border-white/10 bg-ink-900/80 px-3 py-2 shadow-panel backdrop-blur-sm sm:flex"
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

function formatDeploy(iso: string): { local: string; tz: string; rel: string; full: string } {
  const then = new Date(iso);
  // Local date + 24h time, e.g. "Jun 17, 22:09" — converted to the viewer's
  // own timezone from the UTC build timestamp.
  const local = then.toLocaleString([], {
    month: 'short',
    day: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
    hour12: false,
  });
  const tz =
    new Intl.DateTimeFormat([], { timeZoneName: 'short' })
      .formatToParts(then)
      .find((p) => p.type === 'timeZoneName')?.value ?? '';
  const sec = Math.max(0, (Date.now() - then.getTime()) / 1000);
  let rel: string;
  if (sec < 60) rel = 'just now';
  else if (sec < 3600) rel = `${Math.floor(sec / 60)}m ago`;
  else if (sec < 86_400) rel = `${Math.floor(sec / 3600)}h ago`;
  else rel = `${Math.floor(sec / 86_400)}d ago`;
  const full = then.toLocaleString([], { dateStyle: 'full', timeStyle: 'long' });
  return { local, tz, rel, full };
}

// Shows when the currently-served build was deployed (build timestamp baked in
// by Vite), in the viewer's local time. Refreshes the relative label every minute.
function DeployStamp() {
  const [, setTick] = useState(0);
  useEffect(() => {
    const id = setInterval(() => setTick((t) => t + 1), 60_000);
    return () => clearInterval(id);
  }, []);

  const iso = typeof __BUILD_TIME__ === 'string' ? __BUILD_TIME__ : new Date().toISOString();
  const { local, tz, rel, full } = formatDeploy(iso);

  return (
    <div
      className="pointer-events-auto hidden items-center gap-1.5 rounded-lg border border-white/10 bg-ink-900/80 px-2.5 py-2 shadow-panel backdrop-blur-sm sm:flex"
      title={`Latest deploy: ${full} (${rel})`}
    >
      <span className="h-1.5 w-1.5 rounded-full bg-accent-ok/70" />
      <span className="text-[10px] font-semibold uppercase tracking-wider text-white/40">
        deployed
      </span>
      <span className="font-mono text-[11px] font-semibold tabular-nums text-white/75">
        {local}
        {tz ? ` ${tz}` : ''}
      </span>
      <span className="text-[10px] font-medium text-white/35">· {rel}</span>
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
      <span className="hidden sm:inline">RESET</span>
    </button>
  );
}

function FullscreenButton() {
  const [isFs, setIsFs] = useState(() => Boolean(fullscreenElement()));
  // iPhone Safari has no element-fullscreen API; show a one-tap hint pointing to
  // Add-to-Home-Screen instead of a dead button. (Hidden if already standalone.)
  const [showHint, setShowHint] = useState(false);
  const hintTimer = useRef<number | null>(null);

  const supported = fullscreenSupported();
  const standalone = isStandalone();
  const iosUnsupported = !supported && isIOS() && !standalone;

  useEffect(() => {
    const off = onFullscreenChange(() => setIsFs(Boolean(fullscreenElement())));
    return off;
  }, []);

  useEffect(() => {
    return () => {
      if (hintTimer.current) window.clearTimeout(hintTimer.current);
    };
  }, []);

  // Don't render at all when the app is already running chrome-free (installed
  // PWA / home-screen) — there's nothing to toggle.
  if (standalone) return null;

  const toggle = () => {
    if (!supported) {
      // iPhone Safari fallback: flash the install hint.
      setShowHint(true);
      if (hintTimer.current) window.clearTimeout(hintTimer.current);
      hintTimer.current = window.setTimeout(() => setShowHint(false), 4200);
      return;
    }
    if (fullscreenElement()) exitFullscreen();
    else requestFullscreen(document.documentElement);
  };

  return (
    <div className="relative">
      <button
        onClick={toggle}
        className="pointer-events-auto flex items-center justify-center rounded-lg border border-white/10 bg-ink-900/80 p-2 text-white/40 shadow-panel backdrop-blur-sm transition-all hover:text-white/70"
        title={iosUnsupported ? 'Full screen (Add to Home Screen on iPhone)' : isFs ? 'Exit full screen' : 'Enter full screen'}
        aria-label="Toggle full screen"
      >
        <svg
          viewBox="0 0 24 24"
          className="h-4 w-4"
          fill="none"
          stroke="currentColor"
          strokeWidth="2"
          strokeLinecap="round"
          strokeLinejoin="round"
        >
          {isFs ? (
            <path d="M9 3v3a3 3 0 0 1-3 3H3M21 9h-3a3 3 0 0 1-3-3V3M15 21v-3a3 3 0 0 1 3-3h3M3 15h3a3 3 0 0 1 3 3v3" />
          ) : (
            <path d="M3 9V5a2 2 0 0 1 2-2h4M21 9V5a2 2 0 0 0-2-2h-4M3 15v4a2 2 0 0 0 2 2h4M21 15v4a2 2 0 0 1-2 2h-4" />
          )}
        </svg>
      </button>

      {showHint && (
        <div className="pointer-events-none absolute right-0 top-full z-50 mt-2 w-56 rounded-lg border border-white/10 bg-ink-900/95 p-2.5 text-[11px] leading-snug text-white/70 shadow-panel backdrop-blur-md">
          iPhone Safari blocks full screen. Tap{' '}
          <span className="font-semibold text-white/90">Share</span> →{' '}
          <span className="font-semibold text-white/90">Add to Home Screen</span> to run GSOC Monitor full screen.
        </div>
      )}
    </div>
  );
}

function MeasureButton() {
  const active = useMeasureStore((s) => s.active);
  const toggle = useMeasureStore((s) => s.toggle);
  return (
    <button
      onClick={toggle}
      className={`pointer-events-auto flex items-center justify-center rounded-lg border p-2 shadow-panel backdrop-blur-sm transition-all ${
        active
          ? 'border-accent/40 bg-accent/10 text-accent'
          : 'border-white/10 bg-ink-900/80 text-white/40 hover:text-white/70'
      }`}
      title="Measure distance or area"
      aria-label="Measure tool"
    >
      <svg
        viewBox="0 0 24 24"
        className="h-4 w-4"
        fill="none"
        stroke="currentColor"
        strokeWidth="2"
        strokeLinecap="round"
        strokeLinejoin="round"
      >
        <path d="M2 12 L12 2 L22 12 L12 22 Z" />
        <path d="M6.5 9.5 L8 11 M9.5 6.5 L11 8 M12.5 12.5 L14 14 M15.5 9.5 L17 11" />
      </svg>
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
      className="pointer-events-auto hidden items-center gap-2 rounded-lg border border-white/10 bg-ink-900/80 px-3 py-2 text-white/60 shadow-panel backdrop-blur-sm lg:flex"
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
  const rightRef = useRef<HTMLDivElement>(null);
  const setTopRightBottom = useUiStore((s) => s.setTopRightBottom);

  // Publish the bottom edge of the right-hand cluster (search + info button) so
  // the pins-screensaver watch column can start below it instead of guessing a
  // fixed offset that breaks when the cluster wraps to a second row.
  useLayoutEffect(() => {
    const el = rightRef.current;
    if (!el) return;
    const measure = () => setTopRightBottom(el.getBoundingClientRect().bottom);
    measure();
    const ro = new ResizeObserver(measure);
    ro.observe(el);
    window.addEventListener('resize', measure);
    return () => {
      ro.disconnect();
      window.removeEventListener('resize', measure);
    };
  }, [setTopRightBottom]);

  return (
    <div className="pointer-events-none absolute inset-x-0 top-0 z-20 flex flex-col gap-2 p-3 md:flex-row md:items-start md:justify-between md:gap-4 md:p-4">
      {/* Left: identity + camera controls + screensaver modes */}
      <div className="flex flex-wrap items-center gap-2 md:gap-3">
        <HamburgerButton />
        <div className="pointer-events-auto flex items-center gap-2 rounded-lg border border-white/10 bg-ink-900/80 px-3 py-2 shadow-panel backdrop-blur-sm">
          <span className="h-2 w-2 animate-pulse rounded-full bg-accent-ok shadow-glow" />
          <span className="font-mono text-[13px] font-semibold tracking-[0.2em] text-white/90">
            GSOC<span className="text-accent">MONITOR</span>
          </span>
        </div>
        <DeployStamp />
        <LiveClock />
        <TrackedCounter />
        <ResetCameraButton />
        <FullscreenButton />
        <MeasureButton />
        {/* Screensaver modes — desktop only; mobile gets them in the drawer. */}
        <ScreensaverControls className="hidden md:flex" />
      </div>
      {/* Right: widgets + search, with the info button tucked under the search */}
      <div ref={rightRef} className="flex w-full flex-col items-end gap-2 md:w-auto">
        <div className="flex w-full flex-wrap items-center justify-end gap-2 md:gap-3">
          <WidgetLauncher />
          <div className="pointer-events-auto w-full sm:w-auto">
            <SearchBar />
          </div>
        </div>
        <InfoPanel />
      </div>
    </div>
  );
}
