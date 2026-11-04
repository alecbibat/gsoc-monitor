import { useCallback, useEffect, useLayoutEffect, useRef, useState, type MouseEvent as ReactMouseEvent } from 'react';
import { createPortal } from 'react-dom';
import {
  CHECKLIST_PHASES, CHECKLIST_STATUSES, checklistProgress, itemStatus, nextClickStatus, roleProgress,
  type ChecklistItemState, type ChecklistRoleDef, type ChecklistStateMap, type ChecklistStatus, type ChecklistTemplate,
} from './checklistTemplate';
import type { RetiredChecklistEntry, TemplateScope } from './templates/model';
import { OriginChip } from './templates/ScopeChips';

// ── ICS role checklist board ─────────────────────────────────────────────────
// Shared by the editor's Checklists tab, the share page's Checklists tab and
// the admin page's preview: pick a role, work its phases. Clicking an item
// moves it forward — not started → in progress → completed — and right-click
// (long-press on touch) opens a menu that sets any status, which is also how a
// completed item is reopened. Purely presentational (template + state in,
// status changes out) and store-free — the share page must not pull
// crisisStore into its bundle.

function fmtToggleTime(iso: string): string {
  try {
    return new Date(iso).toLocaleString('en-US', {
      month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit',
    });
  } catch {
    return iso;
  }
}

const STATUS_LABEL: Record<ChecklistStatus, string> = Object.fromEntries(
  CHECKLIST_STATUSES.map((s) => [s.id, s.label])
) as Record<ChecklistStatus, string>;

/** Half-filled disc — "started, not finished". An SVG, not "◐": that character
 *  is missing from many UI fonts and falls back to something unrecognisable. */
function HalfDisc({ className }: { className: string }) {
  return (
    <svg viewBox="0 0 12 12" className={className} aria-hidden>
      <circle cx="6" cy="6" r="4.5" fill="none" stroke="currentColor" strokeWidth="1.5" />
      <path d="M6 1.5 A4.5 4.5 0 0 1 6 10.5 Z" fill="currentColor" />
    </svg>
  );
}

function StatusGlyph({ status, className = 'mt-0.5' }: { status: ChecklistStatus; className?: string }) {
  const tone =
    status === 'completed'
      ? 'border-accent-ok/60 bg-accent-ok/20 text-accent-ok'
      : status === 'in-progress'
        ? 'border-amber-300/70 bg-amber-300/15 text-amber-300'
        : 'border-white/25 bg-white/5 text-transparent';
  return (
    <span
      aria-hidden
      className={`grid h-[18px] w-[18px] shrink-0 place-items-center rounded border text-[11px] font-bold transition ${tone} ${className}`}
    >
      {status === 'in-progress' ? <HalfDisc className="h-[11px] w-[11px]" /> : '✓'}
    </span>
  );
}

const STAMP: Record<ChecklistStatus, { text: string; cls: string }> = {
  completed: { text: '✓ Completed', cls: 'text-accent-ok/70' },
  'in-progress': { text: 'In progress since', cls: 'text-amber-300/75' },
  'not-started': { text: '↺ Reset to not started', cls: 'text-white/40' },
};

/** "✓ Completed Aug 19, 09:14 · Sam" — the point of the feature: what, when, and by whom. */
function StatusStamp({ state }: { state: Pick<ChecklistItemState, 'checked' | 'status' | 'at' | 'by'> }) {
  const status = itemStatus(state);
  const stamp = STAMP[status];
  return (
    <span className={`mt-0.5 block text-[10px] ${stamp.cls}`}>
      {status === 'in-progress' && <HalfDisc className="mr-1 inline h-[9px] w-[9px] align-[-1px]" />}
      {stamp.text} {fmtToggleTime(state.at)}
      {state.by ? <span className="text-white/35"> · {state.by}</span> : null}
    </span>
  );
}

/** Where to open the status menu, and the item it is for. */
interface MenuTarget {
  itemId: string;
  x: number;
  y: number;
  /** Focus goes back here when the menu closes. */
  trigger: HTMLElement | null;
}

const LONG_PRESS_MS = 500;
const LONG_PRESS_SLOP_PX = 10;

