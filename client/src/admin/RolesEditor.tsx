import { useEffect, useId, useMemo, useRef, useState } from 'react';
import {
  mintTemplateId, type ChecklistRoleMeta, type CrisisTemplatesConfig,
} from '../crisis/templates/model';
import { useTemplatesStore } from '../crisis/templates/templatesStore';
import {
  HEX_COLOR_RE, LIMITS, cleanRoles, insertAfter, moveBefore, namedInError, nudge, removeById, roleIssues, roleUsage,
  rolesSignature, tidyText, updateById, type DraftIssue, type RoleField,
} from './draftOps';
import {
  ConfigGate, ConflictBanner, DragHandle, DropLine, EditorFooter, EditorHeader, IconButton, MOVE_SHORTCUT,
  dropIdAt, fieldCls, plural, pointerHalf, useDefaultTemplates, useDirtyFlag, useFocusQueue, useSaveShortcut, useUnitDraft,
  type FooterReset,
} from './editorUi';
import { resetChecklistRoles, saveChecklistRoles } from './templatesApi';

// ── Checklist roles editor ───────────────────────────────────────────────────
//
// Admin → Checklist roles: the positions the checklists are organized by
// (IC, GSOC, Safety, …) — code, title, color, and the "reports to / directs"
// lines shown under each role's header. One global list, saved as a unit.
// Built-in ids match the org chart's ICS roles, which is how an operator's
// assignment picks the checklist they land on. A role that checklist items
// still use can't be deleted (the server enforces it too).

const DRAG_TYPE = 'application/x-template-role';

/** Section colors of the org chart first, then a few distinct extras. */
const PALETTE: { color: string; name: string }[] = [
  { color: '#fbbf24', name: 'Command gold' },
  { color: '#f97316', name: 'Command staff orange' },
  { color: '#ef4444', name: 'Operations red' },
  { color: '#3b82f6', name: 'Planning blue' },
  { color: '#eab308', name: 'Logistics yellow' },
  { color: '#22c55e', name: 'Finance green' },
  { color: '#3ddcff', name: 'Cyan' },
  { color: '#a855f7', name: 'Purple' },
  { color: '#ec4899', name: 'Pink' },
  { color: '#14b8a6', name: 'Teal' },
  { color: '#94a3b8', name: 'Slate' },
];

const FIELD_LABEL: Record<RoleField, string> = {
  code: 'Code', title: 'Title', color: 'Color', reportsTo: 'Reports to', directs: 'Directs',
};

export function RolesEditor() {
  return <ConfigGate>{(config) => <RolesEditorBody config={config} />}</ConfigGate>;
}

