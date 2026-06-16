import { SearchBar } from './SearchBar';
import { WidgetLauncher } from '../widgets/WidgetLauncher';
import { useScreensaverStore } from '../screensaver/screensaverStore';
import type { ScreensaverMode } from '../screensaver/screensaverStore';

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

export function TopBar() {
  return (
    <div className="pointer-events-none absolute inset-x-0 top-0 z-20 flex items-start justify-between gap-4 p-4">
      <div className="flex items-center gap-3">
        <div className="pointer-events-auto flex items-center gap-2 rounded-lg border border-white/10 bg-ink-900/80 px-3 py-2 shadow-panel backdrop-blur-sm">
          <span className="h-2 w-2 animate-pulse rounded-full bg-accent-ok shadow-glow" />
          <span className="font-mono text-[13px] font-semibold tracking-[0.2em] text-white/90">
            GSOC<span className="text-accent">MONITOR</span>
          </span>
        </div>
        <WidgetLauncher />
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
      </div>
      <div className="pointer-events-auto">
        <SearchBar />
      </div>
    </div>
  );
}
