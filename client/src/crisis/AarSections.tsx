import { useEffect, useState } from 'react';
import { useCrisisStore, type Incident } from './crisisStore';
import { COMPLEXITY_TYPES } from './crisisStore';
import { buildSwimlane, computeAarMetrics, fmtSpan } from './aarMetrics';

// ── AAR sections (Track 6 revamp) ────────────────────────────────────────────
// Renders inside CrisisReportModal through the shared print pipeline: SVG and
// tables print crisply; editors carry print-hide with print-only twins.

function fmtTs(iso: string) {
  try {
    return new Date(iso).toLocaleString('en-US', {
      month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit',
    });
  } catch { return iso; }
}

function StatCard({ label, value, sub }: { label: string; value: string; sub?: string }) {
  return (
    <div className="print-card rounded-lg border border-white/8 bg-white/4 px-3.5 py-3">
      <div className="text-[9px] font-bold uppercase tracking-[0.14em] text-white/35 print-muted">{label}</div>
      <div className="mt-1 text-[15px] font-semibold text-white/85">{value}</div>
      {sub && <div className="mt-0.5 text-[10px] text-white/40 print-muted">{sub}</div>}
    </div>
  );
}

// ── Response metrics band ────────────────────────────────────────────────────

interface ReachStats { count: number; viewers: number; links: number }

/** Sum share access aggregates across every link this incident ever had. */
function useShareReach(incident: Incident): ReachStats | null {
  const [reach, setReach] = useState<ReachStats | null>(null);
  useEffect(() => {
    // shareLinks is absent on incidents persisted before the share-link
    // lifecycle existed — never index it bare (render crash on legacy data).
    const tokens = (incident.shareLinks ?? []).map((l) => l.token);
    if (incident.shareToken && !tokens.includes(incident.shareToken)) tokens.push(incident.shareToken);
    if (tokens.length === 0) return;
    let cancelled = false;
    Promise.all(
      tokens.map((t) =>
        fetch(`/api/crisis/share/${t}/access`, { credentials: 'include' })
          .then((r) => (r.ok ? (r.json() as Promise<{ count: number; viewers: number }>) : null))
          .catch(() => null)
      )
    ).then((rows) => {
      if (cancelled) return;
      const ok = rows.filter((r): r is { count: number; viewers: number } => r !== null);
      if (ok.length === 0) return;
      setReach({
        count: ok.reduce((n, r) => n + r.count, 0),
        viewers: ok.reduce((n, r) => n + r.viewers, 0),
        links: tokens.length,
      });
    });
    return () => { cancelled = true; };
  }, [incident.id, incident.shareLinks, incident.shareToken]);
  return reach;
}

export function ResponseMetrics({ incident }: { incident: Incident }) {
  const m = computeAarMetrics(incident);
  const reach = useShareReach(incident);
  const complexity = COMPLEXITY_TYPES.find((t) => t.id === incident.complexityType)?.label;

  return (
    <div>
      <h2 className="mb-3 text-[10px] font-bold uppercase tracking-[0.14em] text-white/30">Response Metrics</h2>
      <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-5">
        <StatCard
          label="Duration"
          value={fmtSpan(m.durationMs)}
          sub={incident.archivedAt ? 'start → stand-down' : 'start → now (still open)'}
        />
        <StatCard
          label="Time to Active"
          value={
            m.timeToActiveMs !== null ? fmtSpan(m.timeToActiveMs)
            : m.activeAtCreation ? 'At creation'
            : 'Never active'
          }
          sub={
            m.timeToActiveMs !== null ? 'creation → first Active status'
            : m.activeAtCreation ? 'created in Active status'
            : 'no Active phase before stand-down'
          }
        />
        <StatCard
          label="Personnel"
          value={String(m.personnelCount)}
          sub={`${m.assignmentCount} assignment${m.assignmentCount === 1 ? '' : 's'}${m.commandTransfers > 0 ? ` · ${m.commandTransfers} command transfer${m.commandTransfers === 1 ? '' : 's'}` : ''}`}
        />
        <StatCard
          label="Log entries"
          value={String(m.logTotal)}
          sub={`${m.operatorEntries} operator · ${m.logTotal - m.operatorEntries} auto`}
        />
        <StatCard
          label="Stakeholder reach"
          value={reach ? `${reach.count}×` : (incident.shareLinks ?? []).length > 0 ? '…' : '—'}
          sub={
            reach
              ? `~${reach.viewers} viewer${reach.viewers === 1 ? '' : 's'} · ${reach.links} link${reach.links === 1 ? '' : 's'}`
              : (incident.shareLinks ?? []).length > 0 ? 'share access log' : 'no share links published'
          }
        />
      </div>
      {complexity && (
        <p className="mt-2 text-[10px] text-white/40 print-muted">ICS complexity at close: {complexity}</p>
      )}
    </div>
  );
}