function ItemRow({ id, text, scope, state, onSetStatus, onOpenMenu, disabled }: {
  id: string;
  text: string;
  scope: TemplateScope | undefined;
  state: ChecklistStateMap[string] | undefined;
  onSetStatus?: (itemId: string, status: ChecklistStatus) => void;
  onOpenMenu: (target: MenuTarget) => void;
  disabled: boolean;
}) {
  const status = itemStatus(state);
  const next = nextClickStatus(status);
  const interactive = !!onSetStatus && !disabled;

  // Long-press opens the menu on touch screens, which have no right-click
  // (iOS never fires contextmenu for a button). The click that ends a long
  // press is swallowed so the menu isn't followed by a status change.
  const press = useRef<{ timer: number; x: number; y: number } | null>(null);
  const longPressed = useRef(false);
  const cancelPress = () => {
    if (press.current) window.clearTimeout(press.current.timer);
    press.current = null;
  };
  useEffect(() => cancelPress, []);

  const openAt = (el: HTMLElement, x: number, y: number) => {
    // A keyboard-opened context menu (menu key, Shift+F10) reports no
    // pointer position: open it under the item instead.
    if (x === 0 && y === 0) {
      const r = el.getBoundingClientRect();
      x = r.left + 28;
      y = r.bottom;
    }
    onOpenMenu({ itemId: id, x, y, trigger: el });
  };

  return (
    <button
      type="button"
      role="checkbox"
      aria-checked={status === 'completed' ? true : status === 'in-progress' ? 'mixed' : false}
      aria-haspopup={interactive ? 'menu' : undefined}
      onClick={() => {
        if (longPressed.current) { longPressed.current = false; return; }
        if (interactive && next) onSetStatus!(id, next);
      }}
      onContextMenu={(e: ReactMouseEvent<HTMLButtonElement>) => {
        if (!interactive) return;
        e.preventDefault();
        cancelPress();
        openAt(e.currentTarget, e.clientX, e.clientY);
      }}
      onPointerDown={(e) => {
        longPressed.current = false;
        if (!interactive || e.pointerType === 'mouse') return;
        const el = e.currentTarget;
        const { clientX: x, clientY: y } = e;
        cancelPress();
        press.current = {
          x,
          y,
          timer: window.setTimeout(() => {
            press.current = null;
            longPressed.current = true;
            openAt(el, x, y);
          }, LONG_PRESS_MS),
        };
      }}
      onPointerMove={(e) => {
        const p = press.current;
        if (p && Math.hypot(e.clientX - p.x, e.clientY - p.y) > LONG_PRESS_SLOP_PX) cancelPress();
      }}
      onPointerUp={cancelPress}
      onPointerCancel={cancelPress}
      onPointerLeave={cancelPress}
      disabled={!interactive}
      title={
        interactive
          ? next
            ? `Click to mark ${STATUS_LABEL[next].toLowerCase()} · right-click for any status`
            : 'Completed · right-click to change its status'
          : undefined
      }
      style={{ WebkitTouchCallout: 'none' }}
      className={`flex w-full select-none items-start gap-3 rounded-md px-3 py-2.5 text-left transition ${
        interactive ? 'hover:bg-white/6' : 'cursor-default'
      }`}
    >
      <StatusGlyph status={status} />
      <span className="min-w-0 flex-1">
        <span className={`block text-[13px] leading-snug ${status === 'completed' ? 'text-white/45 line-through decoration-white/25' : 'text-white/85'}`}>
          {text}
          <OriginChip scope={scope} className={status === 'completed' ? 'opacity-60' : ''} />
        </span>
        {state && <StatusStamp state={state} />}
      </span>
    </button>
  );
}

