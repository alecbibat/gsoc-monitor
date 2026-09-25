import { useEffect, useMemo, useRef, useState } from 'react';
import { assignmentRoleTitle, useCrisisStore, type AarCorrectiveAction, type Incident } from './crisisStore';
import { COMPLEXITY_TYPES } from './crisisStore';
import { buildSwimlane, computeAarMetrics, fmtSpan, type DurationBasis } from './aarMetrics';
import { incidentTypeDef } from './taxonomy';
import { roleProgress, type ChecklistItemState } from './checklistTemplate';
import { answeredCount } from './intakeTemplate';
import { IntakeTable } from './IntakeTable';
import { useCrisisTemplates, useResolvedChecklist, useResolvedIntake, type TemplatesStatus } from './templates/templatesStore';
import { useEnsureTemplatesLoaded } from './templates/editorTabChrome';

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

const DURATION_SUB: Record<DurationBasis, string> = {
  end: 'start → end',
  'stand-down': 'start → stand-down',
  now: 'start → now (still open)',
};

export function ResponseMetrics({ incident }: { incident: Incident }) {
  const m = computeAarMetrics(incident);
  const reach = useShareReach(incident);
  const complexity = COMPLEXITY_TYPES.find((t) => t.id === incident.complexityType)?.label;

  return (
    <div>
      <h2 className="mb-3 text-[10px] font-bold uppercase tracking-[0.14em] text-white/30">Response Metrics</h2>
      <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-5">
        <StatCard label="Duration" value={fmtSpan(m.durationMs)} sub={DURATION_SUB[m.durationBasis]} />
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
          sub={`${m.operatorEntries} operator · ${m.logByType.system} system`}
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
  // Rows are as tall as their sub-lanes: concurrent holders of one role
  // (support seats) stack instead of drawing over each other.
  const rowY: number[] = [];
  let totalLanes = 0;
  for (const row of lane.rows) { rowY.push(totalLanes * ROW_H); totalLanes += row.lanes; }
  const H = totalLanes * ROW_H + AXIS_H;
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
            const y = rowY[ri];
            const rowH = row.lanes * ROW_H;
            const label = row.removed ? `${row.title} (removed)` : row.abbrev || row.title;
            return (
              <g key={row.roleId}>
                {ri > 0 && <line x1={0} x2={W} y1={y} y2={y} stroke="rgba(255,255,255,0.05)" strokeWidth="1" />}
                <text
                  x={LABEL_W - 8} y={y + rowH / 2 + 3} textAnchor="end" fontSize="10" fontWeight="600" fill={row.color}
                  fontStyle={row.removed ? 'italic' : undefined}
                >
                  <title>{row.removed ? `${row.title} — role since removed from the org chart` : row.title}</title>
                  {label.length > 26 ? `${label.slice(0, 25)}…` : label}
                </text>
                {row.bars.map((b, bi) => {
                  const bx = x(b.startMs);
                  const bw = Math.max(3, x(b.endMs) - bx);
                  const by = y + b.lane * ROW_H;
                  const showName = bw > 56;
                  return (
                    <g key={bi}>
                      <rect
                        x={bx} y={by + 5} width={bw} height={ROW_H - 10} rx={3}
                        fill={`${row.color}55`} stroke={row.color} strokeWidth="1"
                        strokeDasharray={b.open ? '3 3' : undefined}
                      >
                        <title>{`${b.name} — ${fmtTs(new Date(b.startMs).toISOString())} → ${b.open ? 'still assigned' : fmtTs(new Date(b.endMs).toISOString())}`}</title>
                      </rect>
                      {showName && (
                        <text x={bx + 5} y={by + ROW_H / 2 + 3} fontSize="9" fill="rgba(255,255,255,0.85)">
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
          Dashed bar = still assigned at report time · adjacent bars in one row = seat transfer · stacked bars = concurrent holders (support roles)
        </p>
      </div>
    </div>
  );
}

// ── Assignment roster ────────────────────────────────────────────────────────

export function RosterTable({ incident }: { incident: Incident }) {
  if (incident.assignments.length === 0) return null;
  // Assignments outlive the roles they were on (removeRole keeps them as the
  // staffing record), so a role may be gone from the chart.
  const roleCell = (id: string) => {
    const live = incident.roles.find((r) => r.id === id);
    if (live) return live.title;
    const title = assignmentRoleTitle(incident, id);
    return (
      <>
        {title && `${title} `}
        <span className="italic text-white/35 print-muted">(removed role)</span>
      </>
    );
  };
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
                  <td className="px-3 py-1.5 text-white/50">{roleCell(a.roleId)}</td>
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

// ── Intake + checklist record (read-only, print-expanded) ────────────────────
// What the first caller reported, and when each ICS task was done and by whom
// — the evidence behind AAR questions 1 and 4, which otherwise survives only
// in the frozen editor tabs. Resolved exactly like those tabs: the incident's
// NORMALIZED type + property against the admin templates. The templates are
// live config, not frozen per incident, so state for items / questions they no
// longer resolve to is listed separately rather than dropped.

function SectionHeading({ title, note }: { title: string; note?: string }) {
  return (
    <h2 className="mb-3 text-[10px] font-bold uppercase tracking-[0.14em] text-white/30">
      {title}
      {note && <span className="ml-2 font-normal normal-case text-white/25">{note}</span>}
    </h2>
  );
}

function RecordNote({ children }: { children: React.ReactNode }) {
  return <p className="rounded-lg border border-white/8 bg-white/4 px-4 py-3 text-[12px] text-white/45">{children}</p>;
}

/** Templates not in hand: say so (with a retry on screen) instead of silently dropping the section. */
function TemplatesPending({ what, status, error, reload }: {
  what: string; status: TemplatesStatus; error: string | null; reload: () => Promise<void>;
}) {
  if (status !== 'error') return <RecordNote>Loading the {what}…</RecordNote>;
  return (
    <RecordNote>
      The {what} couldn't be loaded{error ? ` (${error})` : ''}, so this record is not shown.{' '}
      <button onClick={() => void reload()} className="print-hide text-accent/80 underline underline-offset-2 hover:text-accent">
        Retry
      </button>
    </RecordNote>
  );
}

export function IntakeRecord({ incident }: { incident: Incident }) {
  const typeId = incidentTypeDef(incident.incidentType).id;
  const { template, retiredFor, status, error, reload } = useResolvedIntake(typeId, incident.locationGroupId ?? null);
  useEnsureTemplatesLoaded(status, reload);
  const answers = incident.intake;
  const retired = useMemo(() => retiredFor(answers ?? {}), [retiredFor, answers]);
  const anyAnswer = Object.values(answers ?? {}).some((a) => a.trim());

  const answered = template ? answeredCount(template, answers ?? {}) : 0;
  const total = template ? template.groups.reduce((n, g) => n + g.questions.length, 0) : 0;
  return (
    <div>
      <SectionHeading
        title="Intake — Initial Contact"
        note={template && anyAnswer ? `${answered} of ${total} questions answered` : undefined}
      />
      {!anyAnswer ? (
        <RecordNote>No intake answers were recorded.</RecordNote>
      ) : template ? (
        <IntakeTable template={template} answers={answers ?? {}} retired={retired} />
      ) : (
        <TemplatesPending what="intake questions" status={status} error={error} reload={reload} />
      )}
    </div>
  );
}

/** When, then who — on two lines, so a long name wraps instead of being clipped on a phone. */
function StateStamp({ s }: { s: ChecklistItemState }) {
  return (
    <>
      <span className="whitespace-nowrap">{fmtTs(s.at)}</span>
      {s.by && <span className="block break-words text-white/40 print-muted">{s.by}</span>}
    </>
  );
}

export function ChecklistRecord({ incident }: { incident: Incident }) {
  const typeId = incidentTypeDef(incident.incidentType).id;
  const { template, retiredFor, status, error, reload } = useResolvedChecklist(typeId, incident.locationGroupId ?? null);
  useEnsureTemplatesLoaded(status, reload);
  const config = useCrisisTemplates();
  const checklists = incident.checklists;

  const roles = useMemo(() => {
    if (!template) return [];
    const state = checklists ?? {};
    return template.roles.map((role) => {
      const items = role.phases.flatMap((p) => p.items);
      return {
        role,
        ...roleProgress(role, state),
        // Checked items in the order they were done: the role's timeline.
        checked: items
          .filter((it) => state[it.id]?.checked)
          .map((it) => ({ item: it, s: state[it.id] }))
          .sort((a, b) => (Date.parse(a.s.at) || 0) - (Date.parse(b.s.at) || 0)),
        open: items.filter((it) => !state[it.id]?.checked),
      };
    });
  }, [template, checklists]);
  const retired = useMemo(() => retiredFor(checklists ?? {}), [retiredFor, checklists]);
  const roleName = (id: string | null) =>
    (id && (config?.checklistRoles.roles.find((r) => r.id === id)?.title ?? id)) || '—';

  const touched = Object.keys(checklists ?? {}).length > 0;
  if (!template) {
    return (
      <div>
        <SectionHeading title="ICS Checklist Record" />
        {touched
          ? <TemplatesPending what="checklist templates" status={status} error={error} reload={reload} />
          : <RecordNote>No checklist items were checked during this incident.</RecordNote>}
      </div>
    );
  }
  const done = roles.reduce((n, r) => n + r.done, 0);
  const total = roles.reduce((n, r) => n + r.total, 0);
  if (total === 0 && retired.length === 0) return null;

  return (
    <div>
      <SectionHeading
        title="ICS Checklist Record"
        note={`${done} of ${total} items done · measured against the current checklist template`}
      />
      {!touched ? (
        <RecordNote>No checklist items were checked during this incident ({total} in the current template).</RecordNote>
      ) : (
        <div className="space-y-3">
          {roles.map(({ role, done: d, total: t, checked, open }) => (
            <div key={role.id} className="print-card overflow-hidden rounded-lg border border-white/8 bg-white/4">
              <div className="flex items-baseline gap-2 border-b border-white/6 px-3 py-2">
                <span aria-hidden className="print-color h-2.5 w-2.5 shrink-0 self-center rounded-full" style={{ background: role.color }} />
                <span className="text-[12px] font-semibold text-white/80">{role.title}</span>
                <span className="text-[10px] text-white/35 print-muted">{role.code}</span>
                <span className={`ml-auto shrink-0 text-[11px] font-semibold ${d === t ? 'text-emerald-300' : 'text-white/55'}`}>
                  {d}/{t} done
                </span>
              </div>
              {checked.length > 0 && (
                <table className="w-full text-[11.5px]" aria-label={`${role.title}: checked items`}>
                  <tbody>
                    {checked.map(({ item, s }) => (
                      <tr key={item.id} className="border-b border-white/5 align-top text-white/75 last:border-0">
                        <td className="w-5 py-1.5 pl-3 text-emerald-300 print-color" aria-hidden>✓</td>
                        <td className="px-2 py-1.5">{item.text}</td>
                        <td className="py-1.5 pr-3 text-right text-[10.5px] text-white/50"><StateStamp s={s} /></td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              )}
              {open.length > 0 && (
                <p className="px-3 py-2 text-[10.5px] leading-relaxed text-white/45 print-muted">
                  <span className="font-semibold text-white/55">Not checked ({open.length}):</span>{' '}
                  {open.map((it, i) => {
                    const s = checklists?.[it.id];
                    return (
                      <span key={it.id}>
                        {i > 0 && <span aria-hidden className="text-white/20"> · </span>}
                        {it.text}
                        {/* Checked once, then cleared: the reversal is part of the record. */}
                        {s && <span className="italic text-white/30"> (unchecked {fmtTs(s.at)}{s.by ? ` by ${s.by}` : ''})</span>}
                      </span>
                    );
                  })}
                </p>
              )}
            </div>
          ))}
          {retired.length > 0 && (
            <div className="print-card overflow-x-auto rounded-lg border border-white/8 bg-white/4">
              <div className="border-b border-white/6 px-3 py-2 text-[12px] font-semibold text-white/70">
                Earlier checklist items
                <span className="ml-2 text-[10px] font-normal text-white/35">no longer in this incident's checklist (type or property changed, or since removed from the templates)</span>
              </div>
              <table className="w-full text-[11.5px]">
                <thead>
                  <tr className="border-b border-white/10 text-left text-[9px] font-bold uppercase tracking-wider text-white/35">
                    <th className="px-3 py-1.5">Item</th>
                    <th className="px-3 py-1.5">Role</th>
                    <th className="px-3 py-1.5">State</th>
                    <th className="px-3 py-1.5 text-right">Last change</th>
                  </tr>
                </thead>
                <tbody>
                  {retired.map((e) => (
                    <tr key={e.id} className="border-b border-white/5 align-top text-white/70 last:border-0">
                      <td className="px-3 py-1.5">{e.text ?? <span className="italic text-white/35">Item no longer in the templates</span>}</td>
                      <td className="px-3 py-1.5 text-white/50">{roleName(e.roleId)}</td>
                      <td className="px-3 py-1.5">{e.checked ? '✓ Checked' : 'Unchecked'}</td>
                      <td className="px-3 py-1.5 text-right text-[10.5px] text-white/50"><StateStamp s={e} /></td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </div>
      )}
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

/** Today as YYYY-MM-DD in LOCAL time — what a date input's value means (toISOString is UTC and flips near midnight). */
function todayLocal(): string {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}

/** Owner suggestions: everyone on the incident's roster or org chart, deduped case-insensitively. */
function ownerSuggestions(personnel: Incident['personnel'] | undefined, assignments: Incident['assignments']): string[] {
  const byKey = new Map<string, string>();
  for (const n of [...(personnel ?? []).map((p) => p.name), ...assignments.map((a) => a.name)]) {
    const name = n.trim();
    if (name && !byKey.has(name.toLowerCase())) byKey.set(name.toLowerCase(), name);
  }
  return [...byKey.values()].sort((a, b) => a.localeCompare(b));
}

export function CorrectiveActions({ incident }: { incident: Incident }) {
  const add = useCrisisStore((s) => s.addCorrectiveAction);
  const update = useCrisisStore((s) => s.updateCorrectiveAction);
  const remove = useCrisisStore((s) => s.removeCorrectiveAction);
  const actions = incident.aar?.correctiveActions ?? [];
  const printable = actions.filter((a) => a.text.trim());
  const today = todayLocal();
  const isOverdue = (a: AarCorrectiveAction) => !a.done && !!a.due && a.due < today;
  // Blank rows are drafts, not open items.
  const openCount = printable.filter((a) => !a.done).length;
  const overdueCount = printable.filter(isOverdue).length;
  const owners = useMemo(
    () => ownerSuggestions(incident.personnel, incident.assignments),
    [incident.personnel, incident.assignments]
  );
  const ownerListId = `aar-owners-${incident.id}`;

  // A row added from the button or with Enter gets the cursor, so a list of
  // follow-ups can be typed without reaching for the mouse between items.
  const textInputs = useRef(new Map<string, HTMLInputElement>());
  const [focusId, setFocusId] = useState<string | null>(null);
  useEffect(() => {
    if (!focusId) return;
    const el = textInputs.current.get(focusId);
    if (el) { el.focus(); setFocusId(null); }
  }, [focusId, actions]);
  const addAndFocus = () => setFocusId(add(incident.id));

  const removeRow = (a: AarCorrectiveAction) => {
    if (a.text.trim() && !window.confirm(`Remove this corrective action?\n\n${a.text.trim()}`)) return;
    remove(incident.id, a.id);
  };

  return (
    <div>
      <h2 className="mb-3 flex flex-wrap items-center gap-y-1 text-[10px] font-bold uppercase tracking-[0.14em] text-white/30">
        Corrective Actions
        <span className="ml-2 font-normal normal-case text-white/25">
          ({openCount} open
          {overdueCount > 0 && <span className="text-red-300/80"> · {overdueCount} overdue</span>})
        </span>
        <button
          onClick={addAndFocus}
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
        {owners.length > 0 && (
          <datalist id={ownerListId}>
            {owners.map((n) => <option key={n} value={n} />)}
          </datalist>
        )}
        {actions.map((a) => {
          const overdue = isOverdue(a);
          return (
          <div
            key={a.id}
            className={`flex flex-wrap items-center gap-2 rounded-lg border px-3 py-2 ${
              overdue ? 'border-red-400/35 bg-red-400/6' : 'border-white/8 bg-white/4'
            }`}
          >
            <input
              type="checkbox"
              checked={a.done ?? false}
              onChange={(e) => update(incident.id, a.id, { done: e.target.checked })}
              className="h-3.5 w-3.5 accent-emerald-400"
              title="Done"
              aria-label={a.text.trim() ? `Done: ${a.text.trim()}` : 'Done'}
            />
            <input
              ref={(el) => { if (el) textInputs.current.set(a.id, el); else textInputs.current.delete(a.id); }}
              value={a.text}
              onChange={(e) => update(incident.id, a.id, { text: e.target.value })}
              onKeyDown={(e) => {
                // Enter starts the next action — unless this one is still blank.
                if (e.key !== 'Enter' || e.nativeEvent.isComposing) return;
                e.preventDefault();
                if (a.text.trim()) addAndFocus();
              }}
              placeholder="What must change…"
              aria-label="Corrective action"
              className={`min-w-[10rem] flex-1 bg-transparent text-[12px] focus:outline-none ${a.done ? 'text-white/35 line-through' : 'text-white/80'} placeholder:text-white/25`}
            />
            {overdue && (
              <span className="rounded-full border border-red-400/40 bg-red-400/12 px-1.5 py-0.5 text-[9px] font-bold uppercase tracking-wider text-red-300">
                Overdue
              </span>
            )}
            <input
              value={a.owner ?? ''}
              onChange={(e) => update(incident.id, a.id, { owner: e.target.value })}
              placeholder="Owner"
              aria-label="Owner"
              list={owners.length > 0 ? ownerListId : undefined}
              autoComplete="off"
              className="w-32 rounded border border-white/8 bg-white/4 px-2 py-1 text-[11px] text-white/70 placeholder:text-white/25 focus:outline-none"
            />
            <input
              type="date"
              value={a.due ?? ''}
              onChange={(e) => update(incident.id, a.id, { due: e.target.value })}
              className={`rounded border bg-white/4 px-2 py-1 text-[11px] focus:outline-none [color-scheme:dark] ${
                overdue ? 'border-red-400/40 text-red-200' : 'border-white/8 text-white/60'
              }`}
              title="Due date"
              aria-label="Due date"
            />
            <button
              onClick={() => removeRow(a)}
              className="rounded px-1.5 py-0.5 text-[11px] text-white/30 transition hover:text-red-300"
              title="Remove"
              aria-label={a.text.trim() ? `Remove: ${a.text.trim()}` : 'Remove corrective action'}
            >
              ✕
            </button>
          </div>
          );
        })}
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
