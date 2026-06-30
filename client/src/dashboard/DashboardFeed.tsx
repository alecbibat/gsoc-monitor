import type { FeedEvent, FeedType } from './dashboardData';

const TYPE_META: Record<FeedType, { icon: string; color: string }> = {
  alert: { icon: '⚠', color: 'text-red-400' },
  fire: { icon: '🔥', color: 'text-orange-400' },
  quake: { icon: '◎', color: 'text-amber-300' },
  news: { icon: '📰', color: 'text-sky-300' },
};

function relTime(at: number, now: number): string {
  const s = Math.max(0, Math.round((now - at) / 1000));
  if (s < 60) return `${s}s ago`;
  if (s < 3600) return `${Math.round(s / 60)}m ago`;
  if (s < 86400) return `${Math.round(s / 3600)}h ago`;
  return `${Math.round(s / 86400)}d ago`;
}

export function DashboardFeed({ feed }: { feed: FeedEvent[] }) {
  const now = Date.now();
  if (feed.length === 0) {
    return (
      <div className="px-1 py-6 text-[12px] leading-relaxed text-white/40">
        No nearby events yet — watching NWS alerts, wildfires, earthquakes, and news around the
        properties…
      </div>
    );
  }
  return (
    <div className="space-y-1.5">
      {feed.map((e, i) => {
        const m = TYPE_META[e.type];
        return (
          <div key={`${e.id}-${i}`} className="flex gap-2 rounded-lg bg-white/[0.03] px-2.5 py-2">
            <span className={`text-[13px] leading-tight ${m.color}`}>{m.icon}</span>
            <div className="min-w-0 flex-1">
              <div className="truncate text-[12px] text-white/80" title={e.title}>
                {e.title}
              </div>
              <div className="mt-0.5 flex items-center gap-1.5 text-[10px] text-white/40">
                <span className="truncate">{e.groupName}</span>
                {e.distanceMi != null && <span className="shrink-0">· {e.distanceMi.toFixed(0)} mi</span>}
                <span className="ml-auto shrink-0 tabular-nums">{relTime(e.at, now)}</span>
              </div>
            </div>
          </div>
        );
      })}
    </div>
  );
}