/** The right-click / long-press menu: set an item to any status. */
function StatusMenu({ target, current, onPick, onClose }: {
  target: MenuTarget;
  current: ChecklistStatus;
  onPick: (status: ChecklistStatus) => void;
  onClose: () => void;
}) {
  const ref = useRef<HTMLDivElement>(null);
  const [pos, setPos] = useState({ left: target.x, top: target.y });

  // Keep the whole menu on screen, and put focus on the current status so
  // the arrow keys work straight away.
  useLayoutEffect(() => {
    const el = ref.current;
    if (!el) return;
    const r = el.getBoundingClientRect();
    setPos({
      left: Math.max(8, Math.min(target.x, window.innerWidth - r.width - 8)),
      top: Math.max(8, Math.min(target.y, window.innerHeight - r.height - 8)),
    });
    el.querySelector<HTMLButtonElement>('[aria-checked="true"]')?.focus({ preventScroll: true });
  }, [target.x, target.y]);

  useEffect(() => {
    const outside = (e: Event) => {
      if (ref.current && e.target instanceof Node && ref.current.contains(e.target)) return;
      onClose();
    };
    const onKey = (e: KeyboardEvent) => {
      const items = [...(ref.current?.querySelectorAll<HTMLButtonElement>('[role="menuitemradio"]') ?? [])];
      const at = items.indexOf(document.activeElement as HTMLButtonElement);
      if (e.key === 'Escape' || e.key === 'Tab') {
        e.preventDefault();
        e.stopPropagation();
        onClose();
      } else if (e.key === 'ArrowDown' || e.key === 'ArrowUp') {
        e.preventDefault();
        const step = e.key === 'ArrowDown' ? 1 : -1;
        items[(at + step + items.length) % items.length]?.focus({ preventScroll: true });
      }
    };
    window.addEventListener('pointerdown', outside, true);
    window.addEventListener('keydown', onKey, true);
    window.addEventListener('scroll', onClose, true);
    window.addEventListener('resize', onClose);
    window.addEventListener('blur', onClose);
    return () => {
      window.removeEventListener('pointerdown', outside, true);
      window.removeEventListener('keydown', onKey, true);
      window.removeEventListener('scroll', onClose, true);
      window.removeEventListener('resize', onClose);
      window.removeEventListener('blur', onClose);
    };
  }, [onClose]);

  return createPortal(
    <div
      ref={ref}
      role="menu"
      aria-label="Set status"
      onContextMenu={(e) => e.preventDefault()}
      className="fixed z-[4700] min-w-[11.5rem] overflow-hidden rounded-lg border border-white/12 bg-ink-900/95 py-1 text-white shadow-2xl backdrop-blur-md"
      style={{ left: pos.left, top: pos.top }}
    >
      <div className="px-3 pb-1 pt-1.5 text-[9px] font-bold uppercase tracking-[0.14em] text-white/35">Set status</div>
      {CHECKLIST_STATUSES.map((s) => (
        <button
          key={s.id}
          type="button"
          role="menuitemradio"
          aria-checked={s.id === current}
          onClick={() => onPick(s.id)}
          className="flex w-full items-center gap-2.5 px-3 py-1.5 text-left text-[12px] text-white/80 outline-none transition hover:bg-white/8 focus-visible:bg-white/10"
        >
          <StatusGlyph status={s.id} className="" />
          <span className="flex-1">{s.label}</span>
          {s.id === current && <span className="text-[10px] text-white/35">current</span>}
        </button>
      ))}
    </div>,
    document.body
  );
}

/**
 * Checklist state for items this incident no longer resolves to (its type or
 * property changed after they were changed, or an admin removed them) —
 * collapsed by default and strictly read-only, so the record an after-action
 * review relies on never silently loses a completed item.
 */
