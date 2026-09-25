import { memo, useEffect, useMemo, useRef, useState } from 'react';
import {
  intakeScopes, mintTemplateId, resolveIntake, sameScope, scopeApplies, scopeKey,
  type CrisisTemplatesConfig, type IntakeBlockGroup, type IntakeBlockQuestion, type TemplateScope,
} from '../crisis/templates/model';
import { scopeAudience, scopeChipLabel, scopeLabel } from '../crisis/templates/scopeLabels';
import { useTemplatesStore } from '../crisis/templates/templatesStore';
import {
  LIMITS, cleanIntakeGroups, insertAfter, insertQuestion, intakeIssues, intakeSignature,
  mentionedIds, moveBefore, moveQuestion, nudge, nudgeQuestion, removeById, removeQuestion, splitPastedLines,
  tidyText, updateById, updateQuestion, withIntakeBlock, type QuestionDropTarget, type ScopeEntry,
} from './draftOps';
import {
  AutoTextarea, ConfigGate, ConflictBanner, DragHandle, DropLine, EditPreviewToggle, EditorFooter, EditorHeader,
  IconButton, MOVE_SHORTCUT, ScopedEditorLayout, fieldCls, plural, pointerHalf, useDefaultTemplates, useDirtyFlag,
  useFocusQueue, useSaveShortcut, useSelectedScope, useUnitDraft, type FooterReset,
} from './editorUi';
import { ScopeList } from './ScopeList';
import { ScopePicker } from './ScopePicker';
import { resetIntakeBlock, saveIntakeBlock } from './templatesApi';

// ── Intake question editor ───────────────────────────────────────────────────
//
// Admin → Intake questions. Same shape as the checklist editor: a scope list,
// one draft block per scope (named groups of questions), saved or reset as a
// unit. Incidents concatenate every applicable scope's groups General → Type
// → Property → Type + Property and number the questions 1…n across the lot,
// which is what Preview shows.

const NO_GROUPS: IntakeBlockGroup[] = [];
const QUESTION_DRAG = 'application/x-template-question';
const GROUP_DRAG = 'application/x-template-group';

type Drag = { kind: 'group'; id: string } | { kind: 'question'; id: string };
type Drop = { kind: 'group'; beforeId: string | null } | ({ kind: 'question' } & QuestionDropTarget);

const groupLetter = (i: number) => (i < 26 ? String.fromCharCode(65 + i) : String(i + 1));

export function IntakeEditor() {
  return <ConfigGate>{(config) => <IntakeEditorBody config={config} />}</ConfigGate>;
}

interface QuestionHandlers {
  setText: (id: string, text: string) => void;
  keyDown: (e: React.KeyboardEvent<HTMLTextAreaElement>, q: IntakeBlockQuestion, groupId: string) => void;
  paste: (e: React.ClipboardEvent<HTMLTextAreaElement>, q: IntakeBlockQuestion, groupId: string) => void;
  nudge: (id: string, dir: -1 | 1, refocus: string) => void;
  remove: (id: string, groupId: string) => void;
  dragStart: (e: React.DragEvent, q: IntakeBlockQuestion) => void;
  dragEnd: () => void;
  dragOverRow: (e: React.DragEvent<HTMLElement>, q: IntakeBlockQuestion, groupId: string) => void;
  drop: (e: React.DragEvent) => void;
}

