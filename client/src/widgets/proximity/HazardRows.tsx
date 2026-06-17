import type { PropertyHazards } from './proximityScan';
import { expiresText, fmtMiles, quakeColor, timeAgo } from './format';

// Compact one-line-per-hazard summary (alert chips + fire + quake), shared by
// the Property Watch list cards and the popped-out detail panel.
export function HazardRows({ hazards, radiusMi }: { hazards: PropertyHazards; radiusMi: number }) {
  const p = hazards;
  return (
    <>
      {p.alerts.length > 0 && (
        <div className="mt-1.5 flex flex-wrap gap-1">
          {p.alerts.map((a) => {
            const left = expiresText(a.expires);
            return (
              <span
                key={a.id}
                className="flex items-center gap-1 rounded border px-1.5 py-0.5 text-[10px] font-medium"
                style={{
                  color: a.colorHex,
                  borderColor: `${a.colorHex}55`,
                  background: `${a.colorHex}14`,
                }}
                title={a.headline ?? a.areaDesc}
              >
                <span className="h-1.5 w-1.5 shrink-0 rounded-full" style={{ background: a.colorHex }} />
                {a.event}
                {left && <span className="text-white/35">· {left}</span>}
              </span>
            );
          })}
        </div>
      )}

      {p.fires.length > 0 && (
        <div className="mt-1.5 flex items-center gap-1.5 text-[11px] text-accent-warn/90">
          <span aria-hidden>🔥</span>
          <span>
            {p.fires.length} hotspot{p.fires.length > 1 ? 's' : ''} within {radiusMi} mi
            {p.nearestFireMi != null && (
              <span className="text-white/40"> · nearest {fmtMiles(p.nearestFireMi)} mi</span>
            )}
          </span>
        </div>
      )}

      {p.quakes.length > 0 && (
        <div
          className="mt-1.5 flex items-center gap-1.5 text-[11px]"
          style={{ color: quakeColor(p.maxQuakeMag ?? 0) }}
          title={p.quakes
            .slice(0, 5)
            .map((q) => `M${q.mag.toFixed(1)} · ${q.place || 'unknown'} · ${timeAgo(q.time)}`)
            .join('\n')}
        >
          <span aria-hidden>◎</span>
          <span>
            {p.quakes.length === 1
              ? `M${p.quakes[0].mag.toFixed(1)} earthquake`
              : `${p.quakes.length} earthquakes · max M${(p.maxQuakeMag ?? 0).toFixed(1)}`}
            {p.nearestQuakeMi != null && (
              <span className="text-white/40"> · nearest {fmtMiles(p.nearestQuakeMi)} mi</span>
            )}
          </span>
        </div>
      )}
    </>
  );
}