function RetiredSection({ entries, roles }: { entries: RetiredChecklistEntry[]; roles: ChecklistRoleDef[] }) {
  const [open, setOpen] = useState(false);
  const completedCount = entries.filter((e) => itemStatus(e) === 'completed').length;
  return (
    <div className="mt-3 overflow-hidden rounded-lg border border-white/8 bg-ink-950/60">
      <button
        onClick={() => setOpen((v) => !v)}
        aria-expanded={open}
        className="flex w-full flex-wrap items-baseline gap-x-2 gap-y-0.5 px-4 py-2 text-left transition hover:bg-white/4"
      >
        <span aria-hidden className="w-2.5 text-[10px] text-white/35">{open ? '▾' : '▸'}</span>
        <span className="text-[10px] font-bold uppercase tracking-[0.14em] text-white/50">Earlier checklist items</span>
        <span className="text-[10px] text-white/35">
          no longer apply to this incident · {entries.length} item{entries.length === 1 ? '' : 's'}
          {completedCount > 0 ? `, ${completedCount} completed` : ''}
        </span>
      </button>
      {open && (
        <div className="border-t border-white/6">
          <p className="px-4 pt-2 text-[10px] leading-snug text-white/35">
            Changed before the incident's type or property changed, or since removed from the templates. Kept
            read-only for the record.
          </p>
          <ul className="divide-y divide-white/4 px-1 py-1">
            {entries.map((e) => {
              const role = e.roleId ? roles.find((r) => r.id === e.roleId) : undefined;
              const done = itemStatus(e) === 'completed';
              return (
                <li key={e.id} className="flex items-start gap-3 px-3 py-2.5">
                  <StatusGlyph status={itemStatus(e)} />
                  <span className="min-w-0 flex-1">
                    <span className={`block text-[13px] leading-snug ${done ? 'text-white/45' : 'text-white/65'}`}>
                      {e.roleId && (
                        <span
                          className="mr-1.5 text-[9px] font-bold uppercase tracking-[0.12em]"
                          style={role ? { color: role.color } : undefined}
                        >
                          {role?.code ?? e.roleId.toUpperCase()}
                        </span>
                      )}
                      {e.text ?? <span className="italic text-white/35">Item no longer in any template ({e.id})</span>}
                    </span>
                    <StatusStamp state={e} />
                  </span>
                </li>
              );
            })}
          </ul>
        </div>
      )}
    </div>
  );
}

/** Completed (green) and in-progress (amber) shares of a bar. */
function ProgressBar({ done, inProgress, total, className, doneColor }: {
  done: number;
  inProgress: number;
  total: number;
  className: string;
  doneColor?: string;
}) {
  const pct = (n: number) => (total ? Math.round((n / total) * 100) : 0);
  return (
    <div className={`flex overflow-hidden rounded-full bg-white/8 ${className}`}>
      <div
        className={`h-full transition-all ${doneColor ? '' : 'bg-accent-ok/70'}`}
        style={{ width: `${pct(done)}%`, ...(doneColor ? { background: doneColor } : {}) }}
      />
      <div className="h-full bg-amber-300/55 transition-all" style={{ width: `${pct(inProgress)}%` }} />
    </div>
  );
}

