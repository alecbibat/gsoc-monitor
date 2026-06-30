import { useEffect } from 'react';
import { useDashboardStore } from './dashboardStore';
import { scanDashboard, type StatusLevel } from './dashboardData';
import { DashboardCard } from './DashboardCard';
import { DashboardFeed } from './DashboardFeed';

const SCAN_MS = 75_000; // rescan cadence while the dashboard is open
const LEVEL_ORDER: Record<StatusLevel, number> = { alert: 0, watch: 1, ok: 2 };

// Full-screen property status dashboard. Mounts the scan loop only while open
// (the feed + dedup state live in the store, so they persist across open/close).
export function DashboardView() {
  const open = useDashboardStore((s) => s.open);
  const setOpen = useDashboardStore((s) => s.setOpen);
  const groups = useDashboardStore((s) => s.groups);
  const feed = useDashboardStore((s) => s.feed);
  const updated = useDashboardStore((s) => s.updated);
  const loading = useDashboardStore((s) => s.loading);
  const errors = useDashboardStore((s) => s.errors);

  useEffect(() => {
    if (!open) return;
    let cancelled = false;
    const run = async () => {
      useDashboardStore.getState().setLoading(true);
      try {
        const scan = await scanDashboard();
        if (!cancelled) useDashboardStore.getState().applyScan(scan);
      } catch {
        if (!cancelled) useDashboardStore.getState().setLoading(false);
      }
    };
    run();
    const t = setInterval(run, SCAN_MS);
    return () => {
      cancelled = true;
      clearInterval(t);
    };
  }, [open]);

  if (!open) return null;

  const sorted = [...groups].sort((a, b) => LEVEL_ORDER[a.level] - LEVEL_ORDER[b.level]);

  return (
    <div className="absolute inset-0 z-[60] flex flex-col bg-ink-950/95 backdrop-blur-md">
      <div className="flex items-center gap-3 border-b border-white/10 px-5 py-3">
        <span className="text-lg">🛰</span>
        <div className="min-w-0">
          <div className="text-[15px] font-bold leading-tight text-white">Property Status Dashboard</div>
          <div className="truncate text-[11px] text-white/40">
            {groups.length} property groups
            {updated
              ? ` · updated ${new Date(updated).toLocaleTimeString(undefined, { hour: 'numeric', minute: '2-digit' })}`
              : ' · loading…'}
            {loading && ' · refreshing'}
            {errors.length > 0 && (
              <span className="text-amber-300/70"> · {errors.length} feed(s) degraded</span>
            )}
          </div>
        </div>
        <button
          onClick={() => setOpen(false)}
          className="ml-auto rounded-md border border-white/15 bg-white/5 px-3 py-1.5 text-[12px] font-semibold text-white/80 transition hover:bg-white/10"
        >
          ✕ Close
        </button>
      </div>

      <div className="flex min-h-0 flex-1 flex-col gap-4 overflow-hidden p-5 lg:flex-row">
        <div className="min-h-0 flex-1 overflow-y-auto">
          {groups.length === 0 ? (
            <div className="grid h-full place-items-center text-[13px] text-white/40">
              Scanning properties…
            </div>
          ) : (
            <div className="grid grid-cols-1 items-start gap-3.5 sm:grid-cols-2 xl:grid-cols-3">
              {sorted.map((s) => (
                <DashboardCard key={s.group.id} s={s} />
              ))}
            </div>
          )}
        </div>

        <div className="flex min-h-0 w-full flex-col lg:w-80">
          <div className="mb-2 flex items-center gap-2 text-[11px] font-semibold uppercase tracking-wider text-white/40">
            <span className="h-1.5 w-1.5 animate-pulse rounded-full bg-red-500" /> Live feed
          </div>
          <div className="min-h-0 flex-1 overflow-y-auto pr-1">
            <DashboardFeed feed={feed} />
          </div>
        </div>
      </div>
    </div>
  );
}
