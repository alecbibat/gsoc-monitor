import React, { createContext, useCallback, useContext, useEffect, useId, useLayoutEffect, useMemo, useRef, useState } from 'react';
import { useShallow } from 'zustand/react/shallow';
import {
  useCrisisStore, selectActive,
  DEFAULT_ROLES, chartOrder, roleSiblings, roleSubtreeIds,
  activeAssignmentsInSubtree, assignmentRoleTitle, isSamePerson,
  type Incident, type IcsRole, type MoveRoleTarget, type PersonnelAssignment, type PersonnelDetails,
  type PersonnelMember,
  IC_COLOR, CMD_COLOR, OPS_COLOR, PLAN_COLOR, LOG_COLOR, FIN_COLOR,
} from './crisisStore';
import { useEscapeLayer } from './escapeLayers';

// Renders a person's title + clickable phone/email beneath their name. Shared by
// the personnel pool and the role edit panel so contact info displays uniformly.
function ContactLines({ title, phone, email }: PersonnelDetails) {
  if (!title && !phone && !email) return null;
  return (
    <div className="mt-0.5 space-y-0.5">
      {title && <p className="text-[9px] text-white/45">{title}</p>}
      {phone && (
        <a
          href={`tel:${phone.replace(/[^+\d]/g, '')}`}
          onClick={(e) => e.stopPropagation()}
          className="block text-[9px] text-white/40 transition hover:text-accent"
        >
          ☎ {phone}
        </a>
      )}
      {email && (
        <a
          href={`mailto:${email}`}
          onClick={(e) => e.stopPropagation()}
          className="block truncate text-[9px] text-white/40 transition hover:text-accent"
        >
          ✉ {email}
        </a>
      )}
    </div>
  );
}

const WIRE = 'rgba(255,255,255,0.14)';
const WIRE_DASH = `repeating-linear-gradient(to right,${WIRE} 0,${WIRE} 5px,transparent 5px,transparent 10px)`;
const STEM_H = 24;

const PRESET_COLORS = [
  IC_COLOR, CMD_COLOR, OPS_COLOR, PLAN_COLOR, LOG_COLOR, FIN_COLOR,
  '#8b5cf6', '#ec4899', '#06b6d4', '#6b7280',
];

// ── Drag & drop ───────────────────────────────────────────────────────────────
//
// Three drags land on role cards, told apart by their dataTransfer type:
//   role card        → re-parent / reorder that role (moveRole)
//   name on a card   → reassign that person to the drop target (assignRole)
//   personnel chip   → assign them (assignRole)
// Anything else (files, links, selected text) is ignored. Payloads can't be
// read during dragover — only the type list can — so the chart also keeps the
// in-flight drag in context: that's what decides, card by card, whether and
// how a drop would land before the pointer is released.

const ROLE_MIME = 'application/x-ics-role';
const ASSIGNMENT_MIME = 'application/x-ics-assignment';
const PERSONNEL_MIME = 'personnel-id';

type DragKind = 'role' | 'assignment' | 'personnel';
interface ChartDrag { kind: DragKind; id: string }

const DRAG_MIME: Record<DragKind, string> = {
  role: ROLE_MIME,
  assignment: ASSIGNMENT_MIME,
  personnel: PERSONNEL_MIME,
};

function dragKindOf(dt: DataTransfer): DragKind | null {
  const types = Array.from(dt.types);
  if (types.includes(ROLE_MIME)) return 'role';
  if (types.includes(ASSIGNMENT_MIME)) return 'assignment';
  if (types.includes(PERSONNEL_MIME)) return 'personnel';
  return null;
}

export type RoleDropZone = 'before' | 'child' | 'after';

/**
 * Which part of a card the pointer is over: the outer thirds mean "beside it"
 * (a sibling before/after it), the middle "beneath it" (its last sub-role).
 * Top-level roles stack vertically, so theirs run top to bottom instead.
 */
export function dropZoneAt(
  rect: { left: number; top: number; width: number; height: number },
  x: number,
  y: number,
  vertical: boolean,
): RoleDropZone {
  const frac = vertical ? (y - rect.top) / rect.height : (x - rect.left) / rect.width;
  if (frac < 1 / 3) return 'before';
  if (frac > 2 / 3) return 'after';
  return 'child';
}

/**
 * The moveRole target for dropping `draggedId` on `zone` of `targetId`, or
 * null when that drop is illegal: onto the dragged role or anywhere in its own
 * subtree (a cycle), or — for a top-level role like the IC — anywhere except
 * beside another top-level role. The IC card is the chart's biggest target and
 * a slip would demote the whole command structure; putting a top-level role
 * under another is a deliberate "Reports to" choice in its edit panel.
 */
export function roleDropTarget(
  roles: readonly IcsRole[],
  draggedId: string,
  targetId: string,
  zone: RoleDropZone,
): MoveRoleTarget | null {
  const dragged = roles.find((r) => r.id === draggedId);
  const target = roles.find((r) => r.id === targetId);
  if (!dragged || !target) return null;
  if (roleSubtreeIds(roles, draggedId).has(targetId)) return null;
  if (dragged.parentId === null && (zone === 'child' || target.parentId !== null)) return null;
  if (zone === 'child') return { parentId: target.id };
  // Beside the target = in the target's own row. "After" is expressed as
  // "before whatever follows it", skipping the dragged role itself.
  const row = roleSiblings(roles, target.parentId, !!target.isCommandStaff).filter((r) => r.id !== draggedId);
  const i = row.findIndex((r) => r.id === target.id);
  return {
    parentId: target.parentId,
    beforeRoleId: zone === 'before' ? target.id : row[i + 1]?.id ?? null,
    isCommandStaff: !!target.isCommandStaff,
  };
}

interface ChartDnd {
  /** False on stood-down incidents: nothing drags, nothing accepts a drop. */
  editable: boolean;
  /** The in-flight drag, for rendering (dimming its source). */
  drag: ChartDrag | null;
  /** While a role is dragged: it and its subtree, which can't take the drop. */
  draggedSubtree: ReadonlySet<string> | null;
  /** The same drag, current mid-event — dragover logic reads this. */
  current: () => ChartDrag | null;
  begin: (e: React.DragEvent, drag: ChartDrag) => void;
  end: () => void;
  /** Voice an outcome to screen readers (polite live region). */
  announce: (message: string) => void;
}

const ChartDndContext = createContext<ChartDnd>({
  editable: false,
  drag: null,
  draggedSubtree: null,
  current: () => null,
  begin: () => {},
  end: () => {},
  announce: () => {},
});

// Move through the store, then announce the log's own sentence for the move.
// The store no-ops illegal or pointless moves, and then nothing is said.
function moveAndAnnounce(roleId: string, target: MoveRoleTarget, announce: (m: string) => void) {
  const st = useCrisisStore.getState();
  const before = selectActive(st);
  st.moveRole(roleId, target);
  const after = selectActive(useCrisisStore.getState());
  const top = after?.actionLog[0];
  if (after && after !== before && top?.system === 'role-moved') announce(top.description);
}

// The "Reports to" picker lists roles in chart order (crisisStore.chartOrder).
export { chartOrder };

// Whether `ancestorId` sits above `id`. Bounded by the role count so corrupt
// data with a parent cycle can't spin.
function isAncestorOf(roles: readonly IcsRole[], ancestorId: string, id: string): boolean {
  let cur = roles.find((r) => r.id === id)?.parentId ?? null;
  for (let i = 0; cur !== null && i <= roles.length; i++) {
    if (cur === ancestorId) return true;
    const pid: string = cur;
    cur = roles.find((r) => r.id === pid)?.parentId ?? null;
  }
  return false;
}

// ── Staffing ──────────────────────────────────────────────────────────────────

const NO_ASSIGNMENTS: PersonnelAssignment[] = [];
const NO_PERSONNEL: PersonnelMember[] = [];

const people = (n: number) => `${n} ${n === 1 ? 'person' : 'people'}`;

/** People assigned beneath a role (not on it) — what collapsing it hides. */
export function staffedBelow(inc: Pick<Incident, 'roles' | 'assignments'> | null, roleId: string): number {
  if (!inc) return 0;
  return activeAssignmentsInSubtree(inc.roles, inc.assignments, roleId).filter((a) => a.roleId !== roleId).length;
}

/** The role `name` / `personnelId` currently holds, if any (store identity rule). */
export function activeRoleOf(
  inc: Pick<Incident, 'roles' | 'assignments'>,
  name: string,
  personnelId?: string,
): IcsRole | undefined {
  const a = inc.assignments.find((x) => !x.endedAt && isSamePerson(x, name, personnelId));
  return a ? inc.roles.find((r) => r.id === a.roleId) : undefined;
}

/** The pool member a typed name refers to — only when exactly one matches. */
export function poolMemberNamed(personnel: readonly PersonnelMember[], name: string): PersonnelMember | undefined {
  const key = name.trim().toLowerCase();
  if (!key) return undefined;
  const hits = personnel.filter((p) => p.name.trim().toLowerCase() === key);
  return hits.length === 1 ? hits[0] : undefined;
}

/**
 * The top-level (command) seats that seating this person in `targetRoleId`
 * would leave empty — one person holds one role, so assignRole ends their
 * current one. Only these moves get a confirm: ordinary moves between other
 * roles go straight through (the log records where the person came from).
 */
