import React, { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState } from 'react';
import { useShallow } from 'zustand/react/shallow';
import {
  useCrisisStore, selectActive,
  DEFAULT_ROLES, roleSiblings, roleSubtreeIds,
  type IcsRole, type MoveRoleTarget, type PersonnelAssignment, type PersonnelDetails,
  IC_COLOR, CMD_COLOR, OPS_COLOR, PLAN_COLOR, LOG_COLOR, FIN_COLOR,
} from './crisisStore';

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

// Depth-first in the order the chart draws it (command staff, then general
// staff, each by order) — for the "Reports to" picker. Roles whose parent is
// missing aren't on the chart and aren't offered.
export function chartOrder(roles: readonly IcsRole[]): { role: IcsRole; depth: number }[] {
  const out: { role: IcsRole; depth: number }[] = [];
  const seen = new Set<string>();
  const walk = (parentId: string | null, depth: number) => {
    for (const cmd of [true, false]) {
      for (const r of roleSiblings(roles, parentId, cmd)) {
        if (seen.has(r.id)) continue;
        seen.add(r.id);
        out.push({ role: r, depth });
        walk(r.id, depth + 1);
      }
    }
  };
  walk(null, 0);
  return out;
}

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
      {items.map((child, i) => (
        <div key={i} className="flex flex-1 flex-col items-center">
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
  collapsedKids,
  onExpand,
}: {
  role: IcsRole;
  selected: boolean;
  onSelect: () => void;
  onRemoved?: () => void;
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
  const removeRole = useCrisisStore((s) => s.removeRole);

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
        st.assignRole(role.id, a.name, { title: a.title, phone: a.phone, email: a.email }, a.personnelId);
        dnd.announce(`${a.name} assigned as ${role.title}`);
      }
    } else if (inc) {
      const memberId = payload(PERSONNEL_MIME);
      const member = (inc.personnel ?? []).find((p) => p.id === memberId);
      if (member) {
        st.assignRole(role.id, member.name, { title: member.title, phone: member.phone, email: member.email }, member.id);
        dnd.announce(`${member.name} assigned as ${role.title}`);
      }
    }
    // The source may have unmounted mid-drag (a moved card re-renders under its
    // new parent; a reassigned name leaves this card), so its dragend can't be
    // relied on to reach React.
    dnd.end();
  };

  const handleRemove = (e: React.MouseEvent) => {
    e.stopPropagation();
    if (confirm(`Remove "${role.title}"?`)) {
      removeRole(role.id);
      onRemoved?.();
    }
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

      {/* Remove button — visible on hover when empty. Mouse-only: keyboard
          users remove from the edit panel (no nested focus stops in a card). */}
      {isEmpty && dnd.editable && (
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
  onRemoved?: () => void;
  depth?: number;
}) {
  const { editable } = useContext(ChartDndContext);
  const [kidsCollapsed, setKidsCollapsed] = useState(depth >= 1);
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
        onRemoved={onRemoved}
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
              <RoleSubtree key={r.id} roleId={r.id} selectedId={selectedId} onSelect={onSelect} depth={depth + 1} />
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
          aria-label={`${kidsCollapsed ? 'Expand' : 'Collapse'} sub-roles of ${role.title}`}
          onClick={(e) => { e.stopPropagation(); setKidsCollapsed((v) => !v); }}
          className="mt-2 flex items-center gap-1 rounded border border-white/10 bg-white/4 px-2 py-0.5 text-[10px] text-white/45 transition hover:border-white/20 hover:text-white/70"
        >
          <span aria-hidden style={{ color: role.color }}>{kidsCollapsed ? '▼' : '▲'}</span>
          {kidsCollapsed ? `Expand (${regularKids.length + commandKids.length})` : 'Collapse'}
        </button>
      )}

      {/* Regular staff */}
      {regularKids.length > 0 && showKids && (
        <>
          {commandKids.length === 0 && <Stem />}
          <ConnectorRow>
            {regularKids.map((r) => (
              <RoleSubtree key={r.id} roleId={r.id} selectedId={selectedId} onSelect={onSelect} depth={depth + 1} />
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
  const personnel = useCrisisStore((s) => selectActive(s)?.personnel ?? []);
  const addPersonnelMember = useCrisisStore((s) => s.addPersonnelMember);
  const removePersonnelMember = useCrisisStore((s) => s.removePersonnelMember);

  const [adding, setAdding] = useState(false);
  const [nameInput, setNameInput] = useState('');
  const [titleInput, setTitleInput] = useState('');
  const [phoneInput, setPhoneInput] = useState('');
  const [emailInput, setEmailInput] = useState('');
  const nameRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    if (adding) nameRef.current?.focus();
  }, [adding]);

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
          onClick={() => setAdding((v) => !v)}
          className="text-[10px] text-white/30 transition hover:text-white/60"
        >
          {adding ? '✕ Cancel' : '+ Add person'}
        </button>
      </div>

      {adding && (
        <div className="mb-3 space-y-2 rounded-lg border border-white/8 bg-white/3 p-2.5">
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
          Add people here, then drag them onto roles above to assign.
        </p>
      ) : (
        <div className="flex flex-wrap gap-1.5">
          {personnel.map((member) => (
            <div
              key={member.id}
              draggable={dnd.editable}
              onDragStart={(e) => dnd.begin(e, { kind: 'personnel', id: member.id })}
              onDragEnd={dnd.end}
              className={`group flex items-center gap-1.5 rounded border border-white/10 bg-white/5 px-2 py-1 text-[10px] text-white/60 transition hover:border-white/18 ${
                dnd.editable ? 'cursor-grab active:cursor-grabbing' : ''
              } ${dnd.drag?.kind === 'personnel' && dnd.drag.id === member.id ? 'opacity-40' : ''}`}
            >
              <span aria-hidden className="text-white/25 select-none">⠿</span>
              <span>{member.name}</span>
              {member.title && (
                <span className="text-white/30">· {member.title}</span>
              )}
              {member.phone && <span className="text-white/25" title={member.phone}>☎</span>}
              {member.email && <span className="text-white/25" title={member.email}>✉</span>}
              <button
                onClick={() => removePersonnelMember(member.id)}
                aria-label={`Remove ${member.name} from pool`}
                className="ml-0.5 text-white/15 opacity-0 transition hover:text-red-400/70 focus-visible:opacity-100 group-hover:opacity-100"
                title="Remove from pool"
              >
                ×
              </button>
            </div>
          ))}
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

function EditPanel({ roleId, onClose }: { roleId: string; onClose: () => void }) {
  const role = useCrisisStore((s) => selectActive(s)?.roles.find((r) => r.id === roleId));
  const assignments = useCrisisStore(useShallow((s) =>
    (selectActive(s)?.assignments ?? []).filter((a) => a.roleId === roleId).sort(
      (a, b) => new Date(b.startedAt).getTime() - new Date(a.startedAt).getTime()
    )
  ));
  const roles = useCrisisStore((s) => selectActive(s)?.roles ?? []);
  const updateRole    = useCrisisStore((s) => s.updateRole);
  const removeRole    = useCrisisStore((s) => s.removeRole);
  const assignRole    = useCrisisStore((s) => s.assignRole);
  const endAssignment = useCrisisStore((s) => s.endAssignment);
  const addRole       = useCrisisStore((s) => s.addRole);
  const panelRef = useRef<HTMLDivElement>(null);

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

  useEffect(() => {
    setNameInput(activeAssignment?.name ?? '');
    setTitleInput(activeAssignment?.title ?? '');
    setPhoneInput(activeAssignment?.phone ?? '');
    setEmailInput(activeAssignment?.email ?? '');
    setAddingChild(false);
  }, [roleId]);

  // On narrow screens the panel stacks below the (often tall) chart, where a
  // tap on a card would otherwise open it out of sight.
  useEffect(() => {
    if (!window.matchMedia?.('(max-width: 767px)').matches) return;
    panelRef.current?.scrollIntoView({ block: 'nearest', behavior: 'smooth' });
  }, [roleId]);

  if (!role) return null;

  const fmt = (iso: string) => {
    try { return new Date(iso).toLocaleString(undefined, { month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit' }); }
    catch { return iso; }
  };

  const handleAssign = () => {
    const n = nameInput.trim();
    if (!n) return;
    assignRole(roleId, n, {
      title: titleInput.trim() || undefined,
      phone: phoneInput.trim() || undefined,
      email: emailInput.trim() || undefined,
    });
    setNameInput('');
    setTitleInput('');
    setPhoneInput('');
    setEmailInput('');
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
      aria-label={`Edit role: ${role.title}`}
      className="w-full shrink-0 space-y-4 rounded-lg border border-white/10 bg-ink-900/90 p-4 text-[11px] md:w-64"
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
        <input
          aria-label="Full name"
          className="mb-1 w-full rounded border border-white/8 bg-white/10 px-2 py-1 text-[11px] text-white/80 outline-none placeholder-white/20 focus:border-white/20"
          placeholder="Full name"
          value={nameInput}
          onChange={(e) => setNameInput(e.target.value)}
          onKeyDown={(e) => e.key === 'Enter' && handleAssign()}
        />
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
          disabled={!nameInput.trim()}
          className="w-full rounded bg-accent/15 py-1 text-[10px] text-accent transition hover:bg-accent/25 disabled:opacity-30"
        >
          {role.isSupport ? 'Add to Role' : activeAssignment ? 'Reassign' : 'Assign'}
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

      {/* Delete role — available for any role when empty */}
      {(() => {
        const activeCount = assignments.filter((a) => !a.endedAt).length;
        if (activeCount > 0) return null;
        return (
          <button
            onClick={() => {
              if (confirm(`Remove "${role.title}" and all its sub-roles?`)) {
                removeRole(roleId);
                onClose();
              }
            }}
            className="w-full rounded border border-red-500/20 py-1 text-[10px] text-red-400/50 transition hover:border-red-500/40 hover:text-red-400"
          >
            Remove role
          </button>
        );
      })()}

      {/* Reset to defaults */}
      <button
        onClick={() => {
          if (confirm('Reset org chart to default ICS/NIMS structure?')) {
            useCrisisStore.getState().resetRoles();
            onClose();
          }
        }}
        className="w-full text-[9px] text-white/20 transition hover:text-white/40"
      >
        Reset to defaults
      </button>
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

export function IcsOrgChart() {
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [addingRoot, setAddingRoot] = useState(false);
  const scrollRef = useRef<HTMLDivElement>(null);
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

  const handleSelect = (id: string) => {
    setSelectedId((prev) => (prev === id ? null : id));
  };

  return (
    <ChartDndContext.Provider value={dnd}>
      <div className="flex flex-col gap-0">
        {editable && (
          <p className="mb-1 flex flex-wrap items-center gap-x-1.5 gap-y-0.5 text-[10px] text-white/35">
            <span aria-hidden className="select-none text-white/25">⠿</span>
            Drag roles to reorganize · drag people onto roles to assign
            {/* Touch screens often can't drag: the edit panel's Position controls can. */}
            <span className="hidden [@media(pointer:coarse)]:inline">· or tap a role to move it</span>
            <span className="sr-only">. Keyboard: select a role, then use Position in its edit panel.</span>
          </p>
        )}
        <p aria-live="polite" className="sr-only">{announcement}</p>

        <div className="flex flex-col gap-4 md:flex-row">
          {/* Scrollable chart */}
          <div ref={scrollRef} className="min-w-0 flex-1 overflow-x-auto">
            <div className="flex w-max min-w-full flex-col items-center py-4">
              {rootRoles.map((r) => (
                <RoleSubtree
                  key={r.id}
                  roleId={r.id}
                  selectedId={selectedId}
                  onSelect={handleSelect}
                  onRemoved={() => { if (selectedId === r.id) setSelectedId(null); }}
                />
              ))}

              {/* Root-level add */}
              {editable && (
                <div className="mt-3 flex flex-col items-center">
                  {addingRoot ? (
                    <QuickAddForm parentId={null} parentColor={IC_COLOR} onDone={() => setAddingRoot(false)} />
                  ) : (
                    <button
                      onClick={() => setAddingRoot(true)}
                      className="flex items-center gap-1 rounded border border-white/8 px-3 py-1 text-[9px] text-white/25 transition hover:border-white/18 hover:text-white/55"
                    >
                      + Add top-level role
                    </button>
                  )}
                </div>
              )}

              <RestoreSection />
            </div>
          </div>

          {/* Edit panel */}
          {selectedId && (
            <EditPanel roleId={selectedId} onClose={() => setSelectedId(null)} />
          )}
        </div>

        <PersonnelPool />
      </div>
    </ChartDndContext.Provider>
  );
}
