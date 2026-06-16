import { SearchBar } from './SearchBar';
import { WidgetLauncher } from '../widgets/WidgetLauncher';

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
      </div>
      <div className="pointer-events-auto">
        <SearchBar />
      </div>
    </div>
  );
}