function IntakeEditorBody({ config }: { config: CrisisTemplatesConfig }) {
  const [scope, selectScope] = useSelectedScope();
  const key = scopeKey(scope);
  const block = useMemo(
    () => config.intakeBlocks.find((b) => sameScope(b.scope, scope)) ?? null,
    [config.intakeBlocks, scope]
  );

  const draft = useUnitDraft(key, block?.groups ?? NO_GROUPS, block?.revision ?? 0, intakeSignature);
  const groups = draft.value;
  const dirty = draft.edited;
  useDirtyFlag(dirty);

  const clean = useMemo(() => cleanIntakeGroups(groups), [groups]);
  const questionCount = useMemo(() => clean.reduce((n, g) => n + g.questions.length, 0), [clean]);
  const issues = useMemo(() => intakeIssues(groups), [groups]);

  const defaults = useDefaultTemplates();
  const defaultBlock = defaults ? defaults.intakeBlocks.find((b) => sameScope(b.scope, scope)) ?? null : undefined;

  const [busy, setBusy] = useState<string | null>(null);
  const [serverError, setServerError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [preview, setPreview] = useState(false);
  const [previewScope, setPreviewScope] = useState<TemplateScope>(scope);
  const [drag, setDrag] = useState<Drag | null>(null);
  const [dropAt, setDropAt] = useState<Drop | null>(null);

  const [shownKey, setShownKey] = useState(key);
  if (shownKey !== key) {
    setShownKey(key);
    setServerError(null);
    setNotice(null);
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
  const groupsRef = useRef(groups);
  groupsRef.current = groups;
  const dragRef = useRef(drag);
  dragRef.current = drag;
  const dropRef = useRef(dropAt);
  dropRef.current = dropAt;

  const flagged = useMemo(() => {
    const s = new Set<string>();
    for (const i of issues) if (i.id) s.add(i.id);
    if (serverError) {
      const all = groups.flatMap((g) => [g.id, ...g.questions.map((q) => q.id)]);
      for (const id of mentionedIds(serverError, all)) s.add(id);
    }
    return s;
  }, [issues, serverError, groups]);

  const update = draft.update;

  // ── Questions ──────────────────────────────────────────────────────────────

  const qHandlers: QuestionHandlers = useMemo(() => {
    const order = () => groupsRef.current.flatMap((g) => g.questions.map((q) => q.id));
    const neighbour = (id: string, dir: -1 | 1) => {
      const o = order();
      const k = o.indexOf(id);
      return k < 0 ? null : o[k + dir] ?? null;
    };
    const insertLines = (q: IntakeBlockQuestion, groupId: string, head: string, lines: string[]) => {
      const created = lines.map((text) => ({ id: mintTemplateId(), text }));
      update((gs) => {
        let next = updateQuestion(gs, q.id, head);
        let anchor = q.id;
        for (const c of created) { next = insertQuestion(next, groupId, c, anchor); anchor = c.id; }
        return next;
      });
      const last = created[created.length - 1];
      if (last) focusSoon(`q:${last.id}`, lines.length === 1 ? 'start' : 'end');
    };
    const remove = (id: string, groupId: string) => {
      const prev = neighbour(id, -1);
      const next = neighbour(id, 1);
      update((gs) => removeQuestion(gs, id));
      if (prev) focusSoon(`q:${prev}`, 'end');
      else if (next) focusSoon(`q:${next}`, 'start');
      else focusSoon(`addq:${groupId}`);
    };
    return {
      setText: (id, text) => update((gs) => updateQuestion(gs, id, text)),
      keyDown: (e, q, groupId) => {
        if (e.nativeEvent.isComposing) return;
        const el = e.currentTarget;
        const plain = !e.altKey && !e.ctrlKey && !e.metaKey && !e.shiftKey;
        if (e.key === 'Enter' && plain) {
          e.preventDefault();
          insertLines(q, groupId, el.value.slice(0, el.selectionStart), [el.value.slice(el.selectionEnd)]);
        } else if (e.key === 'Backspace' && plain && el.value === '') {
          e.preventDefault();
          remove(q.id, groupId);
        } else if (e.altKey && !e.ctrlKey && !e.metaKey && (e.key === 'ArrowUp' || e.key === 'ArrowDown')) {
          e.preventDefault();
          const caret = el.selectionStart;
          update((gs) => nudgeQuestion(gs, q.id, e.key === 'ArrowUp' ? -1 : 1));
          focusSoon(`q:${q.id}`, caret);
        } else if (e.key === 'ArrowUp' && plain && el.selectionStart === 0 && el.selectionEnd === 0) {
          const prev = neighbour(q.id, -1);
          if (prev) { e.preventDefault(); focusSoon(`q:${prev}`, 'end'); }
        } else if (e.key === 'ArrowDown' && plain && el.selectionStart === el.value.length && el.selectionEnd === el.value.length) {
          const next = neighbour(q.id, 1);
          if (next) { e.preventDefault(); focusSoon(`q:${next}`, 'start'); }
        }
      },
      paste: (e, q, groupId) => {
        const lines = splitPastedLines(e.clipboardData.getData('text/plain'));
        if (lines.length < 2) return;
        e.preventDefault();
        const el = e.currentTarget;
        const before = el.value.slice(0, el.selectionStart);
        const after = el.value.slice(el.selectionEnd);
        const rest = lines.slice(1);
        rest[rest.length - 1] += after;
        insertLines(q, groupId, before + lines[0], rest);
      },
      nudge: (id, dir, refocus) => {
        update((gs) => nudgeQuestion(gs, id, dir));
        focusSoon(refocus, 'end', `q:${id}`);
      },
      remove,
      dragStart: (e, q) => {
        e.dataTransfer.effectAllowed = 'move';
        e.dataTransfer.setData(QUESTION_DRAG, q.id);
        setDrag({ kind: 'question', id: q.id });
      },
      dragEnd: () => { setDrag(null); setDropAt(null); },
      dragOverRow: (e, q, groupId) => {
        if (dragRef.current?.kind !== 'question') return;
        e.preventDefault();
        e.stopPropagation();
        e.dataTransfer.dropEffect = 'move';
        const g = groupsRef.current.find((x) => x.id === groupId);
        const k = g ? g.questions.findIndex((x) => x.id === q.id) : -1;
        const beforeId = pointerHalf(e, e.currentTarget) === 'before' ? q.id : g?.questions[k + 1]?.id ?? null;
        const cur = dropRef.current;
        if (!cur || cur.kind !== 'question' || cur.groupId !== groupId || cur.beforeId !== beforeId) {
          setDropAt({ kind: 'question', groupId, beforeId });
        }
      },
      drop: (e) => {
        const d = dragRef.current;
        const t = dropRef.current;
        if (!d || !t || d.kind !== t.kind) return;
        e.preventDefault();
        e.stopPropagation();
        if (d.kind === 'question' && t.kind === 'question') {
          update((gs) => moveQuestion(gs, d.id, t));
        } else if (d.kind === 'group' && t.kind === 'group') {
          update((gs) => moveBefore(gs, d.id, t.beforeId));
        }
        setDrag(null);
        setDropAt(null);
      },
    };
  }, [update, focusSoon]);

  // ── Groups ─────────────────────────────────────────────────────────────────

  const addGroup = () => {
    const g: IntakeBlockGroup = { id: mintTemplateId('xg'), label: '', questions: [{ id: mintTemplateId(), text: '' }] };
    update((gs) => insertAfter(gs, g, null));
    focusSoon(`glabel:${g.id}`);
  };

  const addQuestion = (groupId: string) => {
    const q = { id: mintTemplateId(), text: '' };
    update((gs) => insertQuestion(gs, groupId, q));
    focusSoon(`q:${q.id}`, 'start');
  };

  const removeGroup = (g: IntakeBlockGroup) => {
    const asked = g.questions.filter((q) => tidyText(q.text)).length;
    if (asked > 0 && !window.confirm(`Delete the group “${tidyText(g.label) || 'Unnamed group'}” and its ${plural(asked, 'question')}?`)) return;
    const i = groupsRef.current.findIndex((x) => x.id === g.id);
    const neighbour = groupsRef.current[i - 1] ?? groupsRef.current[i + 1];
    update((gs) => removeById(gs, g.id));
    focusSoon(neighbour ? `glabel:${neighbour.id}` : 'addgroup');
  };

  const nudgeGroup = (id: string, dir: -1 | 1) => {
    update((gs) => nudge(gs, id, dir));
    focusSoon(`g${dir < 0 ? 'up' : 'down'}:${id}`, 'end', `glabel:${id}`);
  };

  const onGroupDragStart = (e: React.DragEvent, g: IntakeBlockGroup) => {
    e.dataTransfer.effectAllowed = 'move';
    e.dataTransfer.setData(GROUP_DRAG, g.id);
    setDrag({ kind: 'group', id: g.id });
  };

  const onGroupDragOver = (e: React.DragEvent<HTMLElement>, g: IntakeBlockGroup) => {
    const d = dragRef.current;
    if (!d) return;
    // Claim the event: the list around the cards would otherwise re-target
    // the drop to "end of list" as it bubbles.
    e.stopPropagation();
    if (d.kind === 'question') {
      // Over a group's header / empty body: land at the end of that group.
      e.preventDefault();
      e.dataTransfer.dropEffect = 'move';
      const cur = dropRef.current;
      if (!cur || cur.kind !== 'question' || cur.groupId !== g.id || cur.beforeId !== null) {
        setDropAt({ kind: 'question', groupId: g.id, beforeId: null });
      }
      return;
    }
    e.preventDefault();
    e.dataTransfer.dropEffect = 'move';
    const list = groupsRef.current;
    const k = list.findIndex((x) => x.id === g.id);
    const beforeId = pointerHalf(e, e.currentTarget) === 'before' ? g.id : list[k + 1]?.id ?? null;
    const cur = dropRef.current;
    if (!cur || cur.kind !== 'group' || cur.beforeId !== beforeId) setDropAt({ kind: 'group', beforeId });
  };

  const onGroupLabelKeyDown = (e: React.KeyboardEvent<HTMLInputElement>, g: IntakeBlockGroup) => {
    if (e.key !== 'Enter' || e.nativeEvent.isComposing) return;
    e.preventDefault();
    if (g.questions[0]) focusSoon(`q:${g.questions[0].id}`, 'end');
    else addQuestion(g.id);
  };

  // ── Save / discard / reset ─────────────────────────────────────────────────

  const savingRef = useRef(false);
  const save = async () => {
    if (savingRef.current || !dirty || issues.length > 0) return;
    savingRef.current = true;
    setBusy('Saving…');
    setServerError(null);
    const savedKey = key;
    const res = await saveIntakeBlock(scope, clean, draft.baseRevision);
    savingRef.current = false;
    setBusy(null);
    if (keyRef.current !== savedKey) return;
    if (res.ok) {
      const b = res.config.intakeBlocks.find((x) => sameScope(x.scope, scope));
      draft.rebase(b?.groups ?? NO_GROUPS, b?.revision ?? 0);
      setNotice(b ? 'Saved' : 'Saved — the scope is empty, so it was removed');
    } else if (res.status === 409) {
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
    const savedCount = block?.groups.reduce((n, g) => n + g.questions.length, 0) ?? 0;
    const defaultCount = defaultBlock?.groups.reduce((n, g) => n + g.questions.length, 0) ?? 0;
    const message = defaultBlock === null
      ? `Delete the “${name}” intake scope?\n\nIts ${plural(savedCount, 'question')} will stop appearing on incidents. Answers already given stay on those incidents.${unsaved}`
      : `Reset “${name}” to the built-in default${defaultBlock ? ` (${plural(defaultCount, 'question')})` : ''}?\n\nThe customized version is deleted for every incident that uses this scope.${unsaved}`;
    if (!window.confirm(message)) return;
    setBusy('Resetting…');
    setServerError(null);
    const savedKey = key;
    const res = await resetIntakeBlock(scope);
    setBusy(null);
    if (keyRef.current !== savedKey) return;
    if (res.ok) {
      const b = res.config.intakeBlocks.find((x) => sameScope(x.scope, scope));
      draft.replace(b?.groups ?? NO_GROUPS, b?.revision ?? 0);
      setNotice(b ? 'Reset to the built-in default' : 'Scope deleted');
    } else {
      setServerError(res.error);
    }
  };

  const resetAction: FooterReset | null = block?.custom
    ? { label: defaultBlock === null ? 'Delete scope' : 'Reset to default', onClick: () => void reset() }
    : null;

  const showIssue = (id: string) => {
    setPreview(false);
    const isGroup = groupsRef.current.some((g) => g.id === id);
    focusSoon(isGroup ? `glabel:${id}` : `q:${id}`, 'end');
  };

  // ── Scope list & preview ───────────────────────────────────────────────────

  const entries: ScopeEntry[] = useMemo(() => {
    const list: ScopeEntry[] = config.intakeBlocks.map((b) => ({
      scope: b.scope, count: b.groups.reduce((n, g) => n + g.questions.length, 0), custom: b.custom,
    }));
    const i = list.findIndex((e) => sameScope(e.scope, scope));
    if (i >= 0) list[i] = { ...list[i], count: questionCount, dirty };
    else list.push({ scope, count: questionCount, custom: false, isNew: true, dirty });
    return list;
  }, [config.intakeBlocks, scope, questionCount, dirty]);

  const previewTemplate = useMemo(() => {
    if (!preview) return null;
    return resolveIntake(withIntakeBlock(config, scope, clean), previewScope.incidentType, previewScope.propertyId);
  }, [preview, config, scope, clean, previewScope]);

  const conflict = draft.stale && draft.edited && !busy;
  const isNew = !block;
  const defaultCount = defaultBlock ? defaultBlock.groups.reduce((n, g) => n + g.questions.length, 0) : 0;

  // Question numbers within this scope (incidents renumber across scopes).
  let running = 0;
  const numbered = groups.map((g) => g.questions.map(() => (running += 1)));
  const groupDropMarker = (id: string | null) => {
    if (drag?.kind !== 'group' || dropAt?.kind !== 'group' || dropAt.beforeId !== id) return false;
    const from = groups.findIndex((g) => g.id === drag.id);
    const to = id === null ? groups.length : groups.findIndex((g) => g.id === id);
    return to !== from && to !== from + 1;
  };

  return (
    <ScopedEditorLayout
      scopeName={scopeLabel(scope)}
      renderList={(close) => (
        <ScopeList
          entries={entries}
          selected={scope}
          noun={['question', 'questions']}
          onSelect={(s) => { if (selectScope(s)) close(); }}
        />
      )}
    >
      <div ref={rootRef} className="flex-1 px-4 py-5 md:px-6">
        <div className="mx-auto max-w-3xl">
          <EditorHeader
            eyebrow="Intake scope"
            title={scopeLabel(scope)}
            subtitle={scopeAudience(scope)}
            meta={block}
            isNew={isNew}
            note={
              block?.custom && defaultBlock ? (
                <span className="text-white/30">
                  · built-in default has {plural(defaultCount, 'question')}
                  {block.groups.length === 0 ? ' (hidden by this empty version)' : ''}
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
                if (window.confirm('Replace your draft with their version? Your unsaved changes will be lost.')) draft.discard();
              }}
              onKeepMine={() => draft.rebase(block?.groups ?? NO_GROUPS, block?.revision ?? 0)}
            />
          )}

          {preview ? (
            <div>
              <div className="mb-3 rounded-lg border border-white/8 bg-white/4 p-3">
                <p className="mb-2 text-[11px] text-white/55">
                  The questionnaire an incident would get{dirty ? ', including your unsaved changes' : ''}. Pick its type and property:
                </p>
                <ScopePicker
                  value={previewScope}
                  onChange={setPreviewScope}
                  typeLabel="Incident type"
                  propertyLabel="Property"
                  anyTypeText="Any type — general questions only"
                  anyPropertyText="Any property — general questions only"
                />
                {previewTemplate && (
                  <p className="mt-2 text-[10px] text-white/40">
                    Built from{' '}
                    <span className="text-white/60">
                      {intakeScopes(previewTemplate).map((s) => scopeChipLabel(s)).join(' + ') || 'nothing'}
                    </span>
                    {' · '}
                    {plural(previewTemplate.groups.reduce((n, g) => n + g.questions.length, 0), 'question')}
                    {' in '}
                    {plural(previewTemplate.groups.length, 'group')}
                  </p>
                )}
                {!scopeApplies(scope, previewScope.incidentType, previewScope.propertyId) && (
                  <p className="mt-1.5 text-[10px] text-amber-200/80">
                    An incident like this doesn’t get the {scopeLabel(scope)} questions.{' '}
                    <button type="button" onClick={() => setPreviewScope(scope)} className="underline underline-offset-2 hover:text-amber-100">
                      Preview {scopeChipLabel(scope)} instead
                    </button>
                  </p>
                )}
              </div>
              {previewTemplate && previewTemplate.groups.length > 0 ? (
                <div className="space-y-4">
                  {previewTemplate.groups.map((g, gi) => {
                    const mine = !!g.scope && sameScope(g.scope, scope);
                    return (
                      <section
                        key={g.id}
                        className={`rounded-lg border px-3.5 py-3 ${mine ? 'border-accent/30 bg-accent/5' : 'border-white/8 bg-white/4'}`}
                      >
                        <div className="mb-2 flex flex-wrap items-baseline gap-x-2 gap-y-1">
                          <h4 className="text-[11px] font-bold uppercase tracking-[0.14em] text-white/55">
                            <span className="mr-1.5 text-white/25">{groupLetter(gi)}.</span>
                            {g.label}
                          </h4>
                          {g.scope && (
                            <span className={`ml-auto rounded px-1.5 py-px text-[9px] ${mine ? 'bg-accent/15 text-accent/80' : 'bg-white/6 text-white/40'}`}>
                              {scopeChipLabel(g.scope)}
                            </span>
                          )}
                        </div>
                        <ol className="space-y-1.5">
                          {g.questions.map((q) => (
                            <li key={q.id} className="flex gap-1.5 text-[12px] leading-snug text-white/75">
                              <span className="w-6 shrink-0 text-right text-white/30">{q.n}.</span>
                              <span>{q.text}</span>
                            </li>
                          ))}
                        </ol>
                      </section>
                    );
                  })}
                </div>
              ) : (
                <p className="rounded-lg border border-dashed border-white/10 px-4 py-8 text-center text-[12px] text-white/35">
                  No intake questions for this combination.
                </p>
              )}
            </div>
          ) : (
            <div>
              {groups.length === 0 && (
                <div className="mb-4 rounded-lg border border-dashed border-white/12 px-4 py-6 text-center">
                  <p className="text-[12px] text-white/55">{isNew ? 'This scope has no questions yet.' : 'This scope is empty.'}</p>
                  <p className="mt-1 text-[11px] text-white/35">Add a group to start — e.g. “Guests & staff affected”.</p>
                </div>
              )}

              <div
                className="relative space-y-3"
                onDragOver={(e) => {
                  // Below the last card: move the group to the end.
                  if (dragRef.current?.kind !== 'group') return;
                  e.preventDefault();
                  if (dropRef.current?.kind !== 'group' || dropRef.current.beforeId !== null) {
                    setDropAt({ kind: 'group', beforeId: null });
                  }
                }}
                onDrop={qHandlers.drop}
              >
                {groups.map((g, gi) => (
                  <GroupCard
                    key={g.id}
                    group={g}
                    index={gi}
                    count={groups.length}
                    numbers={numbered[gi]}
                    flagged={flagged}
                    markerBefore={groupDropMarker(g.id)}
                    isDragging={drag?.kind === 'group' && drag.id === g.id}
                    questionDrag={drag?.kind === 'question' ? drag.id : null}
                    questionDrop={dropAt?.kind === 'question' && dropAt.groupId === g.id ? dropAt : null}
                    onRename={(label) => update((gs) => updateById(gs, g.id, { label }))}
                    onLabelKeyDown={(e) => onGroupLabelKeyDown(e, g)}
                    onNudge={(dir) => nudgeGroup(g.id, dir)}
                    onRemove={() => removeGroup(g)}
                    onAddQuestion={() => addQuestion(g.id)}
                    onDragStart={(e) => onGroupDragStart(e, g)}
                    onDragOver={(e) => onGroupDragOver(e, g)}
                    h={qHandlers}
                  />
                ))}
                {groupDropMarker(null) && <DropLine at="bottom" />}
              </div>

              <button
                type="button"
                data-focus-key="addgroup"
                onClick={addGroup}
                disabled={groups.length >= LIMITS.intakeGroups}
                className="mt-3 w-full rounded-lg border border-dashed border-white/12 px-3 py-2.5 text-[11px] text-white/45 transition hover:border-accent/40 hover:text-accent/85 disabled:opacity-40"
              >
                + Add group
              </button>

              <p className="mt-5 hidden text-[10px] leading-relaxed text-white/25 md:block">
                Enter adds a question below · Backspace in an empty question removes it · {MOVE_SHORTCUT} moves a
                question (also into the next group) · paste a list to add one question per line · drag ⠿ to reorder
                questions and groups. Numbers here count this scope only — incidents number questions across every
                scope that applies.
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

// ── Group card ───────────────────────────────────────────────────────────────

function GroupCard({
  group, index, count, numbers, flagged, markerBefore, isDragging, questionDrag, questionDrop,
  onRename, onLabelKeyDown, onNudge, onRemove, onAddQuestion, onDragStart, onDragOver, h,
}: {
  group: IntakeBlockGroup;
  index: number;
  count: number;
  numbers: number[];
  flagged: ReadonlySet<string>;
  markerBefore: boolean;
  isDragging: boolean;
  questionDrag: string | null;
  questionDrop: QuestionDropTarget | null;
  onRename: (label: string) => void;
  onLabelKeyDown: (e: React.KeyboardEvent<HTMLInputElement>) => void;
  onNudge: (dir: -1 | 1) => void;
  onRemove: () => void;
  onAddQuestion: () => void;
  onDragStart: (e: React.DragEvent) => void;
  onDragOver: (e: React.DragEvent<HTMLElement>) => void;
  h: QuestionHandlers;
}) {
  const cardRef = useRef<HTMLElement>(null);
  const qs = group.questions;
  const labelLen = tidyText(group.label).length;
  const labelFlagged = flagged.has(group.id);

  // Marker for a question drop, suppressed when it would change nothing.
  const dragIdx = questionDrag ? qs.findIndex((q) => q.id === questionDrag) : -1;
  let markerAt: string | null | undefined;
  if (questionDrop) {
    const to = questionDrop.beforeId === null ? qs.length : qs.findIndex((q) => q.id === questionDrop.beforeId);
    if (!(dragIdx >= 0 && (to === dragIdx || to === dragIdx + 1))) markerAt = questionDrop.beforeId;
  }

  return (
    <section
      ref={cardRef}
      aria-label={`Group ${index + 1}: ${tidyText(group.label) || 'unnamed'}`}
      onDragOver={onDragOver}
      onDrop={h.drop}
      className={`relative rounded-lg border bg-ink-900/60 transition-opacity ${
        labelFlagged ? 'border-red-400/40' : 'border-white/8'
      } ${isDragging ? 'opacity-40' : ''}`}
    >
      {markerBefore && <DropLine at="top" />}
      <div className="flex items-center gap-1 border-b border-white/6 px-2 py-1.5">
        <DragHandle label="Drag to reorder the group" rowRef={cardRef} onDragStart={onDragStart} onDragEnd={h.dragEnd} />
        <input
          type="text"
          data-focus-key={`glabel:${group.id}`}
          value={group.label}
          onChange={(e) => onRename(e.target.value)}
          onKeyDown={onLabelKeyDown}
          aria-label={`Group ${index + 1} name`}
          aria-invalid={labelFlagged || undefined}
          placeholder="Group name — e.g. Life safety"
          maxLength={LIMITS.groupLabel + 40}
          className={`min-w-0 flex-1 rounded border border-transparent bg-transparent px-2 py-1 text-[12px] font-bold uppercase tracking-[0.1em] text-white/75 placeholder:font-normal placeholder:normal-case placeholder:tracking-normal placeholder-white/25 outline-none transition hover:border-white/10 focus:border-accent/40 focus:bg-white/4 ${
            labelFlagged ? '!border-red-400/60' : ''
          }`}
        />
        {labelLen > LIMITS.groupLabel - 20 && (
          <span className={`shrink-0 text-[9px] ${labelLen > LIMITS.groupLabel ? 'text-red-300/85' : 'text-white/30'}`}>
            {labelLen}/{LIMITS.groupLabel}
          </span>
        )}
        <span className="hidden shrink-0 px-1 text-[10px] text-white/30 sm:inline">{plural(qs.length, 'question')}</span>
        <IconButton label="Move group up" disabled={index === 0} focusKey={`gup:${group.id}`} onClick={() => onNudge(-1)}>↑</IconButton>
        <IconButton label="Move group down" disabled={index === count - 1} focusKey={`gdown:${group.id}`} onClick={() => onNudge(1)}>↓</IconButton>
        <IconButton label="Delete group" tone="danger" onClick={onRemove}>✕</IconButton>
      </div>

      <div className="px-2 py-2">
        <div className="relative">
          {qs.length === 0 && (
            <p className={`rounded px-3 py-1.5 text-[11px] italic ${questionDrag ? 'border border-dashed border-accent/30 text-accent/60' : 'text-white/25'}`}>
              {questionDrag ? 'Drop here' : 'No questions in this group — it won’t appear on incidents'}
            </p>
          )}
          {qs.map((q, k) => (
            <QuestionRow
              key={q.id}
              question={q}
              groupId={group.id}
              n={numbers[k]}
              canUp={!(index === 0 && k === 0)}
              canDown={!(index === count - 1 && k === qs.length - 1)}
              flagged={flagged.has(q.id)}
              markerBefore={markerAt === q.id}
              isDragging={questionDrag === q.id}
              h={h}
            />
          ))}
          {markerAt === null && <DropLine at="bottom" />}
        </div>
        <button
          type="button"
          data-focus-key={`addq:${group.id}`}
          onClick={onAddQuestion}
          disabled={qs.length >= LIMITS.groupQuestions}
          className="ml-9 mt-1 rounded px-1.5 py-1 text-[11px] text-white/35 transition hover:bg-white/4 hover:text-accent/85 disabled:opacity-40"
        >
          + Add question
        </button>
      </div>
    </section>
  );
}

const QuestionRow = memo(function QuestionRow({ question, groupId, n, canUp, canDown, flagged, markerBefore, isDragging, h }: {
  question: IntakeBlockQuestion;
  groupId: string;
  n: number;
  canUp: boolean;
  canDown: boolean;
  flagged: boolean;
  markerBefore: boolean;
  isDragging: boolean;
  h: QuestionHandlers;
}) {
  const rowRef = useRef<HTMLDivElement>(null);
  const len = question.text.trim().length;
  return (
    <div
      ref={rowRef}
      onDragOver={(e) => h.dragOverRow(e, question, groupId)}
      onDrop={h.drop}
      className={`relative flex items-start gap-1 rounded-md px-1 py-0.5 transition-opacity ${isDragging ? 'opacity-40' : ''}`}
    >
      {markerBefore && <DropLine at="top" />}
      <DragHandle label="Drag to reorder" rowRef={rowRef} onDragStart={(e) => h.dragStart(e, question)} onDragEnd={h.dragEnd} />
      <span className="w-5 shrink-0 pt-2 text-right text-[10px] tabular-nums text-white/25" aria-hidden>{n}.</span>
      <div className="min-w-0 flex-1">
        <AutoTextarea
          data-focus-key={`q:${question.id}`}
          aria-label={`Question ${n}`}
          aria-invalid={flagged || undefined}
          value={question.text}
          onChange={(e) => h.setText(question.id, e.target.value)}
          onKeyDown={(e) => h.keyDown(e, question, groupId)}
          onPaste={(e) => h.paste(e, question, groupId)}
          placeholder="A question to ask the first caller…"
          className={`${fieldCls} scroll-my-24 ${flagged ? '!border-red-400/60' : ''}`}
        />
        {len > LIMITS.questionText - 100 && (
          <p className={`mt-0.5 text-right text-[9px] ${len > LIMITS.questionText ? 'text-red-300/85' : 'text-white/30'}`}>
            {len}/{LIMITS.questionText}
          </p>
        )}
      </div>
      <IconButton label="Move up" disabled={!canUp} focusKey={`up:${question.id}`} onClick={() => h.nudge(question.id, -1, `up:${question.id}`)}>
        ↑
      </IconButton>
      <IconButton label="Move down" disabled={!canDown} focusKey={`down:${question.id}`} onClick={() => h.nudge(question.id, 1, `down:${question.id}`)}>
        ↓
      </IconButton>
      <IconButton label="Delete question" tone="danger" onClick={() => h.remove(question.id, groupId)}>
        ✕
      </IconButton>
    </div>
  );
});