export function commandSeatsVacated(
  inc: Pick<Incident, 'roles' | 'assignments'>,
  targetRoleId: string,
  name: string,
  personnelId?: string,
): IcsRole[] {
  return inc.assignments.flatMap((a) => {
    if (a.endedAt || a.roleId === targetRoleId || !isSamePerson(a, name, personnelId)) return [];
    const role = inc.roles.find((r) => r.id === a.roleId);
    if (!role || role.parentId !== null) return [];
    const othersHold = inc.assignments.some((b) => !b.endedAt && b.roleId === role.id && b.id !== a.id);
    return othersHold ? [] : [role];
  });
}

// Assign through the store — after a confirm when the move would empty a
// command seat — and announce the log's own sentence for it. Re-seating the
// current holder only updates their details and logs nothing, so nothing is
// said. False when the operator backed out.
function assignAndAnnounce(
  roleId: string,
  name: string,
  details: PersonnelDetails,
  personnelId: string | undefined,
  announce: (m: string) => void,
): boolean {
  const st = useCrisisStore.getState();
  const before = selectActive(st);
  if (!before) return false;
  const vacated = commandSeatsVacated(before, roleId, name, personnelId);
  if (vacated.length > 0) {
    const target = before.roles.find((r) => r.id === roleId)?.title ?? 'this role';
    const seats = vacated.map((r) => r.title).join(' and ');
    if (!confirm(`${name} is the ${seats}. Moving them to ${target} will leave ${seats} vacant — continue?`)) {
      return false;
    }
  }
  st.assignRole(roleId, name, details, personnelId);
  const after = selectActive(useCrisisStore.getState());
  const top = after?.actionLog[0];
  if (after && after.actionLog !== before.actionLog && top?.system === 'assignment') announce(top.description);
  return true;
}

// The store refuses to remove a branch anyone is still assigned in. The chart
// checks first, but a peer may have staffed it since — say so rather than
// silently doing nothing. True when the role is gone.
function removeRoleChecked(roleId: string): boolean {
  useCrisisStore.getState().removeRole(roleId);
  const inc = selectActive(useCrisisStore.getState());
  if (!inc || !inc.roles.some((r) => r.id === roleId)) return true;
  const n = activeAssignmentsInSubtree(inc.roles, inc.assignments, roleId).length;
  if (n > 0) alert(`This role can't be removed: ${people(n)} still assigned in its branch. Release them first.`);
  return false;
}

// ── Quick-add form ────────────────────────────────────────────────────────────

function QuickAddForm({
  parentId,
  parentColor,
  onDone,
}: {
  parentId: string | null;
  parentColor: string;
  onDone: () => void;
}) {
  const [title, setTitle] = useState('');
  const [abbrev, setAbbrev] = useState('');
  const [color, setColor] = useState(parentColor);
  const [isSupport, setIsSupport] = useState(false);
  const addRole = useCrisisStore((s) => s.addRole);
  const roles = useCrisisStore((s) => selectActive(s)?.roles ?? []);
  const titleRef = useRef<HTMLInputElement>(null);

  useEffect(() => { titleRef.current?.focus(); }, []);

  const handleAdd = () => {
    const t = title.trim();
    if (!t) return;
    const siblingCount = roles.filter((r) => r.parentId === parentId).length;
    addRole({ title: t, abbrev: abbrev.trim() || undefined, parentId, color, isCommandStaff: false, isSupport, order: siblingCount });
    onDone();
  };

  return (
    <div
      onClick={(e) => e.stopPropagation()}
      className="mt-2 w-40 space-y-1.5 rounded border border-white/12 bg-white/4 p-2"
    >
      <input
        ref={titleRef}
        aria-label="Role title"
        className="w-full rounded border border-white/8 bg-white/8 px-2 py-1 text-[10px] text-white/80 outline-none placeholder-white/20 focus:border-white/20"
        placeholder="Role title"
        value={title}
        onChange={(e) => setTitle(e.target.value)}
        onKeyDown={(e) => { if (e.key === 'Enter') handleAdd(); if (e.key === 'Escape') { e.stopPropagation(); onDone(); } }}
      />
      <input
        aria-label="Abbreviation (optional)"
        className="w-full rounded border border-white/8 bg-white/8 px-2 py-1 text-[10px] text-white/50 outline-none placeholder-white/20 focus:border-white/20"
        placeholder="Abbrev (opt.)"
        value={abbrev}
        onChange={(e) => setAbbrev(e.target.value)}
        onKeyDown={(e) => { if (e.key === 'Enter') handleAdd(); if (e.key === 'Escape') { e.stopPropagation(); onDone(); } }}
      />
      <div className="flex flex-wrap gap-1">
        {PRESET_COLORS.map((c) => (
          <button
            key={c}
            type="button"
            aria-label={`Color ${c}`}
            aria-pressed={color === c}
            onClick={() => setColor(c)}
            className="h-3.5 w-3.5 rounded-full border-2 transition"
            style={{ background: c, borderColor: color === c ? 'white' : 'transparent' }}
          />
        ))}
      </div>
      <label className="flex cursor-pointer items-center gap-1 text-[9px] text-white/35 hover:text-white/55">
        <input type="checkbox" checked={isSupport} onChange={(e) => setIsSupport(e.target.checked)} className="accent-accent" />
        Support (multi-person)
      </label>
      <div className="flex gap-1">
        <button onClick={handleAdd} disabled={!title.trim()} className="flex-1 rounded bg-accent/15 py-0.5 text-[9px] text-accent hover:bg-accent/25 disabled:opacity-30">
          Add
        </button>
        <button onClick={onDone} aria-label="Cancel" className="flex-1 rounded border border-white/8 py-0.5 text-[9px] text-white/30 hover:text-white/55">
          ✕
        </button>
      </div>
    </div>
  );
}

// ── Primitives ────────────────────────────────────────────────────────────────

function Stem({ h = STEM_H, dashed = false }: { h?: number; dashed?: boolean }) {
  return (
    <div
      className="w-px shrink-0"
      style={{
        height: h,
        background: dashed
          ? `repeating-linear-gradient(to bottom,${WIRE} 0,${WIRE} 4px,transparent 4px,transparent 8px)`
          : WIRE,
      }}
    />
  );
}

function ConnectorRow({ children, dashed = false }: { children: React.ReactNode; dashed?: boolean }) {
  const items = React.Children.toArray(children);
  const n = items.length;
  const sidePct = 50 / n;
  const barStyle = dashed ? WIRE_DASH : WIRE;

  return (
    <div className="relative flex w-full">
      {n > 1 && (
        <div
          aria-hidden
          className="pointer-events-none absolute top-0 h-px"
          style={{ left: `${sidePct}%`, right: `${sidePct}%`, background: barStyle }}
        />
      )}
      {/* Keyed by the child's own key (toArray keeps RoleSubtree's role id):
          an index key would remount every later sibling — losing its expand
          and add-child state — whenever a role is added, removed or moved. */}
      {items.map((child, i) => (
        <div key={(React.isValidElement(child) ? child.key : null) ?? i} className="flex flex-1 flex-col items-center">
          <Stem dashed={dashed} />
          {child}
        </div>
      ))}
    </div>
  );
}

// A name on a card — itself draggable, so a person can be moved straight to
// another role. stopPropagation keeps the card's own dragstart (which would
// turn this into a role drag) from firing.
function AssigneeName({ assignment, className }: { assignment: PersonnelAssignment; className: string }) {
  const dnd = useContext(ChartDndContext);
  const dragging = dnd.drag?.kind === 'assignment' && dnd.drag.id === assignment.id;
  return (
    <span
      draggable={dnd.editable}
      onDragStart={(e) => { e.stopPropagation(); dnd.begin(e, { kind: 'assignment', id: assignment.id }); }}
      onDragEnd={dnd.end}
      title={dnd.editable ? `Drag ${assignment.name} onto another role to reassign` : undefined}
      className={`${className} ${
        dnd.editable ? 'cursor-grab rounded px-1 transition hover:bg-white/10 active:cursor-grabbing' : ''
      } ${dragging ? 'opacity-40' : ''}`}
    >
      {assignment.name}
    </span>
  );
}

// ── Node card ─────────────────────────────────────────────────────────────────

// What a hovered card would do with the drop: take a person, or place a role.
type Hover = { kind: 'person' } | { kind: 'role'; zone: RoleDropZone };

function sameHover(a: Hover | null, b: Hover): boolean {
  if (!a || a.kind !== b.kind) return false;
  return a.kind === 'person' || (b.kind === 'role' && a.zone === b.zone);
}

// Hovering a collapsed parent this long mid-drag opens it, so its hidden
// sub-roles become drop targets too.
const EXPAND_DWELL_MS = 600;

