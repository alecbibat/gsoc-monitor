import { useEffect, useRef, useState } from 'react';
import { useScreensaverStore } from '../screensaver/screensaverStore';
import type { ScreensaverMode } from '../screensaver/screensaverStore';
import { useHoverStore } from '../screensaver/hoverStore';

const MODES: { mode: ScreensaverMode; label: string; title: string }[] = [
  { mode: 'global',         label: 'Global',  title: 'Globe rotates and visits active alerts, earthquakes, and strategic POIs' },
  { mode: 'national-parks', label: 'Parks',   title: 'Tour national parks and office locations with county highlighting' },
  { mode: 'pins',           label: 'Pins',    title: 'Orbit each tracked property location and ship with a cinematic close-up' },
  { mode: 'iss',            label: 'ISS',     title: 'Follow the International Space Station in real time' },
];

// Dropdown selector for the screensaver tour modes. Picking a mode starts it;
// "None" turns the tour off.
function ScreensaverDropdown() {
  const active      = useScreensaverStore((s) => s.active);
  const currentMode = useScreensaverStore((s) => s.mode);
  const toggle      = useScreensaverStore((s) => s.toggle);

  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!open) return;
    const onDown = (e: MouseEvent) => {
      if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false);
    };
    window.addEventListener('mousedown', onDown);
    return () => window.removeEventListener('mousedown', onDown);
  }, [open]);

  const current = MODES.find((m) => m.mode === currentMode);
  const buttonLabel = active && current ? current.label : 'Screensaver';

  const selectMode = (mode: ScreensaverMode) => {
    // Hover (a different store) fights the camera — make sure it's off.
    const hov = useHoverStore.getState();
    if (hov.active || hov.picking) hov.stop();
    if (!(active && currentMode === mode)) toggle(mode);
    setOpen(false);
  };

  const selectNone = () => {
    if (active) toggle(currentMode); // toggling the current mode turns it off
    setOpen(false);
  };

  return (
    <div ref={ref} className="pointer-events-auto relative">
      <button
        onClick={() => setOpen((v) => !v)}
        className={`flex items-center gap-1.5 rounded-lg border px-2.5 py-1.5 text-[11px] font-semibold tracking-widest shadow-panel backdrop-blur-sm transition-all ${
          active
            ? 'border-accent/40 bg-accent/10 text-accent'
            : 'border-white/10 bg-ink-900/80 text-white/40 hover:text-white/70'
        }`}
        title="Select a screensaver tour mode"
      >
        <span className={`h-1.5 w-1.5 rounded-full ${active ? 'animate-pulse bg-accent' : 'bg-white/20'}`} />
        <span className="uppercase">{buttonLabel}</span>
        <svg width="9" height="9" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="3" strokeLinecap="round" strokeLinejoin="round" className={`transition-transform ${open ? 'rotate-180' : ''}`}>
          <polyline points="6 9 12 15 18 9" />
        </svg>
      </button>

      {open && (
        <div className="absolute left-0 top-full z-50 mt-1.5 w-44 overflow-hidden rounded-lg border border-white/12 bg-ink-900/95 shadow-2xl backdrop-blur-md">
          {/* None */}
          <button
            onClick={selectNone}
            className={`flex w-full items-center gap-2 px-3 py-2 text-left text-[11px] font-medium tracking-wide transition ${
              !active ? 'bg-white/5 text-white/80' : 'text-white/45 hover:bg-white/5 hover:text-white/70'
            }`}
            title="Turn the screensaver off"
          >
            <span className={`h-1.5 w-1.5 rounded-full ${!active ? 'bg-white/60' : 'bg-white/15'}`} />
            None
          </button>

          <div className="h-px bg-white/8" />

          {MODES.map((m) => {
            const isOn = active && currentMode === m.mode;
            return (
              <button
                key={m.mode}
                onClick={() => selectMode(m.mode)}
                className={`flex w-full items-center gap-2 px-3 py-2 text-left text-[11px] font-medium tracking-wide transition ${
                  isOn ? 'bg-accent/10 text-accent' : 'text-white/55 hover:bg-white/5 hover:text-white/80'
                }`}
                title={m.title}
              >
                <span className={`h-1.5 w-1.5 rounded-full ${isOn ? 'animate-pulse bg-accent' : 'bg-white/20'}`} />
                {m.label}
              </button>
            );
          })}
        </div>
      )}
    </div>
  );
}

// Hover mode lives in its own store (it orbits a user-picked point rather than
// a fixed tour), so it sits beside the screensaver dropdown as its own toggle.
function HoverButton() {
  const active = useHoverStore((s) => s.active);
  const picking = useHoverStore((s) => s.picking);
  const isOn = active || picking;

  const onClick = () => {
    if (isOn) {
      useHoverStore.getState().stop();
      return;
    }
    const ss = useScreensaverStore.getState();
    if (ss.active) ss.toggle(ss.mode);
    useHoverStore.getState().startPicking();
  };

  return (
    <button
      onClick={onClick}
      className={`pointer-events-auto flex items-center gap-1.5 rounded-lg border px-2.5 py-1.5 text-[11px] font-semibold tracking-widest shadow-panel backdrop-blur-sm transition-all ${
        isOn
          ? 'border-accent/40 bg-accent/10 text-accent'
          : 'border-white/10 bg-ink-900/80 text-white/40 hover:text-white/70'
      }`}
      title="Pick a custom point and orbit the camera around it, like the pins tour"
    >
      <span className={`h-1.5 w-1.5 rounded-full ${isOn ? 'animate-pulse bg-accent' : 'bg-white/20'}`} />
      {picking ? 'PICK…' : 'HOVER'}
    </button>
  );
}

export function ScreensaverControls({ className = '' }: { className?: string }) {
  return (
    <div className={`flex flex-wrap items-center gap-2 ${className}`}>
      <ScreensaverDropdown />
      <HoverButton />
    </div>
  );
}
