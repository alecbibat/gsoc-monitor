import { useEffect, useRef, useState } from 'react';
import { useScreensaverStore } from '../screensaver/screensaverStore';
import type { ScreensaverMode } from '../screensaver/screensaverStore';
import { useHoverStore } from '../screensaver/hoverStore';

function SpeakerIcon({ muted }: { muted: boolean }) {
  return (
    <svg viewBox="0 0 24 24" className="h-3.5 w-3.5" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <polygon points="11 5 6 9 2 9 2 15 6 15 11 19 11 5" />
      {muted ? (
        <line x1="23" y1="9" x2="17" y2="15" />
      ) : (
        <>
          <path d="M15.54 8.46a5 5 0 0 1 0 7.07" />
          <path d="M19.07 4.93a10 10 0 0 1 0 14.14" />
        </>
      )}
      {muted && <line x1="17" y1="9" x2="23" y2="15" />}
    </svg>
  );
}

const MODES: { mode: ScreensaverMode; label: string; title: string }[] = [
  { mode: 'global',         label: 'Global',  title: 'Globe rotates and visits active alerts, earthquakes, and strategic POIs' },
  { mode: 'national-parks', label: 'Parks',   title: 'Tour national parks and office locations with county highlighting' },
  { mode: 'pins',           label: 'Pins',    title: 'Orbit each tracked property location and ship with a cinematic close-up' },
  { mode: 'iss',            label: 'ISS',     title: 'Follow the International Space Station in real time' },
];

// Dropdown selector for the screensaver tour modes plus Hover. Picking an entry
// starts it; "None" turns everything off.
export function ScreensaverControls({ className = '' }: { className?: string }) {
  const active       = useScreensaverStore((s) => s.active);
  const currentMode  = useScreensaverStore((s) => s.mode);
  const toggle       = useScreensaverStore((s) => s.toggle);
  const voiceEnabled = useScreensaverStore((s) => s.voiceEnabled);
  const toggleVoice  = useScreensaverStore((s) => s.toggleVoice);

  const hoverActive  = useHoverStore((s) => s.active);
  const hoverPicking = useHoverStore((s) => s.picking);
  const hoverOn = hoverActive || hoverPicking;

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

  const stopHover = () => {
    const h = useHoverStore.getState();
    if (h.active || h.picking) h.stop();
  };
  const stopScreensaver = () => {
    const ss = useScreensaverStore.getState();
    if (ss.active) ss.toggle(ss.mode);
  };

  const current = MODES.find((m) => m.mode === currentMode);
  const buttonLabel = hoverOn
    ? (hoverPicking ? 'Pick…' : 'Hover')
    : active && current ? current.label : 'Screensaver';
  const anyOn = active || hoverOn;

  const selectMode = (mode: ScreensaverMode) => {
    stopHover();
    if (!(active && currentMode === mode)) toggle(mode);
    setOpen(false);
  };
  const selectHover = () => {
    stopScreensaver();
    if (!hoverOn) useHoverStore.getState().startPicking();
    setOpen(false);
  };
  const selectNone = () => {
    stopScreensaver();
    stopHover();
    setOpen(false);
  };

  const Item = ({
    on, onClick, label, title,
  }: { on: boolean; onClick: () => void; label: string; title?: string }) => (
    <button
      onClick={onClick}
      title={title}
      className={`flex w-full items-center gap-2 px-3 py-2 text-left text-[11px] font-medium tracking-wide transition ${
        on ? 'bg-accent/10 text-accent' : 'text-white/55 hover:bg-white/5 hover:text-white/80'
      }`}
    >
      <span className={`h-1.5 w-1.5 rounded-full ${on ? 'animate-pulse bg-accent' : 'bg-white/20'}`} />
      {label}
    </button>
  );

  return (
    <div className={`flex flex-wrap items-center gap-2 ${className}`}>
      {/* Voice announce toggle — only shown while screensaver is running */}
      {active && (
        <button
          onClick={toggleVoice}
          title={voiceEnabled ? 'Mute location announcements' : 'Announce location names aloud'}
          className={`pointer-events-auto flex items-center justify-center rounded-lg border p-2 shadow-panel backdrop-blur-sm transition-all ${
            voiceEnabled
              ? 'border-accent/40 bg-accent/10 text-accent'
              : 'border-white/10 bg-ink-900/80 text-white/30 hover:text-white/60'
          }`}
          aria-label={voiceEnabled ? 'Mute announcements' : 'Enable announcements'}
        >
          <SpeakerIcon muted={!voiceEnabled} />
        </button>
      )}
      <div ref={ref} className="pointer-events-auto relative">
        <button
          onClick={() => setOpen((vv) => !vv)}
          className={`flex items-center gap-1.5 rounded-lg border px-2.5 py-1.5 text-[11px] font-semibold tracking-widest shadow-panel backdrop-blur-sm transition-all ${
            anyOn
              ? 'border-accent/40 bg-accent/10 text-accent'
              : 'border-white/10 bg-ink-900/80 text-white/40 hover:text-white/70'
          }`}
          title="Select a screensaver tour mode"
        >
          <span className={`h-1.5 w-1.5 rounded-full ${anyOn ? 'animate-pulse bg-accent' : 'bg-white/20'}`} />
          <span className="uppercase">{buttonLabel}</span>
          <svg width="9" height="9" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="3" strokeLinecap="round" strokeLinejoin="round" className={`transition-transform ${open ? 'rotate-180' : ''}`}>
            <polyline points="6 9 12 15 18 9" />
          </svg>
        </button>

        {open && (
          <div className="absolute left-0 top-full z-50 mt-1.5 w-44 overflow-hidden rounded-lg border border-white/12 bg-ink-900/95 shadow-2xl backdrop-blur-md">
            <Item on={!anyOn} onClick={selectNone} label="None" title="Turn the screensaver off" />
            <div className="h-px bg-white/8" />
            {MODES.map((m) => (
              <Item
                key={m.mode}
                on={active && currentMode === m.mode}
                onClick={() => selectMode(m.mode)}
                label={m.label}
                title={m.title}
              />
            ))}
            <div className="h-px bg-white/8" />
            <Item
              on={hoverOn}
              onClick={selectHover}
              label={hoverPicking ? 'Hover — pick a point…' : 'Hover'}
              title="Pick a custom point and orbit the camera around it, like the pins tour"
            />
          </div>
        )}
      </div>
    </div>
  );
}
