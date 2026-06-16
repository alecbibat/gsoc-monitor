import { SearchBar } from './SearchBar';
import { WidgetLauncher } from '../widgets/WidgetLauncher';
import { useScreensaverStore } from '../screensaver/screensaverStore';

export function TopBar() {
  const screensaverActive = useScreensaverStore((s) => s.active);
  const toggleScreensaver = useScreensaverStore((s) => s.toggle);

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
        <button
          onClick={toggleScreensaver}
          className={`pointer-events-auto flex items-center gap-1.5 rounded-lg border px-2.5 py-1.5 text-[11px] font-semibold tracking-widest shadow-panel backdrop-blur-sm transition-all ${
            screensaverActive
              ? 'border-accent/40 bg-accent/10 text-accent'
              : 'border-white/10 bg-ink-900/80 text-white/40 hover:text-white/70'
          }`}
          title="Globe rotates and visits active alerts, earthquakes, and strategic POIs"
        >
          <span
            className={`h-1.5 w-1.5 rounded-full ${screensaverActive ? 'animate-pulse bg-accent' : 'bg-white/20'}`}
          />
          SCREENSAVER
        </button>
      </div>
      <div className="pointer-events-auto">
        <SearchBar />
      </div>
    </div>
  );
}
