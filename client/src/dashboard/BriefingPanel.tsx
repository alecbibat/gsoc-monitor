import { useEffect, useMemo } from 'react';
import { useBriefingStore } from './briefingStore';
import { useDashboardStore } from './dashboardStore';
import { assessThreat, threatColor } from './threatScore';
import type { LocationGroup } from '../layers/locations/locations';

// The duty-officer strip at the top of the status dashboard: an auto-written
// operational briefing (AI when the server has a key, rules digest otherwise)
// plus the top-concern properties as clickable score chips.
export function BriefingPanel({ onSelectGroup }: { onSelectGroup: (g: LocationGroup) => void }) {
  const groups = useDashboardStore((s) => s.groups);
  const headline = useBriefingStore((s) => s.headline);
  const narrative = useBriefingStore((s) => s.narrative);
  const source = useBriefingStore((s) => s.source);
  const model = useBriefingStore((s) => s.model);
  const updated = useBriefingStore((s) => s.updated);
  const loading = useBriefingStore((s) => s.loading);
  const error = useBriefingStore((s) => s.error);
  const refresh = useBriefingStore((s) => s.refresh);

  // Refresh (throttled in the store) whenever a scan lands while we're open.
  useEffect(() => {
    if (groups.length > 0) void refresh();
  }, [groups, refresh]);

  const topConcerns = useMemo(
    () =>
      groups
        .map((g) => ({ group: g.group, score: assessThreat(g).score }))
        .filter((t) => t.score >= 15)
        .sort((a, b) => b.score - a.score)
        .slice(0, 3),
    [groups]
  );

  if (groups.length === 0) return null;

  return (
    <div className="mb-4 overflow-hidden rounded-2xl border border-accent/20 bg-gradient-to-br from-accent/[0.07] to-transparent">
      <div className="flex items-center gap-2 px-4 pt-3">
        <span className="text-[13px]">🎖</span>
        <span className="text-[11px] font-semibold uppercase tracking-[0.18em] text-white/40">
          Ops briefing
        </span>
        <span className="text-[10px] text-white/30">
          {source === 'ai' ? `AI · ${model ?? ''}` : source === 'rules' ? 'automated digest' : ''}
          {updated > 0 &&
            ` · ${new Date(updated).toLocaleTimeString(undefined, { hour: 'numeric', minute: '2-digit' })}`}
        </span>
        <button
          onClick={() => void refresh(true)}
          disabled={loading}
          className="ml-auto rounded-md border border-white/10 bg-white/5 px-2 py-0.5 text-[10px] font-medium text-white/50 transition hover:bg-white/10 hover:text-white/80 disabled:opacity-40"
        >
          {loading ? 'Writing…' : 'Refresh'}
        </button>
      </div>

      <div className="px-4 pb-3.5 pt-2">
        {narrative ? (
          <>
            {headline && (
              <div className="mb-1.5 text-[15px] font-bold leading-snug text-white">{headline}</div>
            )}
            <div className="space-y-1.5">
              {narrative.split(/\n{2,}/).map((para, i) => (
                <p key={i} className="text-[12.5px] leading-relaxed text-white/70">
                  {para}
                </p>
              ))}
            </div>
          </>
        ) : loading ? (
          <div className="py-1 text-[12px] text-white/40">Composing briefing…</div>
        ) : error ? (
          <div className="py-1 text-[12px] text-amber-300/70">Briefing unavailable · {error}</div>
        ) : (
          <div className="py-1 text-[12px] text-white/40">Waiting for first scan…</div>
        )}

        {topConcerns.length > 0 && (
          <div className="mt-2.5 flex flex-wrap items-center gap-1.5">
            <span className="text-[10px] font-semibold uppercase tracking-wider text-white/30">
              Top concerns
            </span>
            {topConcerns.map(({ group, score }) => (
              <button
                key={group.id}
                onClick={() => onSelectGroup(group)}
                title="View on the globe"
                className="flex items-center gap-1.5 rounded-full border border-white/10 bg-white/5 py-0.5 pl-1.5 pr-2.5 text-[11px] font-medium text-white/75 transition hover:bg-white/10"
              >
                <span
                  className="rounded-full px-1.5 text-[10px] font-bold tabular-nums text-ink-950"
                  style={{ backgroundColor: threatColor(score) }}
                >
                  {score}
                </span>
                {group.icon} {group.name}
              </button>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}
