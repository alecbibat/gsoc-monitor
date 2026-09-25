import { useEffect, useRef, useState } from 'react';
import {
  CHECKLIST_PHASES, checklistProgress, roleProgress,
  type ChecklistRoleDef, type ChecklistStateMap, type ChecklistTemplate,
} from './checklistTemplate';
import type { RetiredChecklistEntry, TemplateScope } from './templates/model';
import { OriginChip } from './templates/ScopeChips';

// ── ICS role checklist board ─────────────────────────────────────────────────
// Shared by the editor's Checklists tab, the share page's Checklists tab and
// the admin page's preview: pick a role, work its phases, tap to check items
// off. Purely presentational (template + state in, toggles out) and store-free
// — the share page must not pull crisisStore into its bundle.

function fmtToggleTime(iso: string): string {
  try {
    return new Date(iso).toLocaleString('en-US', {
      month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit',
    });
  } catch {
    return iso;
  }
}

function CheckGlyph({ checked }: { checked: boolean }) {
  return (
    <span
      aria-hidden
      className={`mt-0.5 grid h-[18px] w-[18px] shrink-0 place-items-center rounded border text-[11px] font-bold transition ${
        checked
          ? 'border-accent-ok/60 bg-accent-ok/20 text-accent-ok'
          : 'border-white/25 bg-white/5 text-transparent'
      }`}
    >
      ✓
    </span>
  );
}

/** "✓ Checked Aug 19, 09:14 · Sam" — the point of the feature: when, and by whom. */
function ToggleStamp({ state }: { state: { checked: boolean; at: string; by?: string } }) {
  return (
    <span className={`mt-0.5 block text-[10px] ${state.checked ? 'text-accent-ok/70' : 'text-amber-300/60'}`}>
      {state.checked ? '✓ Checked' : '↺ Unchecked'} {fmtToggleTime(state.at)}
      {state.by ? <span className="text-white/35"> · {state.by}</span> : null}
    </span>
  );
}

function ItemRow({ id, text, scope, state, onToggle, disabled }: {
  id: string;
  text: string;
  scope: TemplateScope | undefined;
  state: ChecklistStateMap[string] | undefined;
  onToggle?: (itemId: string, checked: boolean) => void;
  disabled: boolean;
}) {
  const checked = state?.checked === true;
  const interactive = !!onToggle && !disabled;
  return (
    <button
      onClick={() => { if (interactive) onToggle!(id, !checked); }}
      disabled={!interactive}
      aria-pressed={checked}
      className={`flex w-full items-start gap-3 rounded-md px-3 py-2.5 text-left transition ${
        interactive ? 'hover:bg-white/6' : 'cursor-default'
      }`}
    >
      <CheckGlyph checked={checked} />
      <span className="min-w-0 flex-1">
        <span className={`block text-[13px] leading-snug ${checked ? 'text-white/45 line-through decoration-white/25' : 'text-white/85'}`}>
          {text}
          <OriginChip scope={scope} className={checked ? 'opacity-60' : ''} />
        </span>
        {state && <ToggleStamp state={state} />}
      </span>
    </button>
  );
}

/**
 * Checklist state for items this incident no longer resolves to (its type or
 * property changed after they were toggled, or an admin removed them) —
 * collapsed by default and strictly read-only, so the record an after-action
 * review relies on never silently loses a checked item.
 */
