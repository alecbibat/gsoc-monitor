import { useScreensaverStore } from '../screensaver/screensaverStore';
import type { ScreensaverMode } from '../screensaver/screensaverStore';
import { useHoverStore } from '../screensaver/hoverStore';

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

// Hover mode lives in its own store (it orbits a user-picked point rather than
// a fixed tour), but sits alongside the screensaver toggles for discoverability.
function HoverButton() {
  const active = useHoverStore((s) => s.active);
  const picking = useHoverStore((s) => s.picking);
  const isOn = active || picking;

  const onClick = () => {
    if (isOn) {
      useHoverStore.getState().stop();
      return;
    }
    // Hover and the screensaver fight over the camera — turn the screensaver off.
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

// The screensaver-mode toggles plus hover mode, shared between the desktop
// TopBar and the mobile sidebar drawer.
export function ScreensaverControls({ className = '' }: { className?: string }) {
  return (
    <div className={`flex flex-wrap items-center gap-2 ${className}`}>
      {MODES.map((m) => (
        <ScreensaverButton key={m.mode} mode={m.mode} label={m.label} title={m.title} />
      ))}
      <HoverButton />
    </div>
  );
}