/** The editor for a loaded config (exported for render tests). */
export function RolesEditorBody({ config }: { config: CrisisTemplatesConfig }) {
  const doc = config.checklistRoles;
  const draft = useUnitDraft('roles', doc.roles, doc.revision, rolesSignature);
  const roles = draft.value;
  const dirty = draft.edited;
  useDirtyFlag(dirty);

  const clean = useMemo(() => cleanRoles(roles), [roles]);
  const problems = useMemo(() => roleIssues(roles), [roles]);
  const usage = useMemo(() => roleUsage(config.checklistBlocks), [config.checklistBlocks]);
  const savedIds = useMemo(() => new Set(doc.roles.map((r) => r.id)), [doc.roles]);
  const defaults = useDefaultTemplates();
  const builtinIds = useMemo(() => new Set(defaults?.checklistRoles.roles.map((r) => r.id) ?? []), [defaults]);

  const [busy, setBusy] = useState<string | null>(null);
  const [serverError, setServerError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [dragId, setDragId] = useState<string | null>(null);
  const [dropBefore, setDropBefore] = useState<string | null | undefined>(undefined); // undefined = none

  useEffect(() => {
    if (!notice) return;
    const t = setTimeout(() => setNotice(null), 4000);
    return () => clearTimeout(t);
  }, [notice]);

  const rootRef = useRef<HTMLDivElement>(null);
  const focusSoon = useFocusQueue(rootRef);
  const rolesRef = useRef(roles);
  rolesRef.current = roles;
  const update = draft.update;

  const roleName = (r: ChecklistRoleMeta) => tidyText(r.title) || tidyText(r.code) || 'New role';

  // Footer list: whole-list problems first, then each field problem, role by role.
  const issues: DraftIssue[] = useMemo(() => [
    ...problems.general.map((message) => ({ id: null, message })),
    ...roles.flatMap((r) => {
      const f = problems.byRole[r.id];
      if (!f) return [];
      return (Object.keys(f) as RoleField[]).map((field) => ({
        id: `${field}:${r.id}`, message: `${roleName(r)} — ${FIELD_LABEL[field]}: ${f[field]}`,
      }));
    }),
  ], [problems, roles]);

  const serverFlagged = useMemo(
    () => new Set(serverError ? namedInError(serverError, roles.map((r) => ({ id: r.id, text: r.title }))) : []),
    [serverError, roles]
  );

  // ── Editing ────────────────────────────────────────────────────────────────

  const setField = (id: string, field: RoleField, value: string) =>
    update((list) => updateById(list, id, { [field]: value } as Partial<ChecklistRoleMeta>));

  const addRole = () => {
    const used = new Set(rolesRef.current.map((r) => r.color.toLowerCase()));
    const color = PALETTE.find((p) => !used.has(p.color))?.color ?? PALETTE[PALETTE.length - 1].color;
    const role: ChecklistRoleMeta = {
      id: mintTemplateId('r'), code: '', title: '', color, reportsTo: 'Incident Commander', directs: '',
    };
    update((list) => insertAfter(list, role, null));
    focusSoon(`code:${role.id}`);
  };

  const removeRole = (r: ChecklistRoleMeta) => {
    if ((usage.get(r.id)?.items ?? 0) > 0) return;
    if (savedIds.has(r.id)) {
      const extra = builtinIds.has(r.id)
        ? '\n\nIt is a built-in ICS position that matches the org chart — “Reset to default” brings it back.'
        : '';
      if (!window.confirm(`Remove “${roleName(r)}” from the checklist roles?${extra}`)) return;
    }
    const list = rolesRef.current;
    const i = list.findIndex((x) => x.id === r.id);
    const neighbour = list[i - 1] ?? list[i + 1];
    update((l) => removeById(l, r.id));
    focusSoon(neighbour ? `title:${neighbour.id}` : 'addrole');
  };

  const nudgeRole = (id: string, dir: -1 | 1, refocus: string) => {
    update((list) => nudge(list, id, dir));
    focusSoon(refocus, 'end', `title:${id}`);
  };

  // ── Save / discard / reset ─────────────────────────────────────────────────

  // Someone else saved since this draft started: the banner at the top asks
  // whose version wins — make sure the admin sees it, wherever they are.
  const announceConflict = () => {
    setServerError('Someone else saved the checklist roles while you were editing — choose “Load their version” or “Keep mine” at the top, then save.');
    rootRef.current?.scrollIntoView({ block: 'start', behavior: 'smooth' });
  };

  const savingRef = useRef(false);
  const save = async () => {
    if (savingRef.current || !dirty || problems.count > 0) return;
    if (draft.stale) { announceConflict(); return; }
    savingRef.current = true;
    setBusy('Saving…');
    setServerError(null);
    const res = await saveChecklistRoles(clean, draft.baseRevision);
    savingRef.current = false;
    setBusy(null);
    if (res.ok) {
      draft.rebase(res.config.checklistRoles.roles, res.config.checklistRoles.revision);
      setNotice('Saved');
    } else if (res.status === 409) {
      announceConflict();
      if (!res.config) void useTemplatesStore.getState().load();
    } else {
      setServerError(res.error);
    }
  };
  useSaveShortcut(() => { void save(); });

  const discard = () => {
    if (!dirty) return;
    if (!window.confirm('Discard your unsaved changes to the checklist roles?')) return;
    draft.discard();
    setServerError(null);
  };

  const reset = async () => {
    const unsaved = dirty ? '\n\nYour unsaved changes will be lost too.' : '';
    const ok = window.confirm(
      'Reset the checklist roles to the built-in ICS positions?\n\nCustom roles are removed and built-in ones get their ' +
      'original codes, titles and colors. If checklist items still use a custom role, the reset is refused.' + unsaved
    );
    if (!ok) return;
    setBusy('Resetting…');
    setServerError(null);
    const res = await resetChecklistRoles();
    setBusy(null);
    if (res.ok) {
      draft.replace(res.config.checklistRoles.roles, res.config.checklistRoles.revision);
      setNotice('Reset to the built-in roles');
    } else {
      setServerError(res.error);
    }
  };

  const resetAction: FooterReset | null = doc.custom ? { label: 'Reset to default', onClick: () => void reset() } : null;

  // ── Drag and drop ──────────────────────────────────────────────────────────

  const dragRef = useRef(dragId);
  dragRef.current = dragId;
  const endDrag = () => { setDragId(null); setDropBefore(undefined); };
  const onDragOverCard = (e: React.DragEvent<HTMLElement>, r: ChecklistRoleMeta) => {
    if (!dragRef.current) return;
    e.preventDefault();
    e.stopPropagation();
    e.dataTransfer.dropEffect = 'move';
    const list = rolesRef.current;
    const k = list.findIndex((x) => x.id === r.id);
    const before = pointerHalf(e, e.currentTarget) === 'before' ? r.id : list[k + 1]?.id ?? null;
    if (before !== dropBefore) setDropBefore(before);
  };
  const onDrop = (e: React.DragEvent) => {
    const id = dragRef.current;
    if (!id || dropBefore === undefined) return;
    e.preventDefault();
    e.stopPropagation();
    update((list) => moveBefore(list, id, dropBefore));
    endDrag();
  };
  const markerAt = (() => {
    if (!dragId || dropBefore === undefined) return undefined;
    const from = roles.findIndex((r) => r.id === dragId);
    const to = dropBefore === null ? roles.length : roles.findIndex((r) => r.id === dropBefore);
    return to === from || to === from + 1 ? undefined : dropBefore;
  })();

  const conflict = draft.stale && draft.edited && !busy;
  const totalItems = config.checklistBlocks.reduce((n, b) => n + b.items.length, 0);

  return (
    <div className="flex flex-1 flex-col">
      <div ref={rootRef} className="flex-1 px-4 py-5 md:px-6">
        <div className="mx-auto max-w-3xl">
          <EditorHeader
            eyebrow="Crisis templates"
            title="Checklist roles"
            subtitle="The positions checklists are organized by, in the order the role picker shows them."
            meta={doc}
          />

          {conflict && (
            <ConflictBanner
              what="the checklist roles"
              meta={doc}
              onLoadTheirs={() => {
                if (window.confirm('Replace your draft with their version? Your unsaved changes will be lost.')) {
                  draft.discard();
                  setServerError(null);
                }
              }}
              onKeepMine={() => { draft.rebase(doc.roles, doc.revision); setServerError(null); }}
            />
          )}

          {/* What the checklist tab's role picker will look like. */}
          <div className="mb-4 rounded-lg border border-white/8 bg-white/4 px-3 py-2.5">
            <p className="mb-1.5 text-[9px] font-bold uppercase tracking-[0.14em] text-white/30">Role picker preview</p>
            <div className="-mx-1 flex gap-1.5 overflow-x-auto px-1 pb-0.5">
              {clean.map((r) => (
                <span
                  key={r.id}
                  className="shrink-0 rounded-md border border-white/10 bg-white/4 px-2.5 py-1.5"
                  title={r.title}
                >
                  <span
                    className="block text-[10px] font-bold uppercase tracking-[0.12em]"
                    style={{ color: HEX_COLOR_RE.test(r.color) ? r.color : '#94a3b8' }}
                  >
                    {r.code || '—'}
                  </span>
                  <span className="block text-[9px] text-white/40">{usage.get(r.id)?.items ?? 0}</span>
                </span>
              ))}
            </div>
            <p className="mt-1.5 text-[9px] text-white/30">
              Numbers are checklist items using each role across all scopes ({plural(totalItems, 'item')} in total). An
              incident only shows roles that have items for it.
            </p>
          </div>

          <ul
            className="relative space-y-2.5"
            aria-label="Checklist roles"
            onDragOver={(e) => {
              // In a gap between cards (or below the last one).
              if (!dragRef.current) return;
              e.preventDefault();
              const before = dropIdAt(e.currentTarget, e.clientY);
              if (before !== dropBefore) setDropBefore(before);
            }}
            onDrop={onDrop}
          >
            {roles.map((r, i) => (
              <RoleCard
                key={r.id}
                role={r}
                index={i}
                count={roles.length}
                used={usage.get(r.id) ?? null}
                builtin={builtinIds.has(r.id)}
                saved={savedIds.has(r.id)}
                errors={problems.byRole[r.id] ?? {}}
                serverFlagged={serverFlagged.has(r.id)}
                markerBefore={markerAt === r.id}
                isDragging={dragId === r.id}
                onField={(field, value) => setField(r.id, field, value)}
                onNudge={(dir, refocus) => nudgeRole(r.id, dir, refocus)}
                onRemove={() => removeRole(r)}
                onDragStart={(e) => {
                  e.dataTransfer.effectAllowed = 'move';
                  e.dataTransfer.setData(DRAG_TYPE, r.id);
                  setDragId(r.id);
                }}
                onDragEnd={endDrag}
                onDragOver={(e) => onDragOverCard(e, r)}
                onDrop={onDrop}
              />
            ))}
            {markerAt === null && <DropLine at="bottom" />}
          </ul>

          <button
            type="button"
            data-focus-key="addrole"
            onClick={addRole}
            disabled={roles.length >= LIMITS.roles}
            className="mt-3 w-full rounded-lg border border-dashed border-white/12 px-3 py-2.5 text-[11px] text-white/45 transition hover:border-accent/40 hover:text-accent/85 disabled:opacity-40"
          >
            + Add role
          </button>

          <p className="mt-5 hidden text-[10px] leading-relaxed text-white/25 md:block">
            {MOVE_SHORTCUT} in any field moves that role · drag ⠿ to reorder. Renaming a role relabels it on every
            checklist; items stay attached to it. Changes reach open incidents as soon as you save.
          </p>
        </div>
      </div>

      <EditorFooter
        dirty={dirty}
        busy={busy}
        onSave={() => void save()}
        onDiscard={discard}
        reset={resetAction}
        error={serverError}
        onDismissError={() => setServerError(null)}
        issues={issues}
        onShowIssue={(key) => focusSoon(key, 'end')}
        notice={notice}
      />
    </div>
  );
}

// ── Role card ────────────────────────────────────────────────────────────────

function RoleCard({
  role, index, count, used, builtin, saved, errors, serverFlagged, markerBefore, isDragging,
  onField, onNudge, onRemove, onDragStart, onDragEnd, onDragOver, onDrop,
}: {
  role: ChecklistRoleMeta;
  index: number;
  count: number;
  used: { items: number; scopes: number } | null;
  builtin: boolean;
  saved: boolean;
  errors: Partial<Record<RoleField, string>>;
  serverFlagged: boolean;
  markerBefore: boolean;
  isDragging: boolean;
  onField: (field: RoleField, value: string) => void;
  onNudge: (dir: -1 | 1, refocus: string) => void;
  onRemove: () => void;
  onDragStart: (e: React.DragEvent) => void;
  onDragEnd: () => void;
  onDragOver: (e: React.DragEvent<HTMLElement>) => void;
  onDrop: (e: React.DragEvent) => void;
}) {
  const uid = useId();
  const cardRef = useRef<HTMLLIElement>(null);
  const inUse = (used?.items ?? 0) > 0;
  const color = HEX_COLOR_RE.test(role.color) ? role.color : '#94a3b8';

  const field = (f: Exclude<RoleField, 'color'>, label: string, opts: { max: number; placeholder: string; upper?: boolean }) => {
    const id = `${uid}-${f}`;
    const err = errors[f];
    return (
      <div className="min-w-0">
        <label htmlFor={id} className="mb-0.5 block text-[9px] font-bold uppercase tracking-[0.14em] text-white/30">{label}</label>
        <input
          id={id}
          type="text"
          data-focus-key={`${f}:${role.id}`}
          value={role[f]}
          onChange={(e) => onField(f, opts.upper ? e.target.value.toUpperCase() : e.target.value)}
          placeholder={opts.placeholder}
          maxLength={opts.max + 40}
          aria-invalid={!!err || undefined}
          aria-describedby={err ? `${id}-err` : undefined}
          className={`${fieldCls} w-full ${opts.upper ? 'font-bold tracking-[0.1em]' : ''} ${err ? '!border-red-400/60' : ''}`}
        />
        {err && <p id={`${id}-err`} className="mt-0.5 text-[10px] text-red-300/85">{err}</p>}
      </div>
    );
  };

  return (
    <li
      ref={cardRef}
      data-drop-id={role.id}
      onDragOver={onDragOver}
      onDrop={onDrop}
      onKeyDown={(e) => {
        // Alt+↑/↓ from any field moves the whole role and keeps the caret in that field.
        if (!e.altKey || e.ctrlKey || e.metaKey || (e.key !== 'ArrowUp' && e.key !== 'ArrowDown')) return;
        const key = (e.target as HTMLElement).dataset?.focusKey;
        if (!key) return;
        e.preventDefault();
        onNudge(e.key === 'ArrowUp' ? -1 : 1, key);
      }}
      className={`relative rounded-lg border bg-ink-900/60 transition-opacity ${
        serverFlagged ? 'border-red-400/40' : 'border-white/8'
      } ${isDragging ? 'opacity-40' : ''}`}
      style={{ borderLeft: `3px solid ${color}` }}
    >
      {markerBefore && <DropLine at="top" />}
      <div className="flex items-start gap-2 p-2.5">
        <div className="flex flex-col items-center gap-1 pt-4">
          <DragHandle label="Drag to reorder" rowRef={cardRef} onDragStart={onDragStart} onDragEnd={onDragEnd} />
        </div>
        <div className="pt-4">
          <ColorSwatch
            focusKey={`color:${role.id}`}
            value={role.color}
            onChange={(c) => onField('color', c)}
            label={`Color for ${tidyText(role.title) || 'this role'}`}
            invalid={!!errors.color}
          />
        </div>
        <div className="min-w-0 flex-1 space-y-2">
          <div className="grid gap-2 sm:grid-cols-[7rem_minmax(0,1fr)]">
            {field('code', 'Code', { max: LIMITS.roleCode, placeholder: 'e.g. GSOC', upper: true })}
            {field('title', 'Title', { max: LIMITS.roleTitle, placeholder: 'e.g. GSOC Support' })}
          </div>
          <div className="grid gap-2 sm:grid-cols-2">
            {field('reportsTo', 'Reports to', { max: LIMITS.roleText, placeholder: 'e.g. Incident Commander' })}
            {field('directs', 'Directs', { max: LIMITS.roleText, placeholder: 'e.g. GSOC operators on shift' })}
          </div>
          <p className="flex flex-wrap items-center gap-x-2 gap-y-0.5 text-[10px] text-white/35">
            {builtin && (
              <span className="rounded bg-white/8 px-1 text-[8px] font-bold uppercase tracking-wider text-white/45" title="Matches an org-chart ICS role">
                Built-in
              </span>
            )}
            {!saved && (
              <span className="rounded bg-amber-400/15 px-1 text-[8px] font-bold uppercase tracking-wider text-amber-300/85">New</span>
            )}
            <span>
              {inUse
                ? `Used by ${plural(used!.items, 'checklist item')} in ${plural(used!.scopes, 'scope')} — delete or move those items before removing this role`
                : 'No checklist items use this role yet'}
            </span>
            <span className="font-mono text-white/20" title="Role id (fixed)">{role.id}</span>
          </p>
        </div>
        <div className="flex shrink-0 flex-col gap-0.5 pt-3.5 sm:flex-row">
          <IconButton label="Move up" disabled={index === 0} focusKey={`up:${role.id}`} onClick={() => onNudge(-1, `up:${role.id}`)}>↑</IconButton>
          <IconButton label="Move down" disabled={index === count - 1} focusKey={`down:${role.id}`} onClick={() => onNudge(1, `down:${role.id}`)}>↓</IconButton>
          <IconButton
            label={inUse ? 'Can’t delete — checklist items use this role' : 'Delete role'}
            tone="danger"
            disabled={inUse}
            onClick={onRemove}
          >
            ✕
          </IconButton>
        </div>
      </div>
    </li>
  );
}

// ── Color picker ─────────────────────────────────────────────────────────────

function ColorSwatch({ focusKey, value, onChange, label, invalid }: {
  focusKey: string;
  value: string;
  onChange: (color: string) => void;
  label: string;
  invalid?: boolean;
}) {
  const [open, setOpen] = useState(false);
  const wrapRef = useRef<HTMLDivElement>(null);
  const buttonRef = useRef<HTMLButtonElement>(null);
  const popId = useId();
  const valid = HEX_COLOR_RE.test(value);

  useEffect(() => {
    if (!open) return;
    const onDown = (e: PointerEvent) => {
      if (!wrapRef.current?.contains(e.target as Node)) setOpen(false);
    };
    document.addEventListener('pointerdown', onDown);
    return () => document.removeEventListener('pointerdown', onDown);
  }, [open]);

  const choose = (c: string) => {
    onChange(c);
    setOpen(false);
    buttonRef.current?.focus();
  };

  return (
    <div ref={wrapRef} className="relative">
      <button
        ref={buttonRef}
        type="button"
        data-focus-key={focusKey}
        onClick={() => setOpen((o) => !o)}
        aria-haspopup="dialog"
        aria-expanded={open}
        aria-controls={open ? popId : undefined}
        aria-label={`${label}: ${valid ? value : 'none'}`}
        title={label}
        className={`grid h-8 w-8 place-items-center rounded-md border transition hover:border-white/40 ${
          invalid ? 'border-red-400/60' : 'border-white/15'
        }`}
      >
        <span className="h-5 w-5 rounded" style={{ background: valid ? value : 'transparent' }} aria-hidden />
      </button>
      {open && (
        <div
          id={popId}
          role="dialog"
          aria-label={label}
          onKeyDown={(e) => {
            if (e.key === 'Escape') {
              // Claim Esc so the admin page stays open.
              e.preventDefault();
              e.stopPropagation();
              setOpen(false);
              buttonRef.current?.focus();
            }
          }}
          className="absolute left-0 top-10 z-30 w-52 rounded-lg border border-white/12 bg-ink-800 p-2.5 shadow-panel"
        >
          <div className="grid grid-cols-6 gap-1.5">
            {PALETTE.map((p) => {
              const selected = valid && p.color === value.toLowerCase();
              return (
                <button
                  key={p.color}
                  type="button"
                  onClick={() => choose(p.color)}
                  aria-label={p.name}
                  aria-pressed={selected}
                  title={p.name}
                  className={`h-6 w-6 rounded border-2 transition ${selected ? 'border-white' : 'border-transparent hover:border-white/50'}`}
                  style={{ background: p.color }}
                />
              );
            })}
          </div>
          <label className="mt-2.5 flex items-center gap-2 text-[10px] text-white/50">
            <input
              type="color"
              value={valid ? value.toLowerCase() : '#94a3b8'}
              onChange={(e) => onChange(e.target.value)}
              className="h-6 w-8 cursor-pointer rounded border border-white/15 bg-transparent"
            />
            Custom color
            <span className="ml-auto font-mono text-white/35">{valid ? value.toLowerCase() : '—'}</span>
          </label>
        </div>
      )}
    </div>
  );
}