// ── ICS progression swimlane ─────────────────────────────────────────────────

export function IcsSwimlane({ incident }: { incident: Incident }) {
  const lane = buildSwimlane(incident);
  if (!lane) return null;

  const W = 940;
  const LABEL_W = 150;
  const ROW_H = 26;
  const AXIS_H = 26;
  const plotW = W - LABEL_W - 10;
  const H = lane.rows.length * ROW_H + AXIS_H;
  const span = Math.max(1, lane.t1 - lane.t0);
  const x = (t: number) => LABEL_W + ((t - lane.t0) / span) * plotW;

  // Axis ticks: hourly for short incidents, daily beyond ~2 days. Anchored to
  // LOCAL midnight (not epoch multiples) so a daily gridline sits at the
  // viewer's midnight and its date label matches the band it starts.
  const hourMs = 3_600_000;
  const step = span <= 12 * hourMs ? 2 * hourMs
    : span <= 48 * hourMs ? 6 * hourMs
    : span <= 8 * 86_400_000 ? 24 * hourMs
    : Math.ceil(span / (7 * 24 * hourMs)) * 24 * hourMs;
  const localMidnight = new Date(lane.t0);
  localMidnight.setHours(0, 0, 0, 0);
  let firstTick = localMidnight.getTime();
  while (firstTick < lane.t0) firstTick += step;
  const ticks: number[] = [];
  for (let t = firstTick; t <= lane.t1; t += step) ticks.push(t);
  // A short incident can fit entirely between two step boundaries — label the
  // window endpoints instead of rendering no time axis at all.
  if (ticks.length === 0) ticks.push(lane.t0, lane.t1);
  const tickLabel = (t: number) => {
    const d = new Date(t);
    return step >= 24 * hourMs
      ? d.toLocaleDateString('en-US', { month: 'numeric', day: 'numeric' })
      : d.toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit' });
  };

  return (
    <div>
      <h2 className="mb-3 text-[10px] font-bold uppercase tracking-[0.14em] text-white/30">
        ICS Progression
        <span className="ml-2 font-normal normal-case text-white/25">who held which seat, when</span>
      </h2>
      {/* Inline background + print-color: the swimlane's SVG text is white
          FILL attributes the paper-theme flip can't remap, so the dark panel
          must survive printing for the chart to stay legible on paper. */}
      <div
        className="print-card print-color overflow-x-auto rounded-lg border border-white/8 p-3"
        style={{ background: '#0d1117' }}
      >
        <svg viewBox={`0 0 ${W} ${H}`} className="print-color min-w-[680px]" style={{ width: '100%' }}>
          {/* Tick grid */}
          {ticks.map((t) => (
            <g key={t}>
              <line x1={x(t)} x2={x(t)} y1={0} y2={H - AXIS_H + 4} stroke="rgba(255,255,255,0.07)" strokeWidth="1" />
              <text x={x(t)} y={H - 8} textAnchor="middle" fontSize="9" fill="rgba(255,255,255,0.4)">
                {tickLabel(t)}
              </text>
            </g>
          ))}
          {lane.rows.map((row, ri) => {
            const y = ri * ROW_H;
            return (
              <g key={row.roleId}>
                {ri > 0 && <line x1={0} x2={W} y1={y} y2={y} stroke="rgba(255,255,255,0.05)" strokeWidth="1" />}
                <text x={LABEL_W - 8} y={y + ROW_H / 2 + 3} textAnchor="end" fontSize="10" fontWeight="600" fill={row.color}>
                  {row.abbrev || row.title}
                </text>
                {row.bars.map((b, bi) => {
                  const bx = x(b.startMs);
                  const bw = Math.max(3, x(b.endMs) - bx);
                  const showName = bw > 56;
                  return (
                    <g key={bi}>
                      <rect
                        x={bx} y={y + 5} width={bw} height={ROW_H - 10} rx={3}
                        fill={`${row.color}55`} stroke={row.color} strokeWidth="1"
                        strokeDasharray={b.open ? '3 3' : undefined}
                      >
                        <title>{`${b.name} — ${fmtTs(new Date(b.startMs).toISOString())} → ${b.open ? 'still assigned' : fmtTs(new Date(b.endMs).toISOString())}`}</title>
                      </rect>
                      {showName && (
                        <text x={bx + 5} y={y + ROW_H / 2 + 3} fontSize="9" fill="rgba(255,255,255,0.85)">
                          {b.name.length > Math.floor(bw / 6) ? `${b.name.slice(0, Math.floor(bw / 6) - 1)}…` : b.name}
                        </text>
                      )}
                    </g>
                  );
                })}
              </g>
            );
          })}
        </svg>
        <p className="mt-1 px-1 text-[9px] text-white/30 print-muted">
          Dashed bar = still assigned at report time · adjacent bars in one row = seat transfer
        </p>
      </div>
    </div>
  );
}

