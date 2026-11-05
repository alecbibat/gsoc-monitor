import type { ReactNode } from 'react';
import type { RoadClosure } from '../../types';
import { NPS_PARK_BY_CODE } from '../../nps/parks';
import { ROAD_IMPACT } from './roadsMeta';

function fmt(iso: string | null): string | null {
  if (!iso) return null;
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return null;
  return d.toLocaleString([], { month: 'short', day: 'numeric', year: 'numeric', hour: 'numeric', minute: '2-digit' });
}

/** "in 3 days", "in 5 h" until an ISO time; null once past. */
function until(iso: string | null, now = Date.now()): string | null {
  const t = iso ? Date.parse(iso) : NaN;
  if (Number.isNaN(t) || t <= now) return null;
  const h = (t - now) / 3_600_000;
  if (h < 1) return `in ${Math.max(1, Math.round(h * 60))} min`;
  if (h < 48) return `in ${Math.round(h)} h`;
  return `in ${Math.round(h / 24)} days`;
}

function Row({ label, children }: { label: string; children: ReactNode }) {
  return (
    <div className="flex gap-3 text-[12px]">
      <span className="w-20 shrink-0 text-white/40">{label}</span>
      <span className="min-w-0 flex-1 text-white/85">{children}</span>
    </div>
  );
}

export function RoadClosureDetails({ payload: c }: { payload: RoadClosure }) {
  const meta = ROAD_IMPACT[c.impact] ?? ROAD_IMPACT.closed;
  const park = NPS_PARK_BY_CODE.get(c.parkCode);
  const endsIn = until(c.end);
  return (
    <div className="space-y-3">
      <div className="flex flex-wrap items-center gap-1.5 text-[10px] font-semibold uppercase tracking-wider">
        <span className="rounded px-1.5 py-0.5" style={{ color: meta.color, background: `${meta.color}26` }}>
          {meta.label}
        </span>
        {park && <span className="rounded bg-white/10 px-1.5 py-0.5 text-white/70">Near {park.name}</span>}
        {c.eventType && <span className="rounded bg-white/10 px-1.5 py-0.5 text-white/55">{c.eventType.replace(/-/g, ' ')}</span>}
      </div>

      {c.description && <p className="whitespace-pre-line text-[12.5px] leading-snug text-white/85">{c.description}</p>}

      <div className="space-y-1">
        {c.roadNames.length > 0 && <Row label="Road">{c.roadNames.join(' · ')}</Row>}
        {c.direction && <Row label="Direction">{c.direction}</Row>}
        <Row label="In force">{fmt(c.start) ? `since ${fmt(c.start)}` : 'now'}</Row>
        <Row label="Until">{fmt(c.end) ? `${fmt(c.end)}${endsIn ? ` (${endsIn})` : ''}` : 'No end time given'}</Row>
        <Row label="Source">{c.sourceLabel}</Row>
        {fmt(c.updated) && <Row label="Updated">{fmt(c.updated)}</Row>}
      </div>

      <div className="flex flex-wrap gap-x-4 gap-y-1 text-[11px]">
        {c.url && (
          <a href={c.url} target="_blank" rel="noopener noreferrer" className="text-accent/90 hover:underline">
            More from the source ↗
          </a>
        )}
        {park && (
          <a
            href={`https://www.nps.gov/${park.code}/planyourvisit/conditions.htm`}
            target="_blank"
            rel="noopener noreferrer"
            className="text-accent/90 hover:underline"
          >
            {park.name} road conditions ↗
          </a>
        )}
      </div>
    </div>
  );
}