function NodeCard({
  role,
  selected,
  onSelect,
  onRemoved,
  hasKids,
  collapsedKids,
  onExpand,
}: {
  role: IcsRole;
  selected: boolean;
  onSelect: () => void;
  onRemoved?: () => void;
  /** Has sub-roles (shown or not). */
  hasKids: boolean;
  /** Sub-roles exist but are collapsed out of view. */
  collapsedKids: boolean;
  onExpand: () => void;
}) {
  const dnd = useContext(ChartDndContext);
  const [hover, setHover] = useState<Hover | null>(null);
  const expandTimer = useRef<number | null>(null);
  const activeAssignments = useCrisisStore(useShallow((s) =>
    (selectActive(s)?.assignments ?? []).filter((a) => a.roleId === role.id && !a.endedAt)
  ));

  const isRoot = role.parentId === null;
  const isEmpty = activeAssignments.length === 0;
  const dimmed = !!dnd.draggedSubtree?.has(role.id);

  const disarmExpand = useCallback(() => {
    if (expandTimer.current !== null) {
      window.clearTimeout(expandTimer.current);
      expandTimer.current = null;
    }
  }, []);
  const armExpand = () => {
    if (!collapsedKids || expandTimer.current !== null) return;
    expandTimer.current = window.setTimeout(() => {
      expandTimer.current = null;
      onExpand();
    }, EXPAND_DWELL_MS);
  };
  const clearHover = () => {
    setHover(null);
    disarmExpand();
  };

  useEffect(() => disarmExpand, [disarmExpand]);
  // Belt and braces: a drag cancelled over this card (Esc) normally sends
  // dragleave first, but never leave a stale indicator behind once it's over.
  useEffect(() => {
    if (!dnd.drag) {
      setHover(null);
      disarmExpand();
    }
  }, [dnd.drag, disarmExpand]);

  const hoverFor = (kind: DragKind, e: React.DragEvent<HTMLDivElement>): Hover | null => {
    if (kind === 'personnel') return { kind: 'person' };
    const drag = dnd.current();
    const inc = selectActive(useCrisisStore.getState());
    if (!drag || drag.kind !== kind || !inc) return null;
    if (kind === 'assignment') {
      const a = inc.assignments.find((x) => x.id === drag.id);
      return a && !a.endedAt && a.roleId !== role.id ? { kind: 'person' } : null;
    }
    const zone = dropZoneAt(e.currentTarget.getBoundingClientRect(), e.clientX, e.clientY, isRoot);
    return roleDropTarget(inc.roles, drag.id, role.id, zone) ? { kind: 'role', zone } : null;
  };

  const handleDragOver = (e: React.DragEvent<HTMLDivElement>) => {
    const kind = dnd.editable ? dragKindOf(e.dataTransfer) : null;
    if (!kind) return; // not ours — leave the browser's default (no drop)
    const next = hoverFor(kind, e);
    if (!next) {
      e.dataTransfer.dropEffect = 'none';
      if (hover) clearHover();
      return;
    }
    e.preventDefault();
    e.dataTransfer.dropEffect = kind === 'personnel' ? 'copy' : 'move';
    setHover((prev) => (sameHover(prev, next) ? prev : next));
    armExpand();
  };

  const handleDragLeave = (e: React.DragEvent<HTMLDivElement>) => {
    // Moving onto the card's own name/label also fires dragleave here.
    if (e.relatedTarget instanceof Node && e.currentTarget.contains(e.relatedTarget)) return;
    clearHover();
  };

  const handleDrop = (e: React.DragEvent<HTMLDivElement>) => {
    clearHover();
    const kind = dnd.editable ? dragKindOf(e.dataTransfer) : null;
    if (!kind) return;
    e.preventDefault();
    const st = useCrisisStore.getState();
    const inc = selectActive(st);
    const inFlight = dnd.current();
    const payload = (mime: string) =>
      e.dataTransfer.getData(mime) || (inFlight?.kind === kind ? inFlight.id : '');
    if (inc && kind === 'role') {
      const id = payload(ROLE_MIME);
      const zone = dropZoneAt(e.currentTarget.getBoundingClientRect(), e.clientX, e.clientY, isRoot);
      const target = roleDropTarget(inc.roles, id, role.id, zone);
      if (target) {
        moveAndAnnounce(id, target, dnd.announce);
        if (zone === 'child') onExpand(); // show where it landed
      }
    } else if (inc && kind === 'assignment') {
      const id = payload(ASSIGNMENT_MIME);
      const a = inc.assignments.find((x) => x.id === id && !x.endedAt);
      if (a && a.roleId !== role.id) {
        // assignRole ends their current assignment (one role per person) and
        // logs the handover, exactly as a pool drop would.
        assignAndAnnounce(role.id, a.name, { title: a.title, phone: a.phone, email: a.email }, a.personnelId, dnd.announce);
      }
    } else if (inc) {
      const memberId = payload(PERSONNEL_MIME);
      const member = (inc.personnel ?? []).find((p) => p.id === memberId);
      if (member) {
        assignAndAnnounce(role.id, member.name, { title: member.title, phone: member.phone, email: member.email }, member.id, dnd.announce);
      }
    }
    // The source may have unmounted mid-drag (a moved card re-renders under its
    // new parent; a reassigned name leaves this card), so its dragend can't be
    // relied on to reach React.
    dnd.end();
  };

  const handleRemove = (e: React.MouseEvent) => {
    e.stopPropagation();
    if (confirm(`Remove "${role.title}"?`) && removeRoleChecked(role.id)) onRemoved?.();
  };

  const handleKeyDown = (e: React.KeyboardEvent<HTMLDivElement>) => {
    if (e.target !== e.currentTarget) return;
    if (e.key === 'Enter' || e.key === ' ') {
      e.preventDefault();
      onSelect();
    }
  };

  const holder = role.isSupport ? undefined : activeAssignments[0];
  const ringed = hover?.kind === 'person' || (hover?.kind === 'role' && hover.zone === 'child');
  const edge = hover?.kind === 'role' && hover.zone !== 'child' ? hover.zone : null;

  let pill: string | null = null;
  if (hover?.kind === 'person') pill = holder ? `Replace ${holder.name}` : 'Drop to assign';
  else if (hover?.kind === 'role' && hover.zone === 'child') pill = `Make sub-role of ${role.title}`;
  else if (edge) pill = isRoot ? (edge === 'before' ? '▴ Move above' : '▾ Move below') : (edge === 'before' ? '◂ Move before' : 'Move after ▸');

  const names = activeAssignments.map((a) => a.name).join(', ');

  return (
    <div
      role="button"
      tabIndex={0}
      data-role-card={role.id}
      aria-pressed={selected}
      aria-label={`${role.title}${role.abbrev ? ` (${role.abbrev})` : ''}: ${names || 'unassigned'}`}
      draggable={dnd.editable}
      onDragStart={(e) => dnd.begin(e, { kind: 'role', id: role.id })}
      onDragEnd={dnd.end}
      onClick={onSelect}
      onKeyDown={handleKeyDown}
      onDragOver={handleDragOver}
      onDragLeave={handleDragLeave}
      onDrop={handleDrop}
      className={`group relative cursor-pointer rounded-md border bg-ink-900 text-center outline-none transition-all focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-accent/70 ${
        ringed ? 'ring-2 ring-inset ring-accent/80' : selected ? 'ring-1 ring-accent/50' : 'hover:border-white/20'
      } ${dimmed ? 'opacity-40' : ''}`}
      style={{
        minWidth: isRoot ? '190px' : '132px',
        borderColor: ringed ? 'rgba(61,220,255,0.5)' : selected ? 'rgba(99,179,237,0.5)' : `${role.color}70`,
      }}
    >
      {/* Drag grip — a hover hint that the card itself moves */}
      {dnd.editable && (
        <span
          aria-hidden
          className="pointer-events-none absolute left-1.5 top-2 select-none text-[9px] leading-none text-white/25 opacity-0 transition-opacity group-hover:opacity-100"
        >
          ⠿
        </span>
      )}

      {/* Remove button — on hover, for an empty LEAF role only: removing a
          branch (or the top of the structure) is a deliberate act in the edit
          panel, which spells out the sub-roles going with it. Mouse-only:
          keyboard users remove from the edit panel (no nested focus stops in
          a card). */}
      {isEmpty && !hasKids && !isRoot && dnd.editable && (
        <button
          type="button"
          tabIndex={-1}
          aria-hidden
          onClick={handleRemove}
          className="absolute -right-1.5 -top-1.5 z-10 flex h-4 w-4 items-center justify-center rounded-full border border-white/15 bg-ink-900 text-[8px] text-white/30 opacity-0 transition-opacity hover:border-red-500/40 hover:text-red-400/80 group-hover:opacity-100"
          title="Remove role"
        >
          ×
        </button>
      )}

      <div className="h-1 w-full rounded-t-md" style={{ background: role.color }} />
      <div className="px-2.5 py-2">
        {role.abbrev && (
          <p className="mb-0.5 text-[10px] font-bold uppercase tracking-[0.14em]" style={{ color: role.color }}>
            {role.abbrev}
          </p>
        )}
        <p className={`font-bold leading-tight text-white/95 ${isRoot ? 'text-[14px]' : 'text-[12px]'}`}>
          {role.title}
        </p>

        {role.isSupport ? (
          activeAssignments.length > 0 ? (
            <div className="mt-1 space-y-0.5">
              {activeAssignments.map((a) => (
                <p key={a.id} className="leading-tight">
                  <AssigneeName assignment={a} className="inline-block text-[11px] text-white/70" />
                </p>
              ))}
            </div>
          ) : (
            <p className="mt-1 text-[10px] text-white/30">Drop to assign</p>
          )
        ) : (
          <p className="mt-1 text-[11px] text-white/70">
            {holder ? <AssigneeName assignment={holder} className="inline-block" /> : '—'}
          </p>
        )}
      </div>

      {role.isSupport && (
        <div
          className="flex items-center justify-center pb-1 text-[9px] font-bold uppercase tracking-widest"
          style={{ color: role.color, opacity: 0.6 }}
        >
          support
        </div>
      )}

      {/* Drop indicators. Absolutely placed so showing them never shifts the
          layout under the pointer (which would flip the zone it's over). */}
      {edge && (
        <span
          aria-hidden
          className={`pointer-events-none absolute z-20 rounded-full bg-accent shadow-glow ${
            isRoot
              ? `inset-x-0 h-[3px] ${edge === 'before' ? '-top-[6px]' : '-bottom-[6px]'}`
              : `inset-y-0 w-[3px] ${edge === 'before' ? '-left-[6px]' : '-right-[6px]'}`
          }`}
        />
      )}
      {pill && (
        <span
          aria-hidden
          className={`pointer-events-none absolute left-1/2 z-20 -translate-x-1/2 whitespace-nowrap rounded bg-accent px-1.5 py-0.5 text-[9px] font-semibold text-ink-950 shadow-panel ${
            isRoot && edge === 'after' ? 'bottom-full mb-2' : 'top-full mt-2'
          }`}
        >
          {pill}
        </span>
      )}
    </div>
  );
}

