import { memo, useCallback, useEffect, useId, useMemo, useRef, useState } from 'react';
import { ChecklistBoard } from '../crisis/ChecklistBoard';
import {
  CHECKLIST_PHASES, type ChecklistPhaseId, type ChecklistStateMap,
} from '../crisis/checklistTemplate';
import {
  checklistScopes, mintTemplateId, resolveChecklist, sameScope, scopeApplies, scopeKey,
  type ChecklistBlockItem, type ChecklistRoleMeta, type CrisisTemplatesConfig, type TemplateScope,
} from '../crisis/templates/model';
import { scopeAudience, scopeChipLabel, scopeLabel } from '../crisis/templates/scopeLabels';
import { useTemplatesStore } from '../crisis/templates/templatesStore';
import {
  PHASE_ORDER, checklistIssues, checklistSignature, cleanChecklistItems, insertChecklistItem, namedInError,
  moveChecklistItem, nudgeChecklistItem, phaseItems, removeById, roleItems, splitPastedLines, updateById,
  withChecklistBlock, type ChecklistDropTarget, type ScopeEntry,
} from './draftOps';
import {
  AutoTextarea, ConfigGate, ConflictBanner, DragHandle, DropLine, EditPreviewToggle, EditorFooter, EditorHeader,
  IconButton, MOVE_SHORTCUT, ScopedEditorLayout, fieldCls, plural, pointerHalf, useDefaultTemplates, useDirtyFlag,
  useFocusQueue, useSaveShortcut, useSelectedScope, useUnitDraft, type FooterReset,
} from './editorUi';
import { ScopeList } from './ScopeList';
import { ScopePicker } from './ScopePicker';
import { resetChecklistBlock, saveChecklistBlock } from './templatesApi';

// ── Checklist template editor ────────────────────────────────────────────────
//
// Admin → Checklists. Pick a scope on the left (General, a type, a property,
// or a type + property); edit its items grouped by ICS role and phase on the
// right. The whole block is one draft, saved (or reset to the built-in
// default) as a unit with the revision it was based on, so two admins can
// never silently overwrite each other. Preview resolves the checklist an
// incident would get — draft included — through the same resolveChecklist
// the incident tab uses.

const NO_ITEMS: ChecklistBlockItem[] = [];
const NO_STATE: ChecklistStateMap = {};
const DRAG_TYPE = 'application/x-template-item';

export function ChecklistEditor() {
  return <ConfigGate>{(config) => <ChecklistEditorBody config={config} />}</ConfigGate>;
}

/** Callbacks shared by every item row — one stable object, so rows can memo. */
interface ItemHandlers {
  setText: (id: string, text: string) => void;
  keyDown: (e: React.KeyboardEvent<HTMLTextAreaElement>, item: ChecklistBlockItem) => void;
  paste: (e: React.ClipboardEvent<HTMLTextAreaElement>, item: ChecklistBlockItem) => void;
  nudge: (id: string, dir: -1 | 1, refocus: string) => void;
  remove: (id: string) => void;
  dragStart: (e: React.DragEvent, item: ChecklistBlockItem) => void;
  dragEnd: () => void;
  dragOverRow: (e: React.DragEvent<HTMLElement>, item: ChecklistBlockItem) => void;
  dragOverPhase: (e: React.DragEvent, roleId: string, phase: ChecklistPhaseId) => void;
  drop: (e: React.DragEvent) => void;
}