export function ChecklistBoard({
  template, state, onSetStatus, disabled = false, footnote, preferredRoleId, onRoleChange, retired,
}: {
  template: ChecklistTemplate;
  state: ChecklistStateMap;
  /** Absent = read-only board. */
  onSetStatus?: (itemId: string, status: ChecklistStatus) => void;
  /** Render items inert (archived incident, revoked link, …). */
  disabled?: boolean;
  /** Small line under the role header (e.g. who the changes record as). */
  footnote?: string;
  /** Role to open on (the viewer's own) — falls back to the first role. */
  preferredRoleId?: string;
  /** The viewer picked a role (lets the caller remember it). */
  onRoleChange?: (roleId: string) => void;
  /** State for items outside the resolved template, shown read-only. */
  retired?: RetiredChecklistEntry[];
}) {
  const hasRole = (id: string | undefined): id is string => !!id && template.roles.some((r) => r.id === id);
  const [roleId, setRoleId] = useState(() => (hasRole(preferredRoleId) ? preferredRoleId : template.roles[0]?.id ?? ''));
  // A preference that arrives or changes while the board is open (the viewer
  // was just assigned a role) is followed — until they pick a role themselves.
  const picked = useRef(false);
  useEffect(() => {
    if (!picked.current && hasRole(preferredRoleId)) setRoleId(preferredRoleId);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [preferredRoleId, template]);

  const [hideDone, setHideDone] = useState(false);
  // Items this viewer completed while "Hide completed" is on stay in view
  // (struck through) until the toggle is flipped again: a mis-click must stay
  // within reach of its menu, not vanish. Teammates' completions still drop
  // out as they arrive.
  const [keepShown, setKeepShown] = useState<ReadonlySet<string>>(new Set());
  const setHide = (on: boolean) => { setHideDone(on); setKeepShown(new Set()); };
  const interactive = !!onSetStatus && !disabled;
  const setStatus = interactive
    ? (itemId: string, status: ChecklistStatus) => {
        if (hideDone) setKeepShown((s) => new Set(s).add(itemId));
        onSetStatus!(itemId, status);
      }
    : undefined;

  const [menu, setMenu] = useState<MenuTarget | null>(null);
  const menuRef = useRef<MenuTarget | null>(null);
  const openMenu = useCallback((target: MenuTarget) => {
    menuRef.current = target;
    setMenu(target);
  }, []);
  const closeMenu = useCallback(() => {
    const m = menuRef.current;
    menuRef.current = null;
    setMenu(null);
    // Back to the item the menu was opened from, for keyboard users.
    if (m?.trigger?.isConnected) m.trigger.focus({ preventScroll: true });
  }, []);
  // The board turning read-only (archived, link revoked) takes the menu with it.
  useEffect(() => {
    if (!interactive) {
      menuRef.current = null;
      setMenu(null);
    }
  }, [interactive]);

  const pick = (id: string) => {
    picked.current = true;
    setRoleId(id);
    onRoleChange?.(id);
  };

  const role: ChecklistRoleDef | undefined =
    template.roles.find((r) => r.id === roleId) ?? template.roles[0];
  const retiredSection = retired && retired.length > 0
    ? <RetiredSection entries={retired} roles={template.roles} />
    : null;

  if (!role) {
    return (
      <div>
        <p className="rounded-lg border border-white/8 bg-white/4 px-4 py-6 text-center text-[12px] text-white/40">
          No checklist items apply to this incident.
        </p>
        {retiredSection}
      </div>
    );
  }

  const overall = checklistProgress(template, state);
  const progress = roleProgress(role, state);

  return (
    <div>
      {/* Whole-response progress + view filter */}
      <div className="mb-2 flex flex-wrap items-center gap-x-3 gap-y-1.5">
        <div className="flex min-w-0 flex-1 items-center gap-2">
          <div
            className="shrink-0"
            role="progressbar"
            aria-label="All roles"
            aria-valuemin={0}
            aria-valuemax={overall.total}
            aria-valuenow={overall.done}
          >
            <ProgressBar done={overall.done} inProgress={overall.inProgress} total={overall.total} className="h-1.5 w-20 sm:w-32" />
          </div>
          <span className="min-w-0 text-[11px] text-white/50">
            <span className={overall.done === overall.total ? 'text-accent-ok/80' : 'text-white/75'}>
              {overall.done} of {overall.total}
            </span>{' '}
            items complete across all roles
            {overall.inProgress > 0 && <span className="text-amber-300/80"> · {overall.inProgress} in progress</span>}
            {' '}· {overall.rolesDone}/{template.roles.length} roles done
          </span>
        </div>
        <button
          onClick={() => setHide(!hideDone)}
          aria-pressed={hideDone}
          className={`shrink-0 rounded border px-2.5 py-1 text-[10px] transition ${
            hideDone
              ? 'border-accent/30 bg-accent/10 text-accent/80 hover:text-accent'
              : 'border-white/10 text-white/40 hover:text-white/60'
          }`}
        >
          {hideDone && <span aria-hidden>✓ </span>}Hide completed
        </button>
      </div>
      {interactive && (
        <p className="mb-2 text-[10px] text-white/35">
          Click an item to mark it in progress, click again when it’s completed · right-click (long-press on touch) to set any status
        </p>
      )}

      {/* Role picker — horizontal scroll on phones */}
      <div className="-mx-1 flex gap-1.5 overflow-x-auto px-1 pb-2" role="group" aria-label="Checklist role">
        {template.roles.map((r) => {
          const p = roleProgress(r, state);
          const selected = r.id === role.id;
          const complete = p.total > 0 && p.done === p.total;
          return (
            <button
              key={r.id}
              onClick={() => pick(r.id)}
              aria-pressed={selected}
              aria-label={`${r.title}: ${p.done} of ${p.total} complete${p.inProgress ? `, ${p.inProgress} in progress` : ''}`}
              className={`shrink-0 rounded-md border px-2.5 py-1.5 text-left transition ${
                selected ? 'bg-white/10' : 'border-white/10 bg-white/4 hover:bg-white/8'
              }`}
              style={selected ? { borderColor: `${r.color}80` } : undefined}
              title={r.title}
            >
              <span className="block text-[10px] font-bold uppercase tracking-[0.12em]" style={{ color: r.color }}>
                {r.code}
              </span>
              <span className={`block text-[9px] ${complete ? 'text-accent-ok/80' : 'text-white/40'}`}>
                {complete ? '✓ ' : ''}{p.done}/{p.total}
                {p.inProgress > 0 && (
                  <span className="text-amber-300/75">
                    {' · '}{p.inProgress}
                    <HalfDisc className="ml-0.5 inline h-[8px] w-[8px] align-[-0.5px]" />
                  </span>
                )}
              </span>
            </button>
          );
        })}
      </div>

      {/* Selected role */}
      <div className="overflow-hidden rounded-lg border border-white/10 bg-ink-950/60">
        <div className="border-b border-white/8 px-4 py-3" style={{ borderTop: `3px solid ${role.color}` }}>
          <div className="flex flex-wrap items-baseline gap-x-3 gap-y-0.5">
            <span className="text-[11px] font-bold uppercase tracking-[0.14em]" style={{ color: role.color }}>
              {role.code}
            </span>
            <span className="text-[14px] font-semibold text-white/90">{role.title}</span>
            <span className={`ml-auto text-[11px] ${progress.done === progress.total ? 'text-accent-ok/80' : 'text-white/45'}`}>
              {progress.done} of {progress.total} complete
              {progress.inProgress > 0 && <span className="text-amber-300/75"> · {progress.inProgress} in progress</span>}
            </span>
          </div>
          <div className="mt-1 flex flex-wrap gap-x-5 gap-y-0.5 text-[10px] text-white/40">
            {role.reportsTo && <span><span className="text-white/25">Reports to:</span> {role.reportsTo}</span>}
            {role.directs && <span><span className="text-white/25">Directs:</span> {role.directs}</span>}
          </div>
          <ProgressBar
            done={progress.done}
            inProgress={progress.inProgress}
            total={progress.total}
            className="mt-2 h-1"
            doneColor={role.color}
          />
          {footnote && <p className="mt-1.5 text-[9px] text-white/30">{footnote}</p>}
        </div>

        {role.phases.map((ph) => {
          const label = CHECKLIST_PHASES.find((p) => p.id === ph.id)?.label ?? ph.id;
          const statuses = ph.items.map((i) => itemStatus(state[i.id]));
          const done = statuses.filter((s) => s === 'completed').length;
          const started = statuses.filter((s) => s === 'in-progress').length;
          const shown = hideDone
            ? ph.items.filter((i) => itemStatus(state[i.id]) !== 'completed' || keepShown.has(i.id))
            : ph.items;
          return (
            <div key={ph.id} className="border-b border-white/6 last:border-b-0">
              <div className="flex items-baseline gap-2 bg-white/4 px-4 py-1.5">
                <span className={`text-[10px] font-bold uppercase tracking-[0.14em] ${
                  ph.id === 'immediate' ? 'text-red-300/80' : 'text-white/50'
                }`}>
                  {label}
                </span>
                <span className={`text-[9px] ${done === ph.items.length ? 'text-accent-ok/70' : 'text-white/30'}`}>
                  {done}/{ph.items.length}
                  {started > 0 && <span className="text-amber-300/70"> · {started} in progress</span>}
                </span>
              </div>
              {shown.length === 0 ? (
                <p className="px-4 py-2 text-[11px] text-accent-ok/60">✓ All {ph.items.length} complete</p>
              ) : (
                <div className="divide-y divide-white/4 px-1 py-1">
                  {shown.map((item) => (
                    <ItemRow
                      key={item.id}
                      id={item.id}
                      text={item.text}
                      scope={item.scope}
                      state={state[item.id]}
                      onSetStatus={setStatus}
                      onOpenMenu={openMenu}
                      disabled={disabled}
                    />
                  ))}
                </div>
              )}
            </div>
          );
        })}
      </div>
      {retiredSection}
      {menu && setStatus && (
        <StatusMenu
          target={menu}
          current={itemStatus(state[menu.itemId])}
          onPick={(status) => {
            if (status !== itemStatus(state[menu.itemId])) setStatus(menu.itemId, status);
            closeMenu();
          }}
          onClose={closeMenu}
        />
      )}
    </div>
  );
}