// ── Recursive subtree ─────────────────────────────────────────────────────────

function RoleSubtree({
  roleId,
  selectedId,
  onSelect,
  onRemoved,
  depth = 0,
}: {
  roleId: string;
  selectedId: string | null;
  onSelect: (id: string) => void;
  onRemoved?: (id: string) => void;
  depth?: number;
}) {
  const { editable } = useContext(ChartDndContext);
  // Sections open collapsed to keep the chart compact — unless someone is
  // staffed inside, who must never be hidden by default (read once, at mount).
  const [kidsCollapsed, setKidsCollapsed] = useState(
    () => depth >= 1 && staffedBelow(selectActive(useCrisisStore.getState()), roleId) === 0
  );
  // While collapsed, how many people the branch hides (for the toggle label).
  const hiddenStaff = useCrisisStore((s) => (kidsCollapsed ? staffedBelow(selectActive(s), roleId) : 0));
  const [addingChild, setAddingChild] = useState(false);
  const role = useCrisisStore((s) => selectActive(s)?.roles.find((r) => r.id === roleId));
  // useShallow: moveRole keeps untouched roles identical, so unrelated edits
  // (typing in the summary, other rows reordering) don't re-render this row.
  const allChildren = useCrisisStore(useShallow((s) =>
    (selectActive(s)?.roles ?? []).filter((r) => r.parentId === roleId).sort((a, b) => a.order - b.order)
  ));
  // A role picked in the panel — or just moved there via "Reports to" — may
  // sit inside this collapsed subtree; open it so the selection stays visible.
  const holdsSelected = useCrisisStore((s) =>
    selectedId !== null && isAncestorOf(selectActive(s)?.roles ?? [], roleId, selectedId)
  );
  useEffect(() => {
    if (holdsSelected) setKidsCollapsed(false);
  }, [holdsSelected]);

  if (!role) return null;

  const commandKids = allChildren.filter((r) => r.isCommandStaff);
  const regularKids = allChildren.filter((r) => !r.isCommandStaff);
  const hasKids = commandKids.length + regularKids.length > 0;
  const showKids = depth === 0 || !kidsCollapsed;

  return (
    <div className="flex flex-col items-center">
      <NodeCard
        role={role}
        selected={role.id === selectedId}
        onSelect={() => onSelect(role.id)}
        onRemoved={() => onRemoved?.(role.id)}
        hasKids={hasKids}
        collapsedKids={!showKids && regularKids.length > 0}
        onExpand={() => setKidsCollapsed(false)}
      />

      {/* Command staff advisory section */}
      {commandKids.length > 0 && (
        <div className="flex w-full flex-col items-center">
          <Stem h={14} dashed />
          <div className="mb-1 flex w-full items-center gap-2 px-2">
            <div className="h-px flex-1" style={{ background: WIRE_DASH }} />
            <span className="shrink-0 text-[9px] font-bold uppercase tracking-[0.16em] text-white/45">
              Command Staff — Advisory
            </span>
            <div className="h-px flex-1" style={{ background: WIRE_DASH }} />
          </div>
          <ConnectorRow dashed>
            {commandKids.map((r) => (
              <RoleSubtree key={r.id} roleId={r.id} selectedId={selectedId} onSelect={onSelect} onRemoved={onRemoved} depth={depth + 1} />
            ))}
          </ConnectorRow>
        </div>
      )}

      {/* General Staff divider */}
      {commandKids.length > 0 && regularKids.length > 0 && (
        <div className="my-4 flex w-full items-center gap-3 px-1">
          <div className="h-px flex-1" style={{ background: WIRE }} />
          <span className="shrink-0 text-[10px] font-bold uppercase tracking-[0.16em] text-white/50">
            General Staff
          </span>
          <div className="h-px flex-1" style={{ background: WIRE }} />
        </div>
      )}

      {/* Collapse toggle */}
      {depth > 0 && hasKids && (
        <button
          type="button"
          aria-expanded={!kidsCollapsed}
          aria-label={`${kidsCollapsed ? 'Expand' : 'Collapse'} sub-roles of ${role.title}${
            kidsCollapsed && hiddenStaff ? ` (${people(hiddenStaff)} assigned)` : ''
          }`}
          onClick={(e) => { e.stopPropagation(); setKidsCollapsed((v) => !v); }}
          className="mt-2 flex items-center gap-1 rounded border border-white/10 bg-white/4 px-2 py-0.5 text-[10px] text-white/45 transition hover:border-white/20 hover:text-white/70"
        >
          <span aria-hidden style={{ color: role.color }}>{kidsCollapsed ? '▼' : '▲'}</span>
          {/* Command staff always shows, so only general staff is "hidden". */}
          {kidsCollapsed
            ? `Expand (${regularKids.length}${hiddenStaff ? ` · ${hiddenStaff} staffed` : ''})`
            : 'Collapse'}
        </button>
      )}

      {/* Regular staff */}
      {regularKids.length > 0 && showKids && (
        <>
          {commandKids.length === 0 && <Stem />}
          <ConnectorRow>
            {regularKids.map((r) => (
              <RoleSubtree key={r.id} roleId={r.id} selectedId={selectedId} onSelect={onSelect} onRemoved={onRemoved} depth={depth + 1} />
            ))}
          </ConnectorRow>
        </>
      )}

      {/* Inline add-child */}
      {editable && (depth === 0 || showKids) && (
        addingChild ? (
          <QuickAddForm parentId={roleId} parentColor={role.color} onDone={() => setAddingChild(false)} />
        ) : (
          <button
            type="button"
            aria-label={`Add sub-role under ${role.title}`}
            onClick={(e) => { e.stopPropagation(); setAddingChild(true); }}
            className="mt-2 flex items-center gap-0.5 rounded border border-white/8 px-2 py-0.5 text-[8px] text-white/22 transition hover:border-white/16 hover:text-white/50"
          >
            <span style={{ color: role.color }}>+</span> sub-role
          </button>
        )
      )}
    </div>
  );
}

// ── Personnel Pool ────────────────────────────────────────────────────────────