/** The editor for a loaded config (exported for render tests). */
export function ChecklistEditorBody({ config }: { config: CrisisTemplatesConfig }) {
  const [scope, selectScope] = useSelectedScope();
  const key = scopeKey(scope);
  const block = useMemo(
    () => config.checklistBlocks.find((b) => sameScope(b.scope, scope)) ?? null,
    [config.checklistBlocks, scope]
  );
  const roles = config.checklistRoles.roles;
  const roleOrder = useMemo(() => roles.map((r) => r.id), [roles]);
  const roleIds = useMemo(() => new Set(roleOrder), [roleOrder]);

  const draft = useUnitDraft(key, block?.items ?? NO_ITEMS, block?.revision ?? 0, checklistSignature);
  const items = draft.value;
  const dirty = draft.edited;
  useDirtyFlag(dirty);

  const clean = useMemo(() => cleanChecklistItems(items, roleOrder), [items, roleOrder]);
  const issues = useMemo(() => checklistIssues(items, roleIds), [items, roleIds]);

  const defaults = useDefaultTemplates();
  // undefined = not known (defaults still loading / failed); null = this scope has no default.
  const defaultBlock = defaults ? defaults.checklistBlocks.find((b) => sameScope(b.scope, scope)) ?? null : undefined;

  const [busy, setBusy] = useState<string | null>(null);
  const [serverError, setServerError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [preview, setPreview] = useState(false);
  const [previewScope, setPreviewScope] = useState<TemplateScope>(scope);
  const [openRoles, setOpenRoles] = useState<ReadonlySet<string>>(() => new Set());
  const [collapsed, setCollapsed] = useState<ReadonlySet<string>>(() => new Set());
  const [dragging, setDragging] = useState<{ id: string; roleId: string } | null>(null);
  const [dropAt, setDropAt] = useState<ChecklistDropTarget | null>(null);
  // The role last worked on — the preview opens on it.
  const [lastRole, setLastRole] = useState<string | null>(null);
  const focusRole = useCallback((roleId: string) => setLastRole((r) => (r === roleId ? r : roleId)), []);

  // Per-scope UI state starts over when the scope changes.
  const [shownKey, setShownKey] = useState(key);
  if (shownKey !== key) {
    setShownKey(key);
    setServerError(null);
    setNotice(null);
    setOpenRoles(new Set());
    setPreviewScope(scope);
  }

  useEffect(() => {
    if (!notice) return;
    const t = setTimeout(() => setNotice(null), 4000);
    return () => clearTimeout(t);
  }, [notice]);

  const rootRef = useRef<HTMLDivElement>(null);
  const focusSoon = useFocusQueue(rootRef);
  const keyRef = useRef(key);
  keyRef.current = key;
  const itemsRef = useRef(items);
  itemsRef.current = items;
  const draggingRef = useRef(dragging);
  draggingRef.current = dragging;
  const dropRef = useRef(dropAt);
  dropRef.current = dropAt;

  // Roles shown as sections: those with items, those the admin just opened,
  // and — so nothing is ever hidden — items whose role no longer exists.
  const byRole = useMemo(() => {
    const m = new Map<string, number>();
    for (const it of items) m.set(it.roleId, (m.get(it.roleId) ?? 0) + 1);
    return m;
  }, [items]);
  const sectionRoles: ChecklistRoleMeta[] = useMemo(() => [
    ...roles.filter((r) => byRole.has(r.id) || openRoles.has(r.id)),
    ...[...byRole.keys()].filter((id) => !roleIds.has(id)).map((id) => ({
      id, code: '?', title: `Unknown role “${id}”`, color: '#94a3b8', reportsTo: '', directs: '',
    })),
  ], [roles, byRole, openRoles, roleIds]);
  const emptyRoles = roles.filter((r) => !byRole.has(r.id) && !openRoles.has(r.id));

  // Visual order of every item, for ↑/↓ focus movement and Backspace.
  const displayOrder = useMemo(
    () => sectionRoles.filter((r) => !collapsed.has(r.id)).flatMap((r) => roleItems(items, r.id).map((i) => i.id)),
    [sectionRoles, collapsed, items]
  );
  const orderRef = useRef(displayOrder);
  orderRef.current = displayOrder;

  const flagged = useMemo(() => {
    const s = new Set<string>();
    for (const i of issues) if (i.id) s.add(i.id);
    if (serverError) for (const id of namedInError(serverError, items)) s.add(id);
    return s;
  }, [issues, serverError, items]);

  // ── Editing ────────────────────────────────────────────────────────────────

  const update = draft.update;

  const addItem = useCallback((roleId: string, phase: ChecklistPhaseId) => {
    const item: ChecklistBlockItem = { id: mintTemplateId(), roleId, phase, text: '' };
    update((list) => insertChecklistItem(list, item));
    focusSoon(`item:${item.id}`, 'start');
  }, [update, focusSoon]);

  const openRole = (roleId: string) => {
    setOpenRoles((s) => new Set(s).add(roleId));
    setCollapsed((s) => { const n = new Set(s); n.delete(roleId); return n; });
    addItem(roleId, 'immediate');
  };

  const toggleRole = useCallback((roleId: string) => {
    setCollapsed((s) => {
      const n = new Set(s);
      if (n.has(roleId)) n.delete(roleId); else n.add(roleId);
      return n;
    });
  }, []);

  const handlers: ItemHandlers = useMemo(() => {
    const neighbour = (id: string, dir: -1 | 1): string | null => {
      const order = orderRef.current;
      const k = order.indexOf(id);
      return k < 0 ? null : order[k + dir] ?? null;
    };
    const remove = (id: string) => {
      const it = itemsRef.current.find((i) => i.id === id);
      if (!it) return;
      const prev = neighbour(id, -1);
      const next = neighbour(id, 1);
      update((list) => removeById(list, id));
      if (prev) focusSoon(`item:${prev}`, 'end');
      else if (next) focusSoon(`item:${next}`, 'start');
      else focusSoon(`add:${it.roleId}:${it.phase}`);
    };
    const insertLines = (item: ChecklistBlockItem, head: string, lines: string[]) => {
      // `head` stays in this item; each line becomes a new item below it.
      const created = lines.map((text) => ({ id: mintTemplateId(), roleId: item.roleId, phase: item.phase, text }));
      update((list) => {
        let next = updateById(list, item.id, { text: head });
        let anchor = item.id;
        for (const c of created) { next = insertChecklistItem(next, c, anchor); anchor = c.id; }
        return next;
      });
      const last = created[created.length - 1];
      if (last) focusSoon(`item:${last.id}`, lines.length === 1 ? 'start' : 'end');
    };
    return {
      setText: (id, text) => update((list) => updateById(list, id, { text })),
      keyDown: (e, item) => {
        if (e.nativeEvent.isComposing) return;
        const el = e.currentTarget;
        const plain = !e.altKey && !e.ctrlKey && !e.metaKey && !e.shiftKey;
        if (e.key === 'Enter' && plain) {
          // Split at the caret, like a list in a document: the rest of the line moves down.
          e.preventDefault();
          insertLines(item, el.value.slice(0, el.selectionStart), [el.value.slice(el.selectionEnd)]);
        } else if (e.key === 'Backspace' && plain && el.value === '') {
          e.preventDefault();
          remove(item.id);
        } else if (e.altKey && !e.ctrlKey && !e.metaKey && (e.key === 'ArrowUp' || e.key === 'ArrowDown')) {
          e.preventDefault();
          const caret = el.selectionStart;
          update((list) => nudgeChecklistItem(list, item.id, e.key === 'ArrowUp' ? -1 : 1));
          focusSoon(`item:${item.id}`, caret);
        } else if (e.key === 'ArrowUp' && plain && el.selectionStart === 0 && el.selectionEnd === 0) {
          const prev = neighbour(item.id, -1);
          if (prev) { e.preventDefault(); focusSoon(`item:${prev}`, 'end'); }
        } else if (e.key === 'ArrowDown' && plain && el.selectionStart === el.value.length && el.selectionEnd === el.value.length) {
          const next = neighbour(item.id, 1);
          if (next) { e.preventDefault(); focusSoon(`item:${next}`, 'start'); }
        }
      },
      paste: (e, item) => {
        const lines = splitPastedLines(e.clipboardData.getData('text/plain'));
        if (lines.length < 2) return; // a single line pastes normally
        e.preventDefault();
        const el = e.currentTarget;
        const before = el.value.slice(0, el.selectionStart);
        const after = el.value.slice(el.selectionEnd);
        const rest = lines.slice(1);
        rest[rest.length - 1] += after;
        insertLines(item, before + lines[0], rest);
      },
      nudge: (id, dir, refocus) => {
        update((list) => nudgeChecklistItem(list, id, dir));
        focusSoon(refocus, 'end', `item:${id}`);
      },
      remove,
      dragStart: (e, item) => {
        e.dataTransfer.effectAllowed = 'move';
        e.dataTransfer.setData(DRAG_TYPE, item.id);
        setDragging({ id: item.id, roleId: item.roleId });
      },
      dragEnd: () => { setDragging(null); setDropAt(null); },
      dragOverRow: (e, item) => {
        const d = draggingRef.current;
        if (!d) return;
        // Within the same role only (phases may change): anywhere else the
        // marker goes away and the drop is refused.
        if (d.roleId !== item.roleId) { e.stopPropagation(); if (dropRef.current) setDropAt(null); return; }
        e.preventDefault();
        e.stopPropagation();
        e.dataTransfer.dropEffect = 'move';
        const group = phaseItems(itemsRef.current, item.roleId, item.phase);
        const k = group.findIndex((i) => i.id === item.id);
        const beforeId = pointerHalf(e, e.currentTarget) === 'before' ? item.id : group[k + 1]?.id ?? null;
        const cur = dropRef.current;
        if (!cur || cur.roleId !== item.roleId || cur.phase !== item.phase || cur.beforeId !== beforeId) {
          setDropAt({ roleId: item.roleId, phase: item.phase, beforeId });
        }
      },
      dragOverPhase: (e, roleId, phase) => {
        const d = draggingRef.current;
        if (!d) return;
        if (d.roleId !== roleId) { if (dropRef.current) setDropAt(null); return; }
        e.preventDefault();
        e.dataTransfer.dropEffect = 'move';
        const cur = dropRef.current;
        if (!cur || cur.roleId !== roleId || cur.phase !== phase || cur.beforeId !== null) {
          setDropAt({ roleId, phase, beforeId: null });
        }
      },
      drop: (e) => {
        const d = draggingRef.current;
        const target = dropRef.current;
        if (!d || !target) return;
        e.preventDefault();
        e.stopPropagation();
        update((list) => moveChecklistItem(list, d.id, target));
        setDragging(null);
        setDropAt(null);
      },
    };
  }, [update, focusSoon]);

  // ── Save / discard / reset ─────────────────────────────────────────────────

  // Someone else saved since this draft started: the banner at the top asks
  // whose version wins — make sure the admin sees it, wherever they are.
  const announceConflict = () => {
    setServerError('Someone else saved this scope while you were editing — choose “Load their version” or “Keep mine” at the top, then save.');
    rootRef.current?.scrollIntoView({ block: 'start', behavior: 'smooth' });
  };

  const savingRef = useRef(false);
  const save = async () => {
    if (savingRef.current || !dirty || issues.length > 0) return;
    if (draft.stale) { announceConflict(); return; }
    savingRef.current = true;
    setBusy('Saving…');
    setServerError(null);
    const savedKey = key;
    const res = await saveChecklistBlock(scope, clean, draft.baseRevision);
    savingRef.current = false;
    setBusy(null);
    if (keyRef.current !== savedKey) return; // the admin moved on (and chose to discard)
    if (res.ok) {
      const b = res.config.checklistBlocks.find((x) => sameScope(x.scope, scope));
      draft.rebase(b?.items ?? NO_ITEMS, b?.revision ?? 0);
      setNotice(b ? 'Saved' : 'Saved — the scope is empty, so it was removed');
    } else if (res.status === 409) {
      announceConflict();
      // The conflict banner takes over (the store now holds their version).
      if (!res.config) void useTemplatesStore.getState().load();
    } else {
      setServerError(res.error);
    }
  };
  useSaveShortcut(() => { void save(); });

  const discard = () => {
    if (!dirty) return;
    if (!window.confirm(`Discard your unsaved changes to ${scopeLabel(scope, false)}?`)) return;
    draft.discard();
    setServerError(null);
  };

  const reset = async () => {
    const name = scopeLabel(scope, false);
    const unsaved = dirty ? '\n\nYour unsaved changes will be lost too.' : '';
    const message = defaultBlock === null
      ? `Delete the “${name}” checklist scope?\n\nIts ${plural(block?.items.length ?? 0, 'item')} will stop appearing on incidents. Items already checked stay on those incidents' records.${unsaved}`
      : `Reset “${name}” to the built-in default${defaultBlock ? ` (${plural(defaultBlock.items.length, 'item')})` : ''}?\n\nThe customized version is deleted for every incident that uses this scope.${defaultBlock ? '' : ' If the scope has no built-in default, it is removed.'}${unsaved}`;
    if (!window.confirm(message)) return;
    setBusy('Resetting…');
    setServerError(null);
    const savedKey = key;
    const res = await resetChecklistBlock(scope);
    setBusy(null);
    if (keyRef.current !== savedKey) return;
    if (res.ok) {
      const b = res.config.checklistBlocks.find((x) => sameScope(x.scope, scope));
      draft.replace(b?.items ?? NO_ITEMS, b?.revision ?? 0);
      setOpenRoles(new Set());
      setNotice(b ? 'Reset to the built-in default' : 'Scope deleted');
    } else {
      setServerError(res.error);
    }
  };

  const resetAction: FooterReset | null = block?.custom
    ? { label: defaultBlock === null ? 'Delete scope' : 'Reset to default', onClick: () => void reset() }
    : null;

  const showIssue = (id: string) => {
    const it = itemsRef.current.find((i) => i.id === id);
    if (it) setCollapsed((s) => { const n = new Set(s); n.delete(it.roleId); return n; });
    setPreview(false);
    focusSoon(`item:${id}`, 'end');
  };

  // ── Scope list ─────────────────────────────────────────────────────────────

  const entries: ScopeEntry[] = useMemo(() => {
    const list: ScopeEntry[] = config.checklistBlocks.map((b) => ({
      scope: b.scope, count: b.items.length, custom: b.custom,
    }));
    const i = list.findIndex((e) => sameScope(e.scope, scope));
    if (i >= 0) list[i] = { ...list[i], count: clean.length, dirty };
    else list.push({ scope, count: clean.length, custom: false, isNew: true, dirty });
    return list;
  }, [config.checklistBlocks, scope, clean.length, dirty]);

  // ── Preview ────────────────────────────────────────────────────────────────

  const previewTemplate = useMemo(() => {
    if (!preview) return null;
    return resolveChecklist(withChecklistBlock(config, scope, clean), previewScope.incidentType, previewScope.propertyId);
  }, [preview, config, scope, clean, previewScope]);

  const uid = useId();
  const sectionId = (roleId: string) => `${uid}-role-${roleId}`;
  const conflict = draft.stale && draft.edited && !busy;
  const isNew = !block;

  return (
    <ScopedEditorLayout
      scopeName={scopeLabel(scope)}
      renderList={(close) => (
        <ScopeList
          entries={entries}
          selected={scope}
          noun={['item', 'items']}
          onSelect={(s) => {
            const ok = selectScope(s);
            if (ok) close();
            return ok;
          }}
        />
      )}
    >
      <div ref={rootRef} className="flex-1 px-4 py-5 md:px-6">
        <div className="mx-auto max-w-3xl">
          <EditorHeader
            eyebrow="Checklist scope"
            title={scopeLabel(scope)}
            subtitle={scopeAudience(scope)}
            meta={block}
            isNew={isNew}
            note={
              block?.custom && defaultBlock ? (
                <span className="text-white/30">
                  · built-in default has {plural(defaultBlock.items.length, 'item')}
                  {block.items.length === 0 ? ' (hidden by this empty version)' : ''}
                </span>
              ) : null
            }
            actions={<EditPreviewToggle preview={preview} onChange={setPreview} />}
          />

          {conflict && (
            <ConflictBanner
              what="this scope"
              meta={block}
              onLoadTheirs={() => {
                if (window.confirm('Replace your draft with their version? Your unsaved changes will be lost.')) {
                  draft.discard();
                  setServerError(null);
                }
              }}
              onKeepMine={() => { draft.rebase(block?.items ?? NO_ITEMS, block?.revision ?? 0); setServerError(null); }}
            />
          )}

          {preview ? (
            <div>
              <div className="mb-3 rounded-lg border border-white/8 bg-white/4 p-3">
                <p className="mb-2 text-[11px] text-white/55">
                  What an incident would see{dirty ? ', including your unsaved changes' : ''}. Pick its type and property:
                </p>
                <ScopePicker
                  value={previewScope}
                  onChange={setPreviewScope}
                  typeLabel="Incident type"
                  propertyLabel="Property"
                  anyTypeText="Any type — general items only"
                  anyPropertyText="Any property — general items only"
                />
                {previewTemplate && (
                  <p className="mt-2 text-[10px] text-white/40">
                    Built from{' '}
                    <span className="text-white/60">
                      {checklistScopes(previewTemplate).map((s) => scopeChipLabel(s)).join(' + ') || 'nothing'}
                    </span>
                    {' · '}
                    {plural(previewTemplate.roles.reduce((n, r) => n + r.phases.reduce((m, p) => m + p.items.length, 0), 0), 'item')}
                    {' across '}
                    {plural(previewTemplate.roles.length, 'role')}
                  </p>
                )}
                {!scopeApplies(scope, previewScope.incidentType, previewScope.propertyId) && (
                  <p className="mt-1.5 text-[10px] text-amber-200/80">
                    An incident like this doesn’t get the {scopeLabel(scope)} items.{' '}
                    <button type="button" onClick={() => setPreviewScope(scope)} className="underline underline-offset-2 hover:text-amber-100">
                      Preview {scopeChipLabel(scope)} instead
                    </button>
                  </p>
                )}
              </div>
              {previewTemplate && previewTemplate.roles.length > 0 ? (
                <ChecklistBoard
                  key={scopeKey(previewScope)}
                  template={previewTemplate}
                  state={NO_STATE}
                  preferredRoleId={lastRole ?? undefined}
                />
              ) : (
                <p className="rounded-lg border border-dashed border-white/10 px-4 py-8 text-center text-[12px] text-white/35">
                  No checklist items for this combination.
                </p>
              )}
            </div>
          ) : (
            <div>
              {sectionRoles.length > 1 && (
                <div className="-mx-1 mb-3 flex gap-1.5 overflow-x-auto px-1 pb-1" aria-label="Jump to role">
                  {sectionRoles.map((r) => (
                    <button
                      key={r.id}
                      type="button"
                      onClick={() => document.getElementById(sectionId(r.id))?.scrollIntoView({ behavior: 'smooth', block: 'start' })}
                      className="shrink-0 rounded border border-white/10 bg-white/4 px-2 py-1 text-[10px] transition hover:bg-white/8"
                      title={`Jump to ${r.title}`}
                    >
                      <span className="font-bold tracking-[0.1em]" style={{ color: r.color }}>{r.code}</span>
                      <span className="ml-1.5 text-white/35">{byRole.get(r.id) ?? 0}</span>
                    </button>
                  ))}
                </div>
              )}

              {items.length === 0 && openRoles.size === 0 && (
                <div className="mb-4 rounded-lg border border-dashed border-white/12 px-4 py-6 text-center">
                  <p className="text-[12px] text-white/55">
                    {isNew ? 'This scope has no items yet.' : 'This scope is empty.'}
                  </p>
                  <p className="mt-1 text-[11px] text-white/35">Choose a role below to add the first item.</p>
                </div>
              )}

              <div className="space-y-3">
                {sectionRoles.map((r) => (
                  <RoleSection
                    key={r.id}
                    id={sectionId(r.id)}
                    role={r}
                    known={roleIds.has(r.id)}
                    items={items}
                    count={byRole.get(r.id) ?? 0}
                    collapsed={collapsed.has(r.id)}
                    onToggle={toggleRole}
                    onFocusRole={focusRole}
                    onAdd={addItem}
                    flagged={flagged}
                    dragging={dragging}
                    dropAt={dropAt}
                    h={handlers}
                  />
                ))}
              </div>

              {emptyRoles.length > 0 && (
                <div className="mt-5">
                  <p className="mb-1.5 text-[9px] font-bold uppercase tracking-[0.14em] text-white/30">
                    {sectionRoles.length > 0 ? 'Other roles — no items in this scope' : 'Roles'}
                  </p>
                  <div className="flex flex-wrap gap-1.5">
                    {emptyRoles.map((r) => (
                      <button
                        key={r.id}
                        type="button"
                        onClick={() => openRole(r.id)}
                        className="flex items-center gap-1.5 rounded border border-white/10 px-2.5 py-1.5 text-[11px] text-white/55 transition hover:border-white/25 hover:text-white/85"
                      >
                        <span className="h-2 w-2 rounded-full" style={{ background: r.color }} aria-hidden />
                        + Add items for {r.title}
                      </button>
                    ))}
                  </div>
                </div>
              )}

              <p className="mt-5 hidden text-[10px] leading-relaxed text-white/25 md:block">
                Enter adds an item below · Backspace in an empty item removes it · {MOVE_SHORTCUT} moves an item
                (also between phases) · paste a list to add one item per line · drag ⠿ to reorder. Empty items are
                ignored when saving.
              </p>
            </div>
          )}
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
        onShowIssue={showIssue}
        notice={notice}
      />
    </ScopedEditorLayout>
  );
}

// ── Role section ─────────────────────────────────────────────────────────────

function RoleSection({ id, role, known, items, count, collapsed, onToggle, onFocusRole, onAdd, flagged, dragging, dropAt, h }: {
  id: string;
  role: ChecklistRoleMeta;
  known: boolean;
  items: ChecklistBlockItem[];
  count: number;
  collapsed: boolean;
  onToggle: (roleId: string) => void;
  onFocusRole: (roleId: string) => void;
  onAdd: (roleId: string, phase: ChecklistPhaseId) => void;
  flagged: ReadonlySet<string>;
  dragging: { id: string; roleId: string } | null;
  dropAt: ChecklistDropTarget | null;
  h: ItemHandlers;
}) {
  const bodyId = `${id}-body`;
  return (
    <section
      id={id}
      aria-label={`${role.title} checklist items`}
      onFocusCapture={() => onFocusRole(role.id)}
      className="scroll-mt-4 overflow-hidden rounded-lg border border-white/8 bg-ink-900/60"
      style={{ borderLeft: `3px solid ${role.color}` }}
    >
      <div className="flex items-center gap-2 px-3 py-2">
        <button
          type="button"
          onClick={() => onToggle(role.id)}
          aria-expanded={!collapsed}
          aria-controls={bodyId}
          className="flex min-w-0 flex-1 items-baseline gap-2 text-left"
        >
          <span className={`inline-block w-3 shrink-0 text-[10px] text-white/35 transition-transform ${collapsed ? '' : 'rotate-90'}`} aria-hidden>
            ▸
          </span>
          <span className="shrink-0 text-[11px] font-bold uppercase tracking-[0.14em]" style={{ color: role.color }}>
            {role.code}
          </span>
          <span className="truncate text-[13px] font-medium text-white/85">{role.title}</span>
        </button>
        <span className="shrink-0 text-[10px] text-white/35">{plural(count, 'item')}</span>
      </div>
      {!known && (
        <p className="border-t border-white/6 bg-red-500/8 px-3 py-1.5 text-[10px] text-red-200/80">
          This role is no longer in the checklist roles, so these items can’t be saved — delete them, or add the role
          back under Checklist roles.
        </p>
      )}
      {!collapsed && (
        <div id={bodyId}>
          {CHECKLIST_PHASES.map((p) => (
            <PhaseList
              key={p.id}
              role={role}
              phase={p.id}
              label={p.label}
              items={phaseItems(items, role.id, p.id)}
              onAdd={onAdd}
              flagged={flagged}
              dragging={dragging}
              dropAt={dropAt}
              h={h}
            />
          ))}
        </div>
      )}
    </section>
  );
}

function PhaseList({ role, phase, label, items, onAdd, flagged, dragging, dropAt, h }: {
  role: ChecklistRoleMeta;
  phase: ChecklistPhaseId;
  label: string;
  items: ChecklistBlockItem[];
  onAdd: (roleId: string, phase: ChecklistPhaseId) => void;
  flagged: ReadonlySet<string>;
  dragging: { id: string; roleId: string } | null;
  dropAt: ChecklistDropTarget | null;
  h: ItemHandlers;
}) {
  const p = PHASE_ORDER.indexOf(phase);
  const here = dropAt && dropAt.roleId === role.id && dropAt.phase === phase ? dropAt : null;
  // A drop that would leave the item where it is gets no marker.
  const dragIdx = dragging ? items.findIndex((i) => i.id === dragging.id) : -1;
  let markerBefore: string | null | undefined; // undefined = no marker; null = at the end
  if (here) {
    const beforeIdx = here.beforeId === null ? items.length : items.findIndex((i) => i.id === here.beforeId);
    const noop = dragIdx >= 0 && (beforeIdx === dragIdx || beforeIdx === dragIdx + 1);
    if (!noop) markerBefore = here.beforeId;
  }
  const dragActive = dragging?.roleId === role.id;

  return (
    <div className="border-t border-white/6">
      <div className="flex items-baseline gap-2 px-3 pb-1 pt-2">
        <span className={`text-[10px] font-bold uppercase tracking-[0.14em] ${phase === 'immediate' ? 'text-red-300/80' : 'text-white/45'}`}>
          {label}
        </span>
        <span className="text-[9px] text-white/30">{items.length}</span>
      </div>
      <div
        className="px-2 pb-2"
        onDragOver={(e) => h.dragOverPhase(e, role.id, phase)}
        onDrop={h.drop}
      >
        <div className="relative">
          {items.length === 0 && (
            <p className={`rounded px-3 py-1.5 text-[11px] italic ${dragActive ? 'border border-dashed border-accent/30 text-accent/60' : 'text-white/25'}`}>
              {dragActive ? 'Drop here' : 'No items in this phase'}
            </p>
          )}
          {items.map((item, k) => (
            <ItemRow
              key={item.id}
              item={item}
              label={`${role.code} ${label.split(' — ')[0]} item ${k + 1}`}
              canUp={!(k === 0 && p === 0)}
              canDown={!(k === items.length - 1 && p === PHASE_ORDER.length - 1)}
              flagged={flagged.has(item.id)}
              markerBefore={markerBefore === item.id}
              isDragging={dragging?.id === item.id}
              h={h}
            />
          ))}
          {markerBefore === null && <DropLine at="bottom" />}
        </div>
        <button
          type="button"
          data-focus-key={`add:${role.id}:${phase}`}
          onClick={() => onAdd(role.id, phase)}
          className="ml-5 mt-1 rounded px-1.5 py-1 text-[11px] text-white/35 transition hover:bg-white/4 hover:text-accent/85"
        >
          + Add item
        </button>
      </div>
    </div>
  );
}

const ItemRow = memo(function ItemRow({ item, label, canUp, canDown, flagged, markerBefore, isDragging, h }: {
  item: ChecklistBlockItem;
  label: string;
  canUp: boolean;
  canDown: boolean;
  flagged: boolean;
  markerBefore: boolean;
  isDragging: boolean;
  h: ItemHandlers;
}) {
  const rowRef = useRef<HTMLDivElement>(null);
  const len = item.text.trim().length;
  return (
    <div
      ref={rowRef}
      onDragOver={(e) => h.dragOverRow(e, item)}
      onDrop={h.drop}
      className={`relative flex items-start gap-1 rounded-md px-1 py-0.5 transition-opacity ${isDragging ? 'opacity-40' : ''}`}
    >
      {markerBefore && <DropLine at="top" />}
      <DragHandle label="Drag to reorder" rowRef={rowRef} onDragStart={(e) => h.dragStart(e, item)} onDragEnd={h.dragEnd} />
      <div className="min-w-0 flex-1">
        <AutoTextarea
          data-focus-key={`item:${item.id}`}
          aria-label={label}
          aria-invalid={flagged || undefined}
          value={item.text}
          onChange={(e) => h.setText(item.id, e.target.value)}
          onKeyDown={(e) => h.keyDown(e, item)}
          onPaste={(e) => h.paste(e, item)}
          placeholder="A concise, checkable action…"
          className={`${fieldCls} scroll-my-24 ${flagged ? '!border-red-400/60' : ''}`}
        />
        {len > 400 && (
          <p className={`mt-0.5 text-right text-[9px] ${len > 500 ? 'text-red-300/85' : 'text-white/30'}`}>{len}/500</p>
        )}
      </div>
      <IconButton label="Move up" disabled={!canUp} focusKey={`up:${item.id}`} onClick={() => h.nudge(item.id, -1, `up:${item.id}`)}>
        ↑
      </IconButton>
      <IconButton label="Move down" disabled={!canDown} focusKey={`down:${item.id}`} onClick={() => h.nudge(item.id, 1, `down:${item.id}`)}>
        ↓
      </IconButton>
      <IconButton label="Delete item" tone="danger" onClick={() => h.remove(item.id)}>
        ✕
      </IconButton>
    </div>
  );
});