// ── Assignment roster ────────────────────────────────────────────────────────

export function RosterTable({ incident }: { incident: Incident }) {
  if (incident.assignments.length === 0) return null;
  const roleTitle = (id: string) => incident.roles.find((r) => r.id === id)?.title ?? id;
  const rows = [...incident.assignments].sort(
    (a, b) => new Date(a.startedAt).getTime() - new Date(b.startedAt).getTime()
  );
  return (
    <div>
      <h2 className="mb-3 text-[10px] font-bold uppercase tracking-[0.14em] text-white/30">
        Assignment Roster
        <span className="ml-2 font-normal normal-case text-white/25">({rows.length})</span>
      </h2>
      <div className="overflow-x-auto rounded-lg border border-white/8 bg-white/4">
        <table className="w-full text-[12px]">
          <thead>
            <tr className="border-b border-white/10 text-left text-[9px] font-bold uppercase tracking-wider text-white/35">
              <th className="px-3 py-2">Name</th>
              <th className="px-3 py-2">Role</th>
              <th className="px-3 py-2">Assigned</th>
              <th className="px-3 py-2">Released</th>
              <th className="px-3 py-2 text-right">Held for</th>
            </tr>
          </thead>
          <tbody>
            {rows.map((a) => {
              const start = new Date(a.startedAt).getTime();
              const end = a.endedAt ? new Date(a.endedAt).getTime() : Date.now();
              return (
                <tr key={a.id} className="border-b border-white/5 text-white/70 last:border-0">
                  <td className="px-3 py-1.5 font-semibold">{a.name}</td>
                  <td className="px-3 py-1.5 text-white/50">{roleTitle(a.roleId)}</td>
                  <td className="px-3 py-1.5">{fmtTs(a.startedAt)}</td>
                  <td className="px-3 py-1.5">{a.endedAt ? fmtTs(a.endedAt) : <span className="text-emerald-300">active</span>}</td>
                  <td className="px-3 py-1.5 text-right">{Number.isFinite(start) ? fmtSpan(end - start) : '—'}</td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
    </div>
  );
}

// ── Four-question AAR + corrective actions (editable, post-incident) ─────────

const QUESTIONS: { key: 'expected' | 'happened' | 'wentWell' | 'improve'; title: string; hint: string }[] = [
  { key: 'expected', title: '1 · What was expected to happen?', hint: 'The plan, triggers, and assumptions going in.' },
  { key: 'happened', title: '2 · What actually happened?', hint: 'The factual sequence — lean on the log below.' },
  { key: 'wentWell', title: '3 · What went well, and why?', hint: 'Practices to keep and reinforce.' },
  { key: 'improve', title: '4 · What can be improved, and how?', hint: 'Specific, actionable — feed the corrective actions.' },
];

export function FourQuestions({ incident }: { incident: Incident }) {
  const updateAar = useCrisisStore((s) => s.updateAar);
  const aar = incident.aar ?? {};
  return (
    <div>
      <h2 className="mb-3 text-[10px] font-bold uppercase tracking-[0.14em] text-white/30">
        After-Action Review
        <span className="ml-2 font-normal normal-case text-white/25">editable after stand-down · autosaves</span>
      </h2>
      <div className="grid gap-4 sm:grid-cols-2">
        {QUESTIONS.map((q) => {
          const value = aar[q.key] ?? '';
          return (
            <div key={q.key} className="print-card">
              <h3 className="mb-1.5 text-[11px] font-semibold text-white/70">{q.title}</h3>
              <textarea
                value={value}
                onChange={(e) => updateAar(incident.id, { [q.key]: e.target.value })}
                placeholder={q.hint}
                rows={5}
                className="print-hide w-full resize-y rounded-lg border border-white/8 bg-white/4 px-3 py-2.5 text-[12px] leading-relaxed text-white/80 placeholder:text-white/25 focus:border-accent/40 focus:outline-none"
              />
              {/* Paper twin: clean text instead of a form control */}
              <p hidden className="print-only whitespace-pre-wrap rounded-lg border border-white/8 px-3 py-2.5 text-[12px] leading-relaxed">
                {value || '—'}
              </p>
            </div>
          );
        })}
      </div>
    </div>
  );
}

export function CorrectiveActions({ incident }: { incident: Incident }) {
  const add = useCrisisStore((s) => s.addCorrectiveAction);
  const update = useCrisisStore((s) => s.updateCorrectiveAction);
  const remove = useCrisisStore((s) => s.removeCorrectiveAction);
  const actions = incident.aar?.correctiveActions ?? [];
  const printable = actions.filter((a) => a.text.trim());

  return (
    <div>
      <h2 className="mb-3 flex items-center text-[10px] font-bold uppercase tracking-[0.14em] text-white/30">
        Corrective Actions
        <span className="ml-2 font-normal normal-case text-white/25">({actions.filter((a) => !a.done).length} open)</span>
        <button
          onClick={() => add(incident.id)}
          className="print-hide ml-auto rounded border border-accent/30 bg-accent/8 px-2 py-0.5 text-[10px] normal-case tracking-normal text-accent transition hover:bg-accent/18"
        >
          + Add action
        </button>
      </h2>

      {/* Screen editor */}
      <div className="print-hide space-y-1.5">
        {actions.length === 0 && (
          <p className="rounded-lg border border-white/8 bg-white/4 px-4 py-3 text-[12px] text-white/40">
            No corrective actions yet — capture the "improve" items as trackable follow-ups.
          </p>
        )}
        {actions.map((a) => (
          <div key={a.id} className="flex flex-wrap items-center gap-2 rounded-lg border border-white/8 bg-white/4 px-3 py-2">
            <input
              type="checkbox"
              checked={a.done ?? false}
              onChange={(e) => update(incident.id, a.id, { done: e.target.checked })}
              className="h-3.5 w-3.5 accent-emerald-400"
              title="Done"
            />
            <input
              value={a.text}
              onChange={(e) => update(incident.id, a.id, { text: e.target.value })}
              placeholder="What must change…"
              className={`min-w-0 flex-1 bg-transparent text-[12px] focus:outline-none ${a.done ? 'text-white/35 line-through' : 'text-white/80'} placeholder:text-white/25`}
            />
            <input
              value={a.owner ?? ''}
              onChange={(e) => update(incident.id, a.id, { owner: e.target.value })}
              placeholder="Owner"
              className="w-28 rounded border border-white/8 bg-white/4 px-2 py-1 text-[11px] text-white/70 placeholder:text-white/25 focus:outline-none"
            />
            <input
              type="date"
              value={a.due ?? ''}
              onChange={(e) => update(incident.id, a.id, { due: e.target.value })}
              className="rounded border border-white/8 bg-white/4 px-2 py-1 text-[11px] text-white/60 focus:outline-none [color-scheme:dark]"
              title="Due date"
            />
            <button
              onClick={() => remove(incident.id, a.id)}
              className="text-[11px] text-white/30 transition hover:text-red-300"
              title="Remove"
            >
              ✕
            </button>
          </div>
        ))}
      </div>

      {/* Paper twin: a clean table of the non-empty actions */}
      <div hidden className="print-only">
        {printable.length === 0 ? (
          <p className="rounded-lg border border-white/8 px-4 py-3 text-[12px]">No corrective actions recorded.</p>
        ) : (
          <table className="w-full text-[12px]">
            <thead>
              <tr className="border-b border-white/10 text-left text-[9px] font-bold uppercase tracking-wider">
                <th className="px-3 py-2">Status</th>
                <th className="px-3 py-2">Action</th>
                <th className="px-3 py-2">Owner</th>
                <th className="px-3 py-2">Due</th>
              </tr>
            </thead>
            <tbody>
              {printable.map((a) => (
                <tr key={a.id} className="border-b border-white/5 last:border-0">
                  <td className="px-3 py-1.5">{a.done ? '☑ Done' : '☐ Open'}</td>
                  <td className="px-3 py-1.5">{a.text}</td>
                  <td className="px-3 py-1.5">{a.owner || '—'}</td>
                  <td className="px-3 py-1.5">{a.due || '—'}</td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>
    </div>
  );
}
