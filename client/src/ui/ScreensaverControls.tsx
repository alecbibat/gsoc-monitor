import { useScreensaverStore } from '../screensaver/screensaverStore';
import type { ScreensaverMode } from '../screensaver/screensaverStore';

const MODES: { mode: ScreensaverMode; label: string; title: string }[] = [
  {
    mode: 'global',
    label: 'GLOBAL',
    title: 'Globe rotates and visits active alerts, earthquakes, and strategic POIs',
  },
  {
    mode: 'national-parks',
    label: 'PARKS',
    title: 'Tour national parks and office locations with county highlighting',
  },
  {
    mode: 'pins',
    label: 'PINS',
    title: 'Orbit each tracked property location with a cinematic close-up',
  },
  {
    mode: 'iss',
    label: 'ISS',
    title: 'Follow the International Space Station in real time',
  },
];

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

// The four screensaver-mode toggles, shared between the desktop TopBar and the
// mobile sidebar drawer.
export function ScreensaverControls({ className = '' }: { className?: string }) {
  return (
    <div className={`flex flex-wrap items-center gap-2 ${className}`}>
      {MODES.map((m) => (
        <ScreensaverButton key={m.mode} mode={m.mode} label={m.label} title={m.title} />
      ))}
    </div>
  );
}
