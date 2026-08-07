import { useEffect } from 'react';
import { useScreensaverStore } from './screensaverStore';
import { useProximityStore } from '../widgets/proximity/proximityStore';
import type { PropertyHazards } from '../widgets/proximity/proximityScan';
import { severityRank } from '../layers/alerts/alertsData';
import { quakeColor } from '../widgets/proximity/format';
import type { LocationGroup } from '../layers/locations/locations';

// One card per property GROUP with active hazards, shown along the top during
// the pins screensaver (between the tour controls and the clock card). Each
// card combines its locations' hazards so the actual alerts stay readable
// without a card per property: distinct NWS event names in their alert
// colors — with ×N when several of the group's sites are under the same event
// — plus deduped fire and quake tallies. Groups with nothing nearby don't
// render at all, so quiet days collapse to a single all-clear pill.

interface AlertChip {
  event: string;
  colorHex: string;
  count: number; // affected locations in the group under this event
  rank: number;
}

interface GroupSummary {
  group: LocationGroup;
  affectedCount: number;
  alerts: AlertChip[];
  fireCount: number;
  quakeCount: number;
  maxQuakeMag: number;
}

// Fold the worst-first affected list into per-group summaries (insertion order
// keeps groups worst-first too). Fires dedupe by coordinate and quakes by id,
// since one hotspot or quake can sit within range of several sister sites.
function summarize(affected: PropertyHazards[]): GroupSummary[] {
  const order: GroupSummary[] = [];
  const byId = new Map<
    string,
    {
      summary: GroupSummary;
      alertMap: Map<string, AlertChip>;
      fireKeys: Set<string>;
      quakeIds: Set<string>;
    }
  >();

  for (const p of affected) {
    let entry = byId.get(p.group.id);
    if (!entry) {
      entry = {
        summary: {
          group: p.group,
          affectedCount: 0,
          alerts: [],
          fireCount: 0,
          quakeCount: 0,
          maxQuakeMag: 0,
        },
        alertMap: new Map(),
        fireKeys: new Set(),
        quakeIds: new Set(),
      };
      byId.set(p.group.id, entry);
      order.push(entry.summary);
    }
    entry.summary.affectedCount++;
    entry.summary.maxQuakeMag = Math.max(entry.summary.maxQuakeMag, p.maxQuakeMag ?? 0);

    const seenEvents = new Set<string>();
    for (const a of p.alerts) {
      const chip = entry.alertMap.get(a.event);
      if (!chip) {
        entry.alertMap.set(a.event, {
          event: a.event,
          colorHex: a.colorHex,
          count: 1,
          rank: severityRank(a.severity),
        });
      } else if (!seenEvents.has(a.event)) {
        chip.count++;
      }
      seenEvents.add(a.event);
    }
    for (const f of p.fires) entry.fireKeys.add(`${f.lat},${f.lon}`);
    for (const q of p.quakes) entry.quakeIds.add(q.id);
  }

  for (const e of byId.values()) {
    e.summary.alerts = [...e.alertMap.values()].sort((a, b) => b.rank - a.rank);
    e.summary.fireCount = e.fireKeys.size;
    e.summary.quakeCount = e.quakeIds.size;
  }
  return order;
}

function GroupCard({ g }: { g: GroupSummary }) {
  return (
    <div className="max-w-[360px] rounded-lg border border-white/10 bg-ink-900/85 px-3 py-2 shadow-panel backdrop-blur-sm">
      <div className="flex items-center gap-1.5">
        <span aria-hidden className="text-[13px] leading-none">{g.group.icon}</span>
        <span className="whitespace-nowrap text-[11px] font-semibold text-white/85">
          {g.group.name}
        </span>
        <span className="whitespace-nowrap text-[9px] tabular-nums text-white/35">
          {g.affectedCount}/{g.group.locations.length} sites
        </span>
        {g.fireCount > 0 && (
          <span className="ml-1 whitespace-nowrap text-[10px] font-bold text-accent-warn">
            <span aria-hidden>🔥</span>
            {g.fireCount}
          </span>
        )}
        {g.quakeCount > 0 && (
          <span
            className="ml-1 whitespace-nowrap text-[10px] font-bold"
            style={{ color: quakeColor(g.maxQuakeMag) }}
          >
            <span aria-hidden>◎</span>M{g.maxQuakeMag.toFixed(1)}
            {g.quakeCount > 1 && ` ×${g.quakeCount}`}
          </span>
        )}
      </div>

      {g.alerts.length > 0 && (
        <div className="mt-1.5 flex flex-wrap gap-1">
          {g.alerts.map((a) => (
            <span
              key={a.event}
              className="flex items-center gap-1 rounded border px-1.5 py-0.5 text-[10px] font-medium"
              style={{
                color: a.colorHex,
                borderColor: `${a.colorHex}55`,
                background: `${a.colorHex}14`,
              }}
            >
              <span className="h-1.5 w-1.5 shrink-0 rounded-full" style={{ background: a.colorHex }} />
              {a.event}
              {a.count > 1 && <span className="text-white/40">×{a.count}</span>}
            </span>
          ))}
        </div>
      )}
    </div>
  );
}

// The middle section of the pins screensaver's top row. Hidden on mobile —
// the focused property's hazards are already in the bottom card there.
export function PinsWatchGroups() {
  const active = useScreensaverStore((s) => s.active);
  const mode = useScreensaverStore((s) => s.mode);
  const result = useProximityStore((s) => s.result);
  const scan = useProximityStore((s) => s.scan);

  const isPins = active && mode === 'pins';

  // Keep scan fresh while we're the active consumer. The store throttles
  // repeat calls, so kicking one on entry never double-fetches — it only
  // refreshes a result that predates the screensaver starting.
  useEffect(() => {
    if (!isPins) return;
    void scan();
    const id = setInterval(() => scan(), 5 * 60_000);
    return () => clearInterval(id);
  }, [isPins, scan]);

  if (!isPins) return null;

  const groups = summarize(result?.properties ?? []);

  return (
    <div className="hidden min-w-0 flex-1 flex-wrap items-start justify-center gap-2 md:flex">
      {result === null ? (
        <div className="rounded-lg border border-white/10 bg-ink-900/85 px-3 py-2 text-[11px] text-white/40 shadow-panel backdrop-blur-sm">
          Scanning properties…
        </div>
      ) : groups.length === 0 ? (
        <div className="rounded-lg border border-accent-ok/30 bg-accent-ok/10 px-3 py-2 text-[11px] text-accent-ok shadow-panel backdrop-blur-sm">
          <span className="mr-1" aria-hidden>✓</span>
          All clear — {result.scannedCount} properties monitored
        </div>
      ) : (
        groups.map((g) => <GroupCard key={g.group.id} g={g} />)
      )}
    </div>
  );
}
