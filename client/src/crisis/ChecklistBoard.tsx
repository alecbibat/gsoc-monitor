import { useState } from 'react';
import {
  CHECKLIST_PHASES, roleProgress,
  type ChecklistRoleDef, type ChecklistStateMap, type ChecklistTemplate,
} from './checklistTemplate';

// ── ICS role checklist board ─────────────────────────────────────────────────
// Shared by the editor's Checklists tab and the share page's Checklists tab:
// pick a role, work its phases, tap to check items off. Purely presentational
// (template + state in, toggles out) and store-free — the share page must not
// pull crisisStore into its bundle.

function fmtToggleTime(iso: string): string {
  try {
    return new Date(iso).toLocaleString('en-US', {
      month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit',
    });
  } catch {
    return iso;
  }
}

function ItemRow({ id, text, state, onToggle, disabled }: {
  id: string;
  text: string;
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
      <span className="min-w-0 flex-1">
        <span className={`block text-[13px] leading-snug ${checked ? 'text-white/45 line-through decoration-white/25' : 'text-white/85'}`}>
          {text}
        </span>
        {/* The point of the feature: when it was checked (or unchecked), by whom */}
        {state && (
          <span className={`mt-0.5 block text-[10px] ${checked ? 'text-accent-ok/70' : 'text-amber-300/60'}`}>
            {checked ? '✓ Checked' : '↺ Unchecked'} {fmtToggleTime(state.at)}
            {state.by ? <span className="text-white/35"> · {state.by}</span> : null}
          </span>
        )}
      </span>
    </button>
  );
}

export function ChecklistBoard({ template, state, onToggle, disabled = false, footnote }: {
  template: ChecklistTemplate;
  state: ChecklistStateMap;
  /** Absent = read-only board. */
  onToggle?: (itemId: string, checked: boolean) => void;
  /** Render toggles inert (archived incident, revoked link, …). */
  disabled?: boolean;
  /** Small line under the role header (e.g. who the toggles record as). */
  footnote?: string;
}) {
  const [roleId, setRoleId] = useState(template.roles[0]?.id ?? '');
  const role: ChecklistRoleDef | undefined =
    template.roles.find((r) => r.id === roleId) ?? template.roles[0];

  if (!role) return null;
  const progress = roleProgress(role, state);

  return (
    <div>
      {/* Role picker — horizontal scroll on phones */}
      <div className="-mx-1 flex gap-1.5 overflow-x-auto px-1 pb-2">
        {template.roles.map((r) => {
          const p = roleProgress(r, state);
          const selected = r.id === role.id;
          return (
            <button
              key={r.id}
              onClick={() => setRoleId(r.id)}
              className={`shrink-0 rounded-md border px-2.5 py-1.5 text-left transition ${
                selected ? 'bg-white/10' : 'border-white/10 bg-white/4 hover:bg-white/8'
              }`}
              style={selected ? { borderColor: `${r.color}80` } : undefined}
              title={r.title}
            >
              <span className="block text-[10px] font-bold uppercase tracking-[0.12em]" style={{ color: r.color }}>
                {r.code}
              </span>
              <span className={`block text-[9px] ${p.done === p.total ? 'text-accent-ok/80' : 'text-white/40'}`}>
                {p.done}/{p.total}
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
            <span><span className="text-white/25">Reports to:</span> {role.reportsTo}</span>
            <span><span className="text-white/25">Directs:</span> {role.directs}</span>
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
          return (
            <div key={ph.id} className="border-b border-white/6 last:border-b-0">
              <div className="flex items-baseline gap-2 bg-white/4 px-4 py-1.5">
                <span className={`text-[10px] font-bold uppercase tracking-[0.14em] ${
                  ph.id === 'immediate' ? 'text-red-300/80' : 'text-white/50'
                }`}>
                  {label}
                </span>
                <span className="text-[9px] text-white/30">{done}/{ph.items.length}</span>
              </div>
              <div className="divide-y divide-white/4 px-1 py-1">
                {ph.items.map((item) => (
                  <ItemRow
                    key={item.id}
                    id={item.id}
                    text={item.text}
                    state={state[item.id]}
                    onToggle={onToggle}
                    disabled={disabled}
                  />
                ))}
              </div>
            </div>
          );
        })}
      </div>
      <p className="mt-2 text-[9px] text-white/25">Checklist template: {template.source}</p>
    </div>
  );
}