function PersonnelPool() {
  const dnd = useContext(ChartDndContext);
  const personnel = useCrisisStore((s) => selectActive(s)?.personnel ?? NO_PERSONNEL);
  const assignments = useCrisisStore((s) => selectActive(s)?.assignments ?? NO_ASSIGNMENTS);
  const roles = useCrisisStore((s) => selectActive(s)?.roles ?? DEFAULT_ROLES);
  const addPersonnelMember = useCrisisStore((s) => s.addPersonnelMember);
  const removePersonnelMember = useCrisisStore((s) => s.removePersonnelMember);

  const [adding, setAdding] = useState(false);
  const [nameInput, setNameInput] = useState('');
  const [titleInput, setTitleInput] = useState('');
  const [phoneInput, setPhoneInput] = useState('');
  const [emailInput, setEmailInput] = useState('');
  const nameRef = useRef<HTMLInputElement>(null);
  const toggleRef = useRef<HTMLButtonElement>(null);

  // Who's already seated, so operators can see who's free before dragging
  // (seating someone moves them out of their current role).
  const seatOf = useMemo(() => {
    const m = new Map<string, IcsRole>();
    for (const p of personnel) {
      const role = activeRoleOf({ roles, assignments }, p.name, p.id);
      if (role) m.set(p.id, role);
    }
    return m;
  }, [personnel, roles, assignments]);

  useEffect(() => {
    if (adding) nameRef.current?.focus();
  }, [adding]);

  // Esc cancels just the form. Left to reach the overlay's window listener it
  // would take a different step instead (open layer → leave the field →
  // incident to list → close; see escapeLayers.ts).
  const handleFormKeyDown = (e: React.KeyboardEvent) => {
    if (e.key !== 'Escape') return;
    e.stopPropagation();
    setAdding(false);
    toggleRef.current?.focus();
  };

  const handleAdd = () => {
    const n = nameInput.trim();
    if (!n) return;
    addPersonnelMember(n, {
      title: titleInput.trim() || undefined,
      phone: phoneInput.trim() || undefined,
      email: emailInput.trim() || undefined,
    });
    setNameInput('');
    setTitleInput('');
    setPhoneInput('');
    setEmailInput('');
  };

  return (
    <div className="border-t border-white/8 pt-4">
      <div className="mb-2 flex items-center justify-between">
        <div className="flex items-center gap-2">
          <span className="text-[9px] font-bold uppercase tracking-wider text-white/35">Personnel Pool</span>
          {personnel.length > 0 && (
            <span className="rounded bg-white/6 px-1.5 py-0.5 text-[8px] text-white/30">{personnel.length}</span>
          )}
        </div>
        <button
          ref={toggleRef}
          aria-expanded={adding}
          onClick={() => setAdding((v) => !v)}
          className="text-[10px] text-white/30 transition hover:text-white/60"
        >
          {adding ? '✕ Cancel' : '+ Add person'}
        </button>
      </div>

      {adding && (
        <div onKeyDown={handleFormKeyDown} className="mb-3 space-y-2 rounded-lg border border-white/8 bg-white/3 p-2.5">
          <div className="flex flex-wrap gap-2">
            <input
              ref={nameRef}
              aria-label="Full name"
              className="min-w-[120px] flex-1 rounded border border-white/8 bg-white/8 px-2 py-1.5 text-[11px] text-white/80 outline-none placeholder-white/20 focus:border-white/20"
              placeholder="Full name"
              value={nameInput}
              onChange={(e) => setNameInput(e.target.value)}
              onKeyDown={(e) => e.key === 'Enter' && handleAdd()}
            />
            <input
              aria-label="Title or rank (optional)"
              className="min-w-[120px] flex-1 rounded border border-white/8 bg-white/8 px-2 py-1.5 text-[11px] text-white/80 outline-none placeholder-white/20 focus:border-white/20"
              placeholder="Title / rank (optional)"
              value={titleInput}
              onChange={(e) => setTitleInput(e.target.value)}
              onKeyDown={(e) => e.key === 'Enter' && handleAdd()}
            />
          </div>
          <div className="flex flex-wrap items-center gap-2">
            <span className="shrink-0 text-[8px] font-bold uppercase tracking-wider text-white/25">Contact</span>
            <input
              type="tel"
              aria-label="Phone"
              className="min-w-[110px] flex-1 rounded border border-white/8 bg-white/8 px-2 py-1.5 text-[11px] text-white/80 outline-none placeholder-white/20 focus:border-white/20"
              placeholder="Phone"
              value={phoneInput}
              onChange={(e) => setPhoneInput(e.target.value)}
              onKeyDown={(e) => e.key === 'Enter' && handleAdd()}
            />
            <input
              type="email"
              aria-label="Email"
              className="min-w-[110px] flex-1 rounded border border-white/8 bg-white/8 px-2 py-1.5 text-[11px] text-white/80 outline-none placeholder-white/20 focus:border-white/20"
              placeholder="Email"
              value={emailInput}
              onChange={(e) => setEmailInput(e.target.value)}
              onKeyDown={(e) => e.key === 'Enter' && handleAdd()}
            />
          </div>
          <button
            onClick={handleAdd}
            disabled={!nameInput.trim()}
            className="w-full rounded bg-accent/15 py-1 text-[10px] text-accent transition hover:bg-accent/25 disabled:opacity-30"
          >
            Add to pool
          </button>
        </div>
      )}

      {personnel.length === 0 && !adding ? (
        <p className="text-[10px] text-white/20">
          Add people here, then drag them onto roles above — or pick them in a role's panel — to assign.
        </p>
      ) : (
        <div className="flex flex-wrap gap-1.5">
          {personnel.map((member) => {
            const seat = seatOf.get(member.id);
            const dragging = dnd.drag?.kind === 'personnel' && dnd.drag.id === member.id;
            return (
              <div
                key={member.id}
                draggable={dnd.editable}
                onDragStart={(e) => dnd.begin(e, { kind: 'personnel', id: member.id })}
                onDragEnd={dnd.end}
                title={seat ? `Assigned as ${seat.title}` : undefined}
                className={`group flex items-center gap-1.5 rounded border border-white/10 bg-white/5 px-2 py-1 text-[10px] text-white/60 transition hover:border-white/18 ${
                  dnd.editable ? 'cursor-grab active:cursor-grabbing' : ''
                } ${dragging ? 'opacity-40' : seat ? 'opacity-60 hover:opacity-100' : ''}`}
              >
                <span aria-hidden className="text-white/25 select-none">⠿</span>
                <span>{member.name}</span>
                {member.title && (
                  <span className="text-white/30">· {member.title}</span>
                )}
                {seat && (
                  <span className="font-bold" style={{ color: seat.color }}>
                    <span aria-hidden>· {seat.abbrev || seat.title}</span>
                    <span className="sr-only">, assigned as {seat.title}</span>
                  </span>
                )}
                {member.phone && <span className="text-white/25" title={member.phone}>☎</span>}
                {member.email && <span className="text-white/25" title={member.email}>✉</span>}
                <button
                  onClick={() => removePersonnelMember(member.id)}
                  aria-label={`Remove ${member.name} from pool`}
                  className="ml-0.5 text-white/15 opacity-0 transition hover:text-red-400/70 focus-visible:opacity-100 group-hover:opacity-100 [@media(hover:none)]:opacity-100"
                  title="Remove from pool"
                >
                  ×
                </button>
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}

// ── Edit panel ────────────────────────────────────────────────────────────────

// Where the role sits — the keyboard/touch counterpart of dragging its card.
function PositionControls({ role }: { role: IcsRole }) {
  const { announce } = useContext(ChartDndContext);
  const roles = useCrisisStore((s) => selectActive(s)?.roles ?? []);

  // Everything except the role's own subtree (it can't report to itself or
  // below itself), in chart order and indented by depth.
  const parentOptions = useMemo(() => {
    const own = roleSubtreeIds(roles, role.id);
    return chartOrder(roles).filter(({ role: r }) => !own.has(r.id));
  }, [roles, role.id]);

  const row = roleSiblings(roles, role.parentId, !!role.isCommandStaff);
  const index = row.findIndex((r) => r.id === role.id);
  const parent = role.parentId === null ? null : roles.find((r) => r.id === role.parentId) ?? null;
  // Command staff advises the top of the structure. The toggle also shows for
  // a role already flagged elsewhere, so it can always be cleared.
  const showCmd = (parent !== null && parent.parentId === null) || !!role.isCommandStaff;
  const rowLabel = role.parentId === null ? 'top-level roles' : role.isCommandStaff ? 'command staff' : 'general staff';
  const move = (target: MoveRoleTarget) => moveAndAnnounce(role.id, target, announce);
  const inRow = { parentId: role.parentId, isCommandStaff: !!role.isCommandStaff };

  return (
    <div className="space-y-2">
      <p className="text-[9px] uppercase tracking-wider text-white/35">Position</p>
      <label className="block">
        <span className="mb-1 block text-[10px] text-white/45">Reports to</span>
        <select
          className="w-full rounded border border-white/10 bg-ink-900 px-2 py-1 text-[11px] text-white/80 outline-none transition focus:border-white/25"
          value={role.parentId ?? ''}
          onChange={(e) => move({ parentId: e.target.value || null })}
        >
          <option value="">— top level —</option>
          {parentOptions.map(({ role: r, depth }) => (
            <option key={r.id} value={r.id}>
              {`${'\u00a0\u00a0\u00a0'.repeat(depth)}${r.title}${r.abbrev ? ` (${r.abbrev})` : ''}`}
            </option>
          ))}
        </select>
      </label>
      <div className="flex gap-1.5">
        <button
          type="button"
          disabled={index <= 0}
          onClick={() => move({ ...inRow, beforeRoleId: row[index - 1].id })}
          className="flex-1 rounded border border-white/10 py-1 text-[10px] text-white/50 transition hover:border-white/20 hover:text-white/75 disabled:opacity-30 disabled:hover:border-white/10 disabled:hover:text-white/50"
        >
          Move earlier
        </button>
        <button
          type="button"
          disabled={index < 0 || index >= row.length - 1}
          onClick={() => move({ ...inRow, beforeRoleId: row[index + 2]?.id ?? null })}
          className="flex-1 rounded border border-white/10 py-1 text-[10px] text-white/50 transition hover:border-white/20 hover:text-white/75 disabled:opacity-30 disabled:hover:border-white/10 disabled:hover:text-white/50"
        >
          Move later
        </button>
      </div>
      {index >= 0 && (
        <p className="text-[9px] text-white/30">
          {index + 1} of {row.length} {rowLabel}{parent ? ` under ${parent.abbrev || parent.title}` : ''}
        </p>
      )}
      {showCmd && (
        <label className="flex cursor-pointer items-center gap-2 text-[10px] text-white/40 hover:text-white/60">
          <input
            type="checkbox"
            checked={!!role.isCommandStaff}
            onChange={(e) => move({ parentId: role.parentId, isCommandStaff: e.target.checked })}
            className="accent-accent"
          />
          <span>Command staff <span className="text-white/25">(advisory)</span></span>
        </label>
      )}
    </div>
  );
}

function EditPanel({ roleId, onClose, docked }: {
  roleId: string;
  onClose: () => void;
  /** Beside the chart (wide layout) rather than stacked below it. */
  docked: boolean;
}) {
  const { announce } = useContext(ChartDndContext);
  const role = useCrisisStore((s) => selectActive(s)?.roles.find((r) => r.id === roleId));
  const assignments = useCrisisStore(useShallow((s) =>
    (selectActive(s)?.assignments ?? []).filter((a) => a.roleId === roleId).sort(
      (a, b) => new Date(b.startedAt).getTime() - new Date(a.startedAt).getTime()
    )
  ));
  const roles = useCrisisStore((s) => selectActive(s)?.roles ?? DEFAULT_ROLES);
  const allAssignments = useCrisisStore((s) => selectActive(s)?.assignments ?? NO_ASSIGNMENTS);
  const personnel = useCrisisStore((s) => selectActive(s)?.personnel ?? NO_PERSONNEL);
  const updateRole    = useCrisisStore((s) => s.updateRole);
  const endAssignment = useCrisisStore((s) => s.endAssignment);
  const addRole       = useCrisisStore((s) => s.addRole);
  const panelRef = useRef<HTMLDivElement>(null);
  const poolListId = useId();

  const [nameInput, setNameInput] = useState('');
  const [titleInput, setTitleInput] = useState('');
  const [phoneInput, setPhoneInput] = useState('');
  const [emailInput, setEmailInput] = useState('');
  const [addingChild, setAddingChild] = useState(false);
  const [childTitle, setChildTitle] = useState('');
  const [childAbbrev, setChildAbbrev] = useState('');
  const [childColor, setChildColor] = useState(OPS_COLOR);
  const [childIsCmd, setChildIsCmd] = useState(false);
  const [childIsSupport, setChildIsSupport] = useState(false);

  const activeAssignments = assignments.filter((a) => !a.endedAt);
  const activeAssignment = activeAssignments[0];

  // A fresh, EMPTY form per role. Pre-filling the current holder made
  // "Reassign" a one-click duplicate of them; they're shown above the form
  // with their own End button, and typing their name updates their details.
  useEffect(() => {
    setNameInput('');
    setTitleInput('');
    setPhoneInput('');
    setEmailInput('');
    setAddingChild(false);
  }, [roleId]);

  // Take keyboard focus to the panel (not an input: that would pop the
  // on-screen keyboard over it on phones). Stacked below the often tall chart,
  // a tap on a card would otherwise open it out of sight.
  useEffect(() => {
    const el = panelRef.current;
    if (!el) return;
    if (!docked) el.scrollIntoView({ block: 'nearest', behavior: 'smooth' });
    el.focus({ preventScroll: true });
  }, [roleId]);

  if (!role) return null;

  // Pool members not already in this role — the tap/keyboard way to assign.
  const poolChoices = personnel.filter((m) => !activeAssignments.some((a) => isSamePerson(a, m.name, m.id)));
  const typed = nameInput.trim();
  const typedMember = poolMemberNamed(personnel, typed);
  const typedIsHolder = !!typed && activeAssignments.some((a) => isSamePerson(a, typed, typedMember?.id));

  // Removing takes the whole branch, so anyone assigned anywhere in it blocks
  // it (the store refuses too) — nobody is silently un-staffed.
  const branchStaff = activeAssignmentsInSubtree(roles, allAssignments, roleId);
  const subRoleCount = roleSubtreeIds(roles, roleId).size - 1;
  const staffList = branchStaff
    .map((a) => {
      if (a.roleId === roleId) return a.name;
      const r = roles.find((x) => x.id === a.roleId);
      return `${a.name} (${r?.abbrev || r?.title || 'sub-role'})`;
    })
    .join(', ');
  const removeHintId = `${poolListId}-remove`;

  const handleKeyDown = (e: React.KeyboardEvent) => {
    // Esc backs out of the sub-role form if that's open, else the panel.
    // Claimed here so the overlay's window listener doesn't take its own step
    // (open layer → leave the field → incident to list → close; see
    // escapeLayers.ts). With focus outside the panel, the chart's Esc layer
    // closes it instead.
    if (e.key !== 'Escape') return;
    e.stopPropagation();
    if (addingChild) setAddingChild(false);
    else onClose();
  };

  const fmt = (iso: string) => {
    try { return new Date(iso).toLocaleString(undefined, { month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit' }); }
    catch { return iso; }
  };

  const handleAssign = () => {
    if (!typed) return;
    // A name that is someone in the pool IS that person: link them (so the
    // AAR counts one person, not two) and fill any blank details from the pool.
    const ok = assignAndAnnounce(roleId, typedMember?.name ?? typed, {
      title: titleInput.trim() || typedMember?.title || undefined,
      phone: phoneInput.trim() || typedMember?.phone || undefined,
      email: emailInput.trim() || typedMember?.email || undefined,
    }, typedMember?.id, announce);
    if (!ok) return;
    setNameInput('');
    setTitleInput('');
    setPhoneInput('');
    setEmailInput('');
  };

  const handleRemove = () => {
    const what = subRoleCount > 0
      ? `"${role.title}" and its ${subRoleCount} sub-role${subRoleCount === 1 ? '' : 's'}`
      : `"${role.title}"`;
    if (!confirm(`Remove ${what}? Past assignments stay in the AAR record.`)) return;
    if (removeRoleChecked(roleId)) onClose();
  };

  const handleAddChild = () => {
    const t = childTitle.trim();
    if (!t) return;
    const childCount = roles.filter((r) => r.parentId === roleId && r.isCommandStaff === childIsCmd).length;
    addRole({
      title: t,
      abbrev: childAbbrev.trim() || undefined,
      parentId: roleId,
      color: childColor,
      isCommandStaff: childIsCmd,
      isSupport: childIsSupport,
      order: childCount,
    });
    setChildTitle('');
    setChildAbbrev('');
    setChildIsSupport(false);
    setAddingChild(false);
  };

  return (
    <div
      ref={panelRef}
      role="region"
      tabIndex={-1}
      aria-label={`Edit role: ${role.title}`}
      onKeyDown={handleKeyDown}
      className={`space-y-4 rounded-lg border border-white/10 bg-ink-900/90 p-4 text-[11px] outline-none focus-visible:ring-1 focus-visible:ring-accent/40 ${
        // Docked: pinned in view while the chart scrolls (a deep role's
        // panel would otherwise sit at the top, scrolled away).
        docked ? 'sticky top-2 max-h-[calc(100vh-10rem)] w-64 shrink-0 overflow-y-auto' : 'w-full'
      }`}
    >
      {/* Header */}
      <div className="flex items-center justify-between">
        <h4 className="text-[10px] font-bold uppercase tracking-widest text-white/40">Role</h4>
        <button onClick={onClose} aria-label="Close role editor" className="text-white/25 transition hover:text-white/60">✕</button>
      </div>

      {/* Title + abbrev */}
      <div className="space-y-1.5">
        <input
          aria-label="Role title"
          className="w-full rounded border border-white/8 bg-white/10 px-2 py-1 text-[12px] text-white/80 outline-none focus:border-white/20 disabled:opacity-50"
          value={role.title}
          disabled={role.builtin}
          onChange={(e) => updateRole(roleId, { title: e.target.value })}
          placeholder="Role title"
        />
        <input
          aria-label="Abbreviation"
          className="w-full rounded border border-white/8 bg-white/10 px-2 py-1 text-[10px] text-white/60 outline-none focus:border-white/20 disabled:opacity-50"
          value={role.abbrev ?? ''}
          disabled={role.builtin}
          onChange={(e) => updateRole(roleId, { abbrev: e.target.value || undefined })}
          placeholder="Abbreviation (optional)"
        />
        {role.builtin && (
          <p className="text-[9px] text-white/25">Standard NIMS role — title locked</p>
        )}
      </div>

      <PositionControls role={role} />

      {/* Support role toggle */}
      <label className="flex cursor-pointer items-center gap-2 text-[10px] text-white/40 hover:text-white/60">
        <input
          type="checkbox"
          checked={role.isSupport}
          onChange={(e) => updateRole(roleId, { isSupport: e.target.checked })}
          className="accent-accent"
        />
        <span>Support role <span className="text-white/25">(multiple concurrent assignments)</span></span>
      </label>

      {/* Color */}
      <div>
        <p className="mb-1.5 text-[9px] uppercase tracking-wider text-white/35">Color</p>
        <div className="flex flex-wrap gap-1.5">
          {PRESET_COLORS.map((c) => (
            <button
              key={c}
              type="button"
              aria-label={`Color ${c}`}
              aria-pressed={role.color === c}
              onClick={() => updateRole(roleId, { color: c })}
              className="h-5 w-5 rounded-full border-2 transition"
              style={{ background: c, borderColor: role.color === c ? 'white' : 'transparent' }}
            />
          ))}
        </div>
      </div>

      {/* Active assignments */}
      {role.isSupport && activeAssignments.length > 0 && (
        <div>
          <p className="mb-1.5 text-[9px] uppercase tracking-wider text-white/35">Currently Assigned</p>
          <div className="space-y-1">
            {activeAssignments.map((a) => (
              <div key={a.id} className="flex items-start justify-between gap-2 rounded border border-white/8 bg-white/8 px-2 py-1.5">
                <div className="min-w-0">
                  <p className="text-[11px] text-white/80">{a.name}</p>
                  <ContactLines title={a.title} phone={a.phone} email={a.email} />
                </div>
                <button onClick={() => endAssignment(a.id)} className="shrink-0 text-[9px] text-red-400/60 hover:text-red-400">End</button>
              </div>
            ))}
          </div>
        </div>
      )}

      {/* Assign personnel */}
      <div>
        <p className="mb-1.5 text-[9px] uppercase tracking-wider text-white/35">
          {role.isSupport ? 'Add Personnel' : activeAssignment ? 'Reassign' : 'Assign Personnel'}
        </p>
        {!role.isSupport && activeAssignment && (
          <div className="mb-2 flex items-start justify-between gap-2 rounded border border-white/8 bg-white/10 px-2 py-1.5">
            <div className="min-w-0">
              <p className="text-[11px] text-white/80">{activeAssignment.name}</p>
              <ContactLines title={activeAssignment.title} phone={activeAssignment.phone} email={activeAssignment.email} />
            </div>
            <button onClick={() => endAssignment(activeAssignment.id)} className="shrink-0 text-[9px] text-red-400/60 hover:text-red-400">End</button>
          </div>
        )}
        {/* From the pool — a tap or keypress, for phones and keyboards that
            can't drag chips onto cards. A person seated elsewhere moves. */}
        {poolChoices.length > 0 && (
          <div className="mb-2">
            <p className="mb-1 text-[9px] text-white/35">From personnel pool</p>
            <div className="flex max-h-32 flex-wrap gap-1 overflow-y-auto">
              {poolChoices.map((m) => {
                const seat = activeRoleOf({ roles, assignments: allAssignments }, m.name, m.id);
                return (
                  <button
                    key={m.id}
                    type="button"
                    onClick={() => assignAndAnnounce(roleId, m.name, { title: m.title, phone: m.phone, email: m.email }, m.id, announce)}
                    aria-label={`Assign ${m.name} as ${role.title}${seat ? ` (moves them from ${seat.title})` : ''}`}
                    title={seat ? `Now ${seat.title} — assigning moves them` : m.title}
                    className={`rounded border border-white/10 bg-white/5 px-1.5 py-0.5 text-[10px] transition hover:border-accent/40 hover:text-white/90 ${
                      seat ? 'text-white/45' : 'text-white/70'
                    }`}
                  >
                    {m.name}
                    {seat && (
                      <span aria-hidden className="ml-1 font-bold" style={{ color: seat.color }}>
                        · {seat.abbrev || seat.title}
                      </span>
                    )}
                  </button>
                );
              })}
            </div>
            <p className="mt-1.5 text-[9px] text-white/25">or type a name:</p>
          </div>
        )}
        <input
          aria-label="Full name"
          list={personnel.length > 0 ? poolListId : undefined}
          autoComplete="off"
          className="mb-1 w-full rounded border border-white/8 bg-white/10 px-2 py-1 text-[11px] text-white/80 outline-none placeholder-white/20 focus:border-white/20"
          placeholder="Full name"
          value={nameInput}
          onChange={(e) => setNameInput(e.target.value)}
          onKeyDown={(e) => e.key === 'Enter' && handleAssign()}
        />
        {personnel.length > 0 && (
          <datalist id={poolListId}>
            {personnel.map((m) => <option key={m.id} value={m.name} />)}
          </datalist>
        )}
        <input
          aria-label="Title or rank (optional)"
          className="mb-1 w-full rounded border border-white/8 bg-white/10 px-2 py-1 text-[11px] text-white/80 outline-none placeholder-white/20 focus:border-white/20"
          placeholder="Title / rank (optional)"
          value={titleInput}
          onChange={(e) => setTitleInput(e.target.value)}
          onKeyDown={(e) => e.key === 'Enter' && handleAssign()}
        />
        <input
          type="tel"
          aria-label="Phone (optional)"
          className="mb-1 w-full rounded border border-white/8 bg-white/10 px-2 py-1 text-[11px] text-white/80 outline-none placeholder-white/20 focus:border-white/20"
          placeholder="Phone (optional)"
          value={phoneInput}
          onChange={(e) => setPhoneInput(e.target.value)}
          onKeyDown={(e) => e.key === 'Enter' && handleAssign()}
        />
        <input
          type="email"
          aria-label="Email (optional)"
          className="mb-2 w-full rounded border border-white/8 bg-white/10 px-2 py-1 text-[11px] text-white/80 outline-none placeholder-white/20 focus:border-white/20"
          placeholder="Email (optional)"
          value={emailInput}
          onChange={(e) => setEmailInput(e.target.value)}
          onKeyDown={(e) => e.key === 'Enter' && handleAssign()}
        />
        <button
          onClick={handleAssign}
          disabled={!typed}
          className="w-full rounded bg-accent/15 py-1 text-[10px] text-accent transition hover:bg-accent/25 disabled:opacity-30"
        >
          {typedIsHolder ? 'Update details' : role.isSupport ? 'Add to Role' : activeAssignment ? 'Reassign' : 'Assign'}
        </button>
      </div>

      {/* Assignment history */}
      {assignments.filter((a) => a.endedAt).length > 0 && (
        <div>
          <p className="mb-1.5 text-[9px] uppercase tracking-wider text-white/35">History</p>
          <div className="max-h-28 space-y-1 overflow-y-auto">
            {assignments.filter((a) => a.endedAt).map((a) => (
              <div key={a.id} className="rounded border border-white/6 bg-white/3 px-2 py-1">
                <p className="text-[10px] text-white/55">{a.name}</p>
                <p className="text-[8px] text-white/25">
                  {fmt(a.startedAt)} → {a.endedAt ? fmt(a.endedAt) : 'active'}
                </p>
              </div>
            ))}
          </div>
        </div>
      )}

      {/* Add child role */}
      <div>
        {!addingChild ? (
          <button
            onClick={() => setAddingChild(true)}
            className="w-full rounded border border-white/10 py-1 text-[10px] text-white/35 transition hover:border-white/20 hover:text-white/55"
          >
            + Add sub-role
          </button>
        ) : (
          <div className="space-y-1.5 rounded border border-white/10 bg-white/3 p-2">
            <p className="text-[9px] font-bold uppercase tracking-wider text-white/35">New Sub-role</p>
            <input
              aria-label="Sub-role title"
              className="w-full rounded border border-white/8 bg-white/10 px-2 py-1 text-[11px] text-white/80 outline-none placeholder-white/20 focus:border-white/20"
              placeholder="Title"
              value={childTitle}
              onChange={(e) => setChildTitle(e.target.value)}
            />
            <input
              aria-label="Sub-role abbreviation"
              className="w-full rounded border border-white/8 bg-white/10 px-2 py-1 text-[11px] text-white/80 outline-none placeholder-white/20 focus:border-white/20"
              placeholder="Abbreviation"
              value={childAbbrev}
              onChange={(e) => setChildAbbrev(e.target.value)}
            />
            <div className="flex flex-wrap gap-1">
              {PRESET_COLORS.map((c) => (
                <button
                  key={c}
                  type="button"
                  aria-label={`Color ${c}`}
                  aria-pressed={childColor === c}
                  onClick={() => setChildColor(c)}
                  className="h-4 w-4 rounded-full border-2 transition"
                  style={{ background: c, borderColor: childColor === c ? 'white' : 'transparent' }}
                />
              ))}
            </div>
            <label className="flex items-center gap-1.5 text-[10px] text-white/40">
              <input type="checkbox" checked={childIsCmd} onChange={(e) => setChildIsCmd(e.target.checked)} />
              Advisory (command staff)
            </label>
            <label className="flex items-center gap-1.5 text-[10px] text-white/40">
              <input type="checkbox" checked={childIsSupport} onChange={(e) => setChildIsSupport(e.target.checked)} />
              Support role (multiple people)
            </label>
            <div className="flex gap-1.5">
              <button onClick={handleAddChild} className="flex-1 rounded bg-accent/15 py-1 text-[10px] text-accent hover:bg-accent/25">
                Add
              </button>
              <button onClick={() => setAddingChild(false)} className="flex-1 rounded border border-white/10 py-1 text-[10px] text-white/35 hover:text-white/55">
                Cancel
              </button>
            </div>
          </div>
        )}
      </div>

      {/* Remove role (and its branch) — only once nobody in it is assigned */}
      <div>
        <button
          type="button"
          onClick={handleRemove}
          disabled={branchStaff.length > 0}
          aria-describedby={branchStaff.length > 0 ? removeHintId : undefined}
          className="w-full rounded border border-red-500/20 py-1 text-[10px] text-red-400/50 transition hover:border-red-500/40 hover:text-red-400 disabled:cursor-not-allowed disabled:opacity-40 disabled:hover:border-red-500/20 disabled:hover:text-red-400/50"
        >
          {subRoleCount > 0 ? `Remove role + ${subRoleCount} sub-role${subRoleCount === 1 ? '' : 's'}` : 'Remove role'}
        </button>
        {branchStaff.length > 0 && (
          <p id={removeHintId} className="mt-1 text-[9px] text-white/35">
            {branchStaff.length === 1
              ? `To remove it, first release ${staffList}.`
              : `To remove it, first release the ${people(branchStaff.length)} assigned in this branch: ${staffList}.`}
          </p>
        )}
      </div>
    </div>
  );
}

// ── Main export ───────────────────────────────────────────────────────────────

function RestoreSection() {
  const currentRoles = useCrisisStore((s) => selectActive(s)?.roles ?? []);
  const restoreBuiltinRole = useCrisisStore((s) => s.restoreBuiltinRole);
  const [open, setOpen] = useState(false);

  const currentIds = new Set(currentRoles.map((r) => r.id));
  const deleted = DEFAULT_ROLES.filter((r) => !currentIds.has(r.id));

  if (deleted.length === 0) return null;

  return (
    <div className="mt-3 border-t border-white/6 pt-3">
      <button
        onClick={() => setOpen((v) => !v)}
        aria-expanded={open}
        className="flex items-center gap-1.5 text-[9px] text-white/25 transition hover:text-white/50"
      >
        <span aria-hidden>{open ? '▲' : '▼'}</span>
        Restore removed roles ({deleted.length})
      </button>
      {open && (
        <div className="mt-2 flex flex-wrap gap-1.5">
          {deleted.map((r) => (
            <button
              key={r.id}
              onClick={() => restoreBuiltinRole(r.id)}
              className="flex items-center gap-1 rounded border border-white/10 bg-white/4 px-2 py-1 text-[9px] text-white/40 transition hover:border-white/20 hover:text-white/70"
            >
              <span className="h-1.5 w-1.5 rounded-full" style={{ background: r.color }} />
              {r.title}
            </button>
          ))}
        </div>
      )}
    </div>
  );
}

// Back to the standard structure — reachable even with every role removed
// (it used to live in the role panel, which needs a role to open). Custom
// roles go, so anyone still seated in one blocks it, like removing a role.
function ResetRolesButton({ onReset }: { onReset: () => void }) {
  const handleReset = () => {
    const inc = selectActive(useCrisisStore.getState());
    if (!inc) return;
    const builtin = new Set(DEFAULT_ROLES.map((r) => r.id));
    const stranded = inc.assignments.filter((a) => !a.endedAt && !builtin.has(a.roleId));
    if (stranded.length > 0) {
      alert(
        `Resetting removes custom roles. First release the ${people(stranded.length)} assigned to them: ` +
        stranded.map((a) => `${a.name} (${assignmentRoleTitle(inc, a.roleId) ?? 'removed role'})`).join(', ') + '.'
      );
      return;
    }
    if (!confirm(
      'Reset the org chart to the standard ICS/NIMS structure? Custom roles are removed and standard roles ' +
      'return to their default places. People in standard roles stay assigned; past assignments stay in the AAR record.'
    )) return;
    useCrisisStore.getState().resetRoles();
    onReset();
  };
  return (
    <button
      type="button"
      onClick={handleReset}
      className="rounded px-2 py-1 text-[9px] text-white/20 transition hover:text-white/45"
    >
      Reset to defaults
    </button>
  );
}

// People still assigned to a role that is no longer on the chart — a peer
// removed it as they were seated, or an older client's reset dropped it.
// Invisible on the chart yet still counted as staff, so list them here to be
// released. Normally empty: removing a staffed role is refused.
function UnplacedAssignments() {
  const roles = useCrisisStore((s) => selectActive(s)?.roles ?? DEFAULT_ROLES);
  const assignments = useCrisisStore((s) => selectActive(s)?.assignments ?? NO_ASSIGNMENTS);
  const endAssignment = useCrisisStore((s) => s.endAssignment);
  const unplaced = assignments.filter((a) => !a.endedAt && !roles.some((r) => r.id === a.roleId));
  if (unplaced.length === 0) return null;
  const inc = selectActive(useCrisisStore.getState());
  return (
    <div className="mt-3 w-full max-w-md rounded border border-amber-400/25 bg-amber-400/5 p-2.5 text-left">
      <p className="text-[10px] font-semibold text-amber-200/80">
        Assigned to removed roles ({unplaced.length})
      </p>
      <ul className="mt-1.5 space-y-1">
        {unplaced.map((a) => (
          <li key={a.id} className="flex items-center justify-between gap-2 text-[10px] text-white/65">
            <span className="min-w-0 truncate">
              {a.name} <span className="text-white/35">· {(inc && assignmentRoleTitle(inc, a.roleId)) ?? 'removed role'}</span>
            </span>
            <button
              type="button"
              onClick={() => endAssignment(a.id)}
              className="shrink-0 text-[9px] text-red-400/60 hover:text-red-400"
            >
              Release
            </button>
          </li>
        ))}
      </ul>
    </div>
  );
}

// Below this width the role panel stacks under the chart instead of beside
// it: a 256px panel would squeeze the chart to a sliver. Measured, not a
// viewport breakpoint — the live-map dock takes up to half the screen.
const PANEL_BESIDE_MIN_PX = 640;

export function IcsOrgChart() {
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [addingRoot, setAddingRoot] = useState(false);
  const scrollRef = useRef<HTMLDivElement>(null);
  const layoutRef = useRef<HTMLDivElement>(null);
  const [docked, setDocked] = useState(false);
  const rootRoles = useCrisisStore(useShallow((s) =>
    (selectActive(s)?.roles ?? []).filter((r) => r.parentId === null).sort((a, b) => a.order - b.order)
  ));
  // Stood-down incidents are frozen (the store no-ops edits); the fieldset
  // around the chart disables its controls, and this switches off DnD.
  const editable = useCrisisStore((s) => {
    const inc = selectActive(s);
    return !!inc && !inc.archivedAt;
  });

  // ── Drag state ──
  const [drag, setDrag] = useState<ChartDrag | null>(null);
  const dragRef = useRef<ChartDrag | null>(null);
  const [announcement, setAnnouncement] = useState('');

  const begin = useCallback((e: React.DragEvent, item: ChartDrag) => {
    e.dataTransfer.setData(DRAG_MIME[item.kind], item.id);
    e.dataTransfer.effectAllowed = item.kind === 'personnel' ? 'copy' : 'move';
    dragRef.current = item;
    // Re-render on the next tick: restyling the source inside dragstart can
    // make Chromium snapshot the dimmed card as the drag image, or abort the
    // drag outright.
    window.setTimeout(() => {
      if (dragRef.current === item) setDrag(item);
    }, 0);
  }, []);
  const end = useCallback(() => {
    dragRef.current = null;
    setDrag(null);
  }, []);
  const current = useCallback(() => dragRef.current, []);
  // A repeated message wouldn't re-announce; a trailing NBSP makes it new.
  const announce = useCallback((m: string) => setAnnouncement((prev) => (prev === m ? `${m}\u00a0` : m)), []);

  // Safety net for a drag whose source unmounted mid-flight (a peer's live
  // update moved or removed that role): its dragend never reaches React, and
  // the chart would stay dimmed. Any drop, dragend or next press clears it.
  useEffect(() => {
    if (!drag) return;
    window.addEventListener('drop', end);
    window.addEventListener('dragend', end);
    window.addEventListener('pointerdown', end);
    return () => {
      window.removeEventListener('drop', end);
      window.removeEventListener('dragend', end);
      window.removeEventListener('pointerdown', end);
    };
  }, [drag, end]);

  const draggedSubtree = useMemo(() => {
    if (drag?.kind !== 'role') return null;
    const inc = selectActive(useCrisisStore.getState());
    return inc ? roleSubtreeIds(inc.roles, drag.id) : null;
  }, [drag]);

  const dnd = useMemo<ChartDnd>(
    () => ({ editable, drag, draggedSubtree, current, begin, end, announce }),
    [editable, drag, draggedSubtree, current, begin, end, announce],
  );

  useEffect(() => {
    const el = scrollRef.current;
    if (!el) return;
    requestAnimationFrame(() => {
      el.scrollLeft = Math.max(0, (el.scrollWidth - el.clientWidth) / 2);
    });
  }, [rootRoles.length]);

  useLayoutEffect(() => {
    const el = layoutRef.current;
    if (!el) return;
    const measure = () => setDocked(el.clientWidth >= PANEL_BESIDE_MIN_PX);
    measure();
    if (typeof ResizeObserver === 'undefined') return;
    const ro = new ResizeObserver(measure);
    ro.observe(el);
    return () => ro.disconnect();
  }, []);

  const handleSelect = (id: string) => {
    setSelectedId((prev) => (prev === id ? null : id));
  };
  // Esc closes the role panel even when focus is on a card (or anywhere else)
  // outside it — the panel's own keydown handler only sees Esc from inside.
  useEscapeLayer(!!selectedId, () => setSelectedId(null));
  const handleRemoved = useCallback((id: string) => {
    setSelectedId((prev) => (prev === id ? null : prev));
  }, []);
  // Hand focus back to the card the panel was for, so a keyboard user carries
  // on from where they were (the panel took focus when it opened).
  const closePanel = () => {
    const id = selectedId;
    setSelectedId(null);
    if (!id) return;
    requestAnimationFrame(() => {
      layoutRef.current
        ?.querySelector<HTMLElement>(`[data-role-card="${CSS.escape(id)}"]`)
        ?.focus();
    });
  };

  return (
    <ChartDndContext.Provider value={dnd}>
      <div className="flex flex-col gap-0">
        {editable && (
          <p className="mb-1 flex flex-wrap items-center gap-x-1.5 gap-y-0.5 text-[10px] text-white/35">
            <span aria-hidden className="select-none text-white/25">⠿</span>
            Drag roles to reorganize · drag people onto roles to assign
            {/* Touch screens often can't drag: the edit panel's Position controls can. */}
            <span className="hidden [@media(pointer:coarse)]:inline">· or tap a role to move it or assign people</span>
            <span className="sr-only">. Keyboard: select a role, then use its edit panel to move it or assign people.</span>
          </p>
        )}
        <p aria-live="polite" className="sr-only">{announcement}</p>

        <div ref={layoutRef} className={`flex gap-4 ${docked ? 'flex-row items-start' : 'flex-col'}`}>
          {/* Scrollable chart */}
          <div ref={scrollRef} className="min-w-0 flex-1 overflow-x-auto">
            <div className="flex w-max min-w-full flex-col items-center py-4">
              {rootRoles.map((r) => (
                <RoleSubtree
                  key={r.id}
                  roleId={r.id}
                  selectedId={selectedId}
                  onSelect={handleSelect}
                  onRemoved={handleRemoved}
                />
              ))}

              {/* Root-level add */}
              {editable && (
                <div className="mt-3 flex flex-col items-center">
                  {addingRoot ? (
                    <QuickAddForm parentId={null} parentColor={IC_COLOR} onDone={() => setAddingRoot(false)} />
                  ) : (
                    <div className="flex items-center gap-2">
                      <button
                        onClick={() => setAddingRoot(true)}
                        className="flex items-center gap-1 rounded border border-white/8 px-3 py-1 text-[9px] text-white/25 transition hover:border-white/18 hover:text-white/55"
                      >
                        + Add top-level role
                      </button>
                      <ResetRolesButton onReset={() => setSelectedId(null)} />
                    </div>
                  )}
                </div>
              )}

              <RestoreSection />
              <UnplacedAssignments />
            </div>
          </div>

          {/* Edit panel */}
          {selectedId && (
            <EditPanel roleId={selectedId} onClose={closePanel} docked={docked} />
          )}
        </div>

        <PersonnelPool />
      </div>
    </ChartDndContext.Provider>
  );
}
