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
import { useCrisisStore } from '../crisis/crisisStore';
import { useDashboardStore } from '../dashboard/dashboardStore';
import { UserMenu } from '../auth/UserMenu';
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
  // Ops coordination runs on UTC — show it alongside local so no one does
  // timezone math while reading an advisory timestamp.
  const utcTime = now.toLocaleTimeString([], {
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
    hour12: false,
    timeZone: 'UTC',
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
      className="pointer-events-auto hidden items-baseline gap-1.5 rounded-lg border border-white/10 bg-ink-900/80 px-3 py-2 shadow-panel backdrop-blur-sm md:flex"
      title={fullDate}
    >
      <span className="font-mono text-[13px] font-semibold tabular-nums tracking-wider text-white/90">
        {time}
      </span>
      <span className="text-[10px] font-semibold uppercase tracking-wider text-white/35">
        {tzAbbr}
      </span>
      <span className="text-white/15">·</span>
      <span className="font-mono text-[13px] font-semibold tabular-nums tracking-wider text-white/60">
        {utcTime}
      </span>
      <span className="text-[10px] font-semibold uppercase tracking-wider text-white/35">
        UTC
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
      className="pointer-events-auto hidden items-center gap-1.5 rounded-lg border border-white/10 bg-ink-900/80 px-2.5 py-2 shadow-panel backdrop-blur-sm lg:flex"
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

// One-click PNG capture of the globe for shift handoffs and incident emails.
// preserveDrawingBuffer is off, so the canvas must be copied synchronously
// right after a forced render — same pattern as the crisis layer thumbnails.
function ScreenshotButton() {
  const viewer = useCesiumViewer();
  const capture = () => {
    if (!viewer) return;
    try {
      viewer.render();
      const src = viewer.canvas;
      const c = document.createElement('canvas');
      c.width = src.width;
      c.height = src.height;
      c.getContext('2d')!.drawImage(src, 0, 0);
      const now = new Date();
      const pad = (n: number) => String(n).padStart(2, '0');
      const stamp = `${now.getUTCFullYear()}${pad(now.getUTCMonth() + 1)}${pad(now.getUTCDate())}-${pad(now.getUTCHours())}${pad(now.getUTCMinutes())}Z`;
      const a = document.createElement('a');
      a.href = c.toDataURL('image/png');
      a.download = `gsoc-${stamp}.png`;
      a.click();
    } catch {
      /* capture unavailable (e.g. lost context) — button is best-effort */
    }
  };
  return (
    <button
      onClick={capture}
      disabled={!viewer}
      className="pointer-events-auto flex items-center justify-center rounded-lg border border-white/10 bg-ink-900/80 p-2 text-white/40 shadow-panel backdrop-blur-sm transition-all hover:text-white/70 disabled:opacity-40"
      title="Save a PNG of the current view"
      aria-label="Screenshot"
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
        <path d="M23 19a2 2 0 0 1-2 2H3a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h4l2-3h6l2 3h4a2 2 0 0 1 2 2z" />
        <circle cx="12" cy="13" r="4" />
      </svg>
    </button>
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

function CrisisButton() {
  const toggle       = useCrisisStore((s) => s.toggle);
  const open         = useCrisisStore((s) => s.open);
  const activeCount  = useCrisisStore((s) => s.incidents.filter((i) => i.incidentStatus === 'active').length);
  const isActive     = activeCount > 0;

  return (
    <button
      onClick={toggle}
      className={`pointer-events-auto flex items-center gap-1.5 rounded-lg border px-3 py-1.5 shadow-panel backdrop-blur-sm transition-all ${
        open
          ? 'border-red-500/60 bg-red-500/20 text-red-400'
          : isActive
          ? 'border-red-500/45 bg-red-500/12 text-red-400/90 hover:border-red-500/60 hover:bg-red-500/18'
          : 'border-red-500/22 bg-red-500/6 text-red-500/55 hover:border-red-500/38 hover:text-red-400/80'
      }`}
      title="Crisis Management"
      aria-label="Open Crisis Management"
    >
      {isActive && (
        <span className="relative flex h-1.5 w-1.5 shrink-0">
          <span className="absolute inline-flex h-full w-full animate-ping rounded-full bg-red-400 opacity-70" />
          <span className="relative inline-flex h-1.5 w-1.5 rounded-full bg-red-400" />
        </span>
      )}
      <svg
        width="13"
        height="13"
        viewBox="0 0 24 24"
        fill="none"
        stroke="currentColor"
        strokeWidth="2"
        strokeLinecap="round"
        strokeLinejoin="round"
        className="shrink-0"
      >
        <path d="M10.29 3.86L1.82 18a2 2 0 001.71 3h16.94a2 2 0 001.71-3L13.71 3.86a2 2 0 00-3.42 0z" />
        <line x1="12" y1="9" x2="12" y2="13" />
        <line x1="12" y1="17" x2="12.01" y2="17" />
      </svg>
      <span className="text-[11px] font-bold uppercase tracking-[0.1em]">Crisis</span>
      {isActive && (
        <span className="ml-0.5 flex h-4 min-w-4 items-center justify-center rounded-full bg-red-500/30 px-1 text-[9px] font-bold text-red-300">
          {activeCount}
        </span>
      )}
    </button>
  );
}

function DashboardButton() {
  const open = useDashboardStore((s) => s.open);
  const setOpen = useDashboardStore((s) => s.setOpen);
  return (
    <button
      onClick={() => setOpen(!open)}
      className={`pointer-events-auto flex items-center gap-1.5 rounded-lg border px-3 py-1.5 shadow-panel backdrop-blur-sm transition-all ${
        open
          ? 'border-accent/50 bg-accent/15 text-accent'
          : 'border-white/10 bg-ink-900/80 text-white/55 hover:text-white/85'
      }`}
      title="Property status dashboard"
      aria-label="Open status dashboard"
    >
      <svg
        width="13"
        height="13"
        viewBox="0 0 24 24"
        fill="none"
        stroke="currentColor"
        strokeWidth="2"
        strokeLinecap="round"
        strokeLinejoin="round"
        className="shrink-0"
      >
        <rect x="3" y="3" width="7" height="9" rx="1" />
        <rect x="14" y="3" width="7" height="5" rx="1" />
        <rect x="14" y="12" width="7" height="9" rx="1" />
        <rect x="3" y="16" width="7" height="5" rx="1" />
      </svg>
      <span className="text-[11px] font-bold uppercase tracking-[0.1em]">Status</span>
    </button>
  );
}

// Mobile-only overflow menu collecting the utility buttons that would otherwise
// wrap the top bar across several rows on a phone: camera reset, full screen,
// measure, and the status dashboard. Desktop keeps them as individual buttons.
function MobileToolsMenu() {
  const [open, setOpen] = useState(false);
  return (
    <div className="relative md:hidden">
      <button
        onClick={() => setOpen((o) => !o)}
        className={`pointer-events-auto flex items-center justify-center rounded-lg border p-2.5 shadow-panel backdrop-blur-sm transition ${
          open
            ? 'border-accent/40 bg-accent/10 text-accent'
            : 'border-white/10 bg-ink-900/80 text-white/60'
        }`}
        aria-label="More tools"
        title="Tools"
      >
        <svg width="18" height="18" viewBox="0 0 24 24" fill="currentColor">
          <circle cx="5" cy="12" r="1.8" />
          <circle cx="12" cy="12" r="1.8" />
          <circle cx="19" cy="12" r="1.8" />
        </svg>
      </button>
      {open && (
        <>
          {/* invisible backdrop: tap anywhere else to dismiss */}
          <div className="pointer-events-auto fixed inset-0 z-40" onClick={() => setOpen(false)} />
          <div
            className="pointer-events-auto absolute left-0 top-full z-50 mt-2 flex flex-col items-stretch gap-2 rounded-xl border border-white/10 bg-ink-900/95 p-2 shadow-panel backdrop-blur-md"
            onClickCapture={() => setOpen(false)}
          >
            <ResetCameraButton />
            <FullscreenButton />
            <ScreenshotButton />
            <MeasureButton />
            <DashboardButton />
          </div>
        </>
      )}
    </div>
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
    <div className="pointer-events-none absolute inset-x-0 top-0 z-20 flex flex-col gap-2 pb-3 pl-safe pr-safe pt-safe md:flex-row md:items-start md:justify-between md:gap-4 md:pb-4">
      {/* Left: identity + camera controls + screensaver modes */}
      <div className="flex flex-wrap items-center gap-2 md:gap-3 lg:flex-nowrap lg:items-start">
        {/* On lg+ the docked sidebar (w-72) sits under this bar, so the brand
            gets a slot spanning the sidebar's width: the badges after it then
            start past the sidebar's right edge instead of straddling its
            border. Slot = 18rem sidebar − 0.75rem bar padding, so with the
            lg:gap-3 the first badge lands 0.75rem right of the edge. */}
        <div className="contents lg:flex lg:w-[calc(18rem-0.75rem)] lg:shrink-0 lg:items-center">
          <HamburgerButton />
          <div className="pointer-events-auto flex items-center gap-2 rounded-lg border border-white/10 bg-ink-900/80 px-3 py-2 shadow-panel backdrop-blur-sm">
            <span className="h-2 w-2 animate-pulse rounded-full bg-accent-ok shadow-glow" />
            <span className="font-mono text-[13px] font-semibold tracking-[0.2em] text-white/90">
              {/* On the narrowest phones just "GSOC" keeps row one on one line. */}
              GSOC<span className="text-accent max-[419px]:hidden">MONITOR</span>
            </span>
          </div>
        </div>
        <div className="contents lg:flex lg:flex-wrap lg:items-center lg:gap-3">
          <DeployStamp />
          <LiveClock />
          <TrackedCounter />
          {/* Utility buttons: individual on md+, collapsed into ⋯ on mobile. */}
          <MobileToolsMenu />
          <div className="hidden md:contents">
            <ResetCameraButton />
            <FullscreenButton />
            <ScreenshotButton />
            <MeasureButton />
            <DashboardButton />
          </div>
          <CrisisButton />
          <UserMenu />
          {/* Screensaver modes — desktop only; mobile gets them in the drawer. */}
          <ScreensaverControls className="hidden md:flex" />
        </div>
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