function RetiredSection({ entries, roles }: { entries: RetiredChecklistEntry[]; roles: ChecklistRoleDef[] }) {
  const [open, setOpen] = useState(false);
  const checkedCount = entries.filter((e) => e.checked).length;
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
          {checkedCount > 0 ? `, ${checkedCount} checked` : ''}
        </span>
      </button>
      {open && (
        <div className="border-t border-white/6">
          <p className="px-4 pt-2 text-[10px] leading-snug text-white/35">
            Toggled before the incident's type or property changed, or since removed from the templates. Kept
            read-only for the record.
          </p>
          <ul className="divide-y divide-white/4 px-1 py-1">
            {entries.map((e) => {
              const role = e.roleId ? roles.find((r) => r.id === e.roleId) : undefined;
              return (
                <li key={e.id} className="flex items-start gap-3 px-3 py-2.5">
                  <CheckGlyph checked={e.checked} />
                  <span className="min-w-0 flex-1">
                    <span className={`block text-[13px] leading-snug ${e.checked ? 'text-white/45' : 'text-white/65'}`}>
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
                    <ToggleStamp state={e} />
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

export function ChecklistBoard({
  template, state, onToggle, disabled = false, footnote, preferredRoleId, onRoleChange, retired,
}: {
  template: ChecklistTemplate;
  state: ChecklistStateMap;
  /** Absent = read-only board. */
  onToggle?: (itemId: string, checked: boolean) => void;
  /** Render toggles inert (archived incident, revoked link, …). */
  disabled?: boolean;
  /** Small line under the role header (e.g. who the toggles record as). */
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
  // Items this viewer checked while "Hide completed" is on stay in view (struck
  // through) until the toggle is flipped again: a mis-tap must remain one tap
  // from undo, not vanish. Teammates' checks still drop out as they arrive.
  const [keepShown, setKeepShown] = useState<ReadonlySet<string>>(new Set());
  const setHide = (on: boolean) => { setHideDone(on); setKeepShown(new Set()); };
  const toggle = onToggle && ((itemId: string, checked: boolean) => {
    if (hideDone) setKeepShown((s) => new Set(s).add(itemId));
    onToggle(itemId, checked);
  });

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
  const overallPct = overall.total ? Math.round((overall.done / overall.total) * 100) : 0;
  const progress = roleProgress(role, state);

  return (
    <div>
      {/* Whole-response progress + view filter */}
      <div className="mb-2 flex flex-wrap items-center gap-x-3 gap-y-1.5">
        <div className="flex min-w-0 flex-1 items-center gap-2">
          <div
            className="h-1.5 w-20 shrink-0 overflow-hidden rounded-full bg-white/8 sm:w-32"
            role="progressbar"
            aria-label="All roles"
            aria-valuemin={0}
            aria-valuemax={overall.total}
            aria-valuenow={overall.done}
          >
            <div className="h-full rounded-full bg-accent-ok/70 transition-all" style={{ width: `${overallPct}%` }} />
          </div>
          <span className="min-w-0 text-[11px] text-white/50">
            <span className={overall.done === overall.total ? 'text-accent-ok/80' : 'text-white/75'}>
              {overall.done} of {overall.total}
            </span>{' '}
            items complete across all roles · {overall.rolesDone}/{template.roles.length} roles done
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
              aria-label={`${r.title}: ${p.done} of ${p.total} complete`}
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
            </span>
          </div>
          <div className="mt-1 flex flex-wrap gap-x-5 gap-y-0.5 text-[10px] text-white/40">
            {role.reportsTo && <span><span className="text-white/25">Reports to:</span> {role.reportsTo}</span>}
            {role.directs && <span><span className="text-white/25">Directs:</span> {role.directs}</span>}
          </div>
          <div className="mt-2 h-1 overflow-hidden rounded-full bg-white/8">
            <div
              className="h-full rounded-full transition-all"
              style={{
                width: `${progress.total ? Math.round((progress.done / progress.total) * 100) : 0}%`,
                background: role.color,
              }}
            />
          </div>
          {footnote && <p className="mt-1.5 text-[9px] text-white/30">{footnote}</p>}
        </div>

        {role.phases.map((ph) => {
          const label = CHECKLIST_PHASES.find((p) => p.id === ph.id)?.label ?? ph.id;
          const done = ph.items.filter((i) => state[i.id]?.checked).length;
          const shown = hideDone
            ? ph.items.filter((i) => !state[i.id]?.checked || keepShown.has(i.id))
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
                      onToggle={toggle}
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
    </div>
  );
}
