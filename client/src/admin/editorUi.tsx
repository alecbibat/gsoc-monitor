import {
  forwardRef, useCallback, useEffect, useId, useLayoutEffect, useMemo, useRef, useState,
  type CSSProperties, type ReactNode, type RefObject, type TextareaHTMLAttributes,
} from 'react';
import {
  GENERAL_SCOPE, sameScope,
  type BlockMeta, type CrisisTemplatesConfig, type TemplateScope,
} from '../crisis/templates/model';
import { useTemplatesStore } from '../crisis/templates/templatesStore';
import { useAdminPageStore } from './adminPageStore';
import { confirmDiscardIfDirty, useAdminDirtyStore } from './dirtyGuard';
import { fetchDefaultTemplates } from './templatesApi';
import type { DraftIssue } from './draftOps';

// ── Shared pieces of the admin template editors ──────────────────────────────
//
// The checklist, intake and roles editors work the same way: the effective
// config comes from the templates store, the admin edits a LOCAL draft of one
// unit (a scope's block, or the role list), and saving sends the whole unit
// with the revision the draft was based on. The hooks here own that life
// cycle — draft vs saved, a newer save arriving from elsewhere, the page's
// unsaved-changes flag, Ctrl/Cmd+S — and the components the three share.

// ── Config loading ───────────────────────────────────────────────────────────

/**
 * Renders `children` with the effective config once there is one. Always
 * refreshes on mount: an admin about to edit should start from the latest
 * saved version (the store keeps showing the last good config meanwhile).
 */
export function ConfigGate({ children }: { children: (config: CrisisTemplatesConfig) => ReactNode }) {
  const config = useTemplatesStore((s) => s.config);
  const status = useTemplatesStore((s) => s.status);
  const error = useTemplatesStore((s) => s.error);
  const load = useTemplatesStore((s) => s.load);
  useEffect(() => { void load(); }, [load]);

  if (!config) {
    if (status === 'error') {
      return (
        <div className="flex flex-1 items-center justify-center p-6">
          <div role="alert" className="max-w-sm rounded-lg border border-red-400/25 bg-red-500/8 px-4 py-3 text-center">
            <p className="text-[12px] font-medium text-red-200/90">Could not load the crisis templates</p>
            {error && <p className="mt-1 text-[11px] text-red-200/60">{error}</p>}
            <button
              onClick={() => void load()}
              className="mt-3 rounded border border-white/15 px-3 py-1.5 text-[11px] text-white/70 transition hover:border-white/30 hover:text-white"
            >
              Try again
            </button>
          </div>
        </div>
      );
    }
    return (
      <div className="flex flex-1 items-center justify-center p-6" role="status" aria-live="polite">
        <span className="flex items-center gap-2 text-[11px] text-white/40">
          <span className="h-3 w-3 animate-spin rounded-full border-2 border-white/15 border-t-accent/70" aria-hidden />
          Loading templates…
        </span>
      </div>
    );
  }
  return (
    <>
      {error && (
        <div role="status" className="flex flex-wrap items-center gap-x-3 gap-y-1 border-b border-amber-400/20 bg-amber-400/8 px-4 py-1.5 text-[10px] text-amber-200/80 md:px-6">
          <span>Could not refresh the templates ({error}) — showing the version loaded earlier.</span>
          <button onClick={() => void load()} className="underline decoration-amber-200/40 underline-offset-2 hover:text-amber-100">
            Retry
          </button>
        </div>
      )}
      {children(config)}
    </>
  );
}

let defaultsPromise: Promise<CrisisTemplatesConfig | null> | null = null;

/**
 * The built-in defaults, fetched once per page load (they only change with a
 * deploy). null while loading or when the fetch failed — callers then fall
 * back to wording that does not depend on them.
 */
export function useDefaultTemplates(): CrisisTemplatesConfig | null {
  const [defaults, setDefaults] = useState<CrisisTemplatesConfig | null>(null);
  useEffect(() => {
    let alive = true;
    if (!defaultsPromise) {
      defaultsPromise = fetchDefaultTemplates().then((r) => {
        if (r.ok) return r.config;
        defaultsPromise = null; // try again next time an editor opens
        return null;
      });
    }
    void defaultsPromise.then((c) => { if (alive) setDefaults(c); });
    return () => { alive = false; };
  }, []);
  return defaults;
}

// ── Draft life cycle ─────────────────────────────────────────────────────────

interface UnitDraftState<V> {
  /** Which unit this is a draft of (scope key, or 'roles'). */
  key: string;
  /** Revision of the saved version the draft started from — sent as baseRevision. */
  baseRevision: number;
  /** That saved version's content. */
  base: V;
  value: V;
}

export interface UnitDraft<V> {
  value: V;
  baseRevision: number;
  /** The draft differs (by content) from the version it was based on. */
  edited: boolean;
  /** A different version has been saved since the draft was based on it. */
  stale: boolean;
  update: (fn: (v: V) => V) => void;
  /** Throw the draft away and start again from what is saved now. */
  discard: () => void;
  /** Keep the draft's content but base it on `base` @ `revision` (after a save, or "keep mine"). */
  rebase: (base: V, revision: number) => void;
  /** Replace draft and base alike (after a reset). */
  replace: (value: V, revision: number) => void;
}

/**
 * Local draft of one saved unit. Switching `key` starts a fresh draft; a newer
 * saved revision (another admin, the SSE `templates` reload) is adopted
 * silently while the draft is untouched, and reported as `stale` once it has
 * edits — the editor then asks whose version wins instead of overwriting
 * either. `signature` must be a stable (module-level) function.
 */
export function useUnitDraft<V>(key: string, saved: V, savedRevision: number, signature: (v: V) => string): UnitDraft<V> {
  const init = (): UnitDraftState<V> => ({ key, baseRevision: savedRevision, base: saved, value: saved });
  const [state, setState] = useState<UnitDraftState<V>>(init);
  const latest = useRef({ key, saved, savedRevision });
  latest.current = { key, saved, savedRevision };

  // Adjusting state during render (React re-renders before committing):
  // no frame ever shows one scope's header over another scope's draft.
  let draft = state;
  if (draft.key !== key) {
    draft = init();
    setState(draft);
  }
  const baseSig = useMemo(() => signature(draft.base), [draft.base]); // eslint-disable-line react-hooks/exhaustive-deps
  const valueSig = useMemo(() => signature(draft.value), [draft.value]); // eslint-disable-line react-hooks/exhaustive-deps
  const edited = baseSig !== valueSig;
  const stale = savedRevision !== draft.baseRevision;
  if (stale && !edited) {
    draft = init();
    setState(draft);
  }

  const update = useCallback((fn: (v: V) => V) => {
    setState((d) => {
      const value = fn(d.value);
      return value === d.value ? d : { ...d, value };
    });
  }, []);
  const discard = useCallback(() => {
    const l = latest.current;
    setState({ key: l.key, baseRevision: l.savedRevision, base: l.saved, value: l.saved });
  }, []);
  const rebase = useCallback((base: V, revision: number) => {
    setState((d) => ({ ...d, base, baseRevision: revision }));
  }, []);
  const replace = useCallback((value: V, revision: number) => {
    setState({ key: latest.current.key, baseRevision: revision, base: value, value });
  }, []);

  return { value: draft.value, baseRevision: draft.baseRevision, edited, stale, update, discard, rebase, replace };
}

/** Mirror an editor's unsaved state into the page's guard; cleared on unmount. */
export function useDirtyFlag(dirty: boolean) {
  useEffect(() => { useAdminDirtyStore.getState().setDirty(dirty); }, [dirty]);
  useEffect(() => () => useAdminDirtyStore.getState().setDirty(false), []);
}

/** Ctrl+S / ⌘S while the editor is mounted (the browser's "save page" never fires). */
export function useSaveShortcut(onSave: () => void) {
  const ref = useRef(onSave);
  ref.current = onSave;
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if ((e.ctrlKey || e.metaKey) && !e.altKey && !e.shiftKey && e.key.toLowerCase() === 's') {
        e.preventDefault();
        ref.current();
      }
    };
    // Document CAPTURE phase: the admin page stops every keydown at the
    // document's bubble phase (so typing never reaches the map's window-level
    // shortcuts), which means a window listener here would never fire.
    document.addEventListener('keydown', onKey, true);
    return () => document.removeEventListener('keydown', onKey, true);
  }, []);
}

const IS_MAC = typeof navigator !== 'undefined' && /Mac|iPhone|iPad|iPod/i.test(navigator.platform || navigator.userAgent);
export const SAVE_SHORTCUT = IS_MAC ? '⌘S' : 'Ctrl+S';
export const MOVE_SHORTCUT = IS_MAC ? '⌥↑/↓' : 'Alt+↑/↓';

/**
 * The scope the editor shows. Starts from the admin page's scope (set when the
 * page was opened from an incident) and writes back to it, so Checklists and
 * Intake stay on the same scope as the admin moves between them. Switching
 * away from unsaved edits asks first; returns false when the admin declined.
 */
export function useSelectedScope(): [TemplateScope, (next: TemplateScope) => boolean] {
  const [scope, setScope] = useState<TemplateScope>(() => useAdminPageStore.getState().scope ?? GENERAL_SCOPE);
  const current = useRef(scope);
  current.current = scope;
  const requested = useAdminPageStore((s) => s.scope);

  // Re-scoped from outside while open (openAdmin from another incident).
  useEffect(() => {
    if (!requested || sameScope(requested, current.current)) return;
    if (confirmDiscardIfDirty()) setScope(requested);
    else useAdminPageStore.setState({ scope: current.current });
  }, [requested]);

  const select = useCallback((next: TemplateScope) => {
    if (sameScope(next, current.current)) return true;
    if (!confirmDiscardIfDirty()) return false;
    current.current = next;
    setScope(next);
    useAdminPageStore.setState({ scope: next });
    return true;
  }, []);

  return [scope, select];
}

/**
 * Focus an element by its `data-focus-key` once it exists — after the render
 * that adds it (Enter → new item), or re-focus one React moved (a reorder
 * detaches the node and drops focus). `caret` places the text cursor.
 */
export function useFocusQueue(rootRef: RefObject<HTMLElement>) {
  const pending = useRef<{ key: string; caret: 'start' | 'end' | number; fallback?: string; at: number } | null>(null);
  const flush = useCallback(() => {
    const p = pending.current;
    const root = rootRef.current;
    if (!p || !root) return;
    // A request whose element never appeared (e.g. inside a collapsed
    // section) must not steal focus much later.
    if (performance.now() - p.at > 1000) { pending.current = null; return; }
    const find = (key: string) => root.querySelector<HTMLElement>(`[data-focus-key="${key}"]`);
    let el = find(p.key);
    // A ↑/↓ button that just became disabled (top / bottom reached) can't
    // hold focus; hand it to the fallback (the moved row's text field).
    if (el instanceof HTMLButtonElement && el.disabled && p.fallback) el = find(p.fallback);
    if (!el) return;
    pending.current = null;
    el.focus();
    if (el instanceof HTMLTextAreaElement || (el instanceof HTMLInputElement && el.type === 'text')) {
      const pos = p.caret === 'start' ? 0 : p.caret === 'end' ? el.value.length : Math.min(p.caret, el.value.length);
      el.setSelectionRange(pos, pos);
    }
  }, [rootRef]);
  useLayoutEffect(() => { flush(); });
  return useCallback((key: string, caret: 'start' | 'end' | number = 'end', fallback?: string) => {
    pending.current = { key, caret, fallback, at: performance.now() };
    requestAnimationFrame(flush);
  }, [flush]);
}

// ── Formatting ───────────────────────────────────────────────────────────────

export function fmtWhen(iso: string | null | undefined): string {
  if (!iso) return '';
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return '';
  return d.toLocaleString('en-US', { month: 'short', day: 'numeric', year: 'numeric', hour: 'numeric', minute: '2-digit' });
}

/** "Built-in default" / "Customized by Dana · Sep 25, 2026, 2:41 PM" / "New — not saved yet". */
export function provenanceText(meta: BlockMeta | null | undefined): string {
  if (!meta) return 'New — not saved yet';
  if (!meta.custom) return 'Built-in default';
  const when = fmtWhen(meta.updatedAt);
  return `Customized${meta.updatedBy ? ` by ${meta.updatedBy}` : ''}${when ? ` · ${when}` : ''}`;
}

export const plural = (n: number, one: string, many = `${one}s`) => `${n} ${n === 1 ? one : many}`;

// ── Components ───────────────────────────────────────────────────────────────

const FIELD_SIZING = typeof CSS !== 'undefined' && typeof CSS.supports === 'function' && CSS.supports('field-sizing', 'content');

function fitHeight(el: HTMLTextAreaElement | null) {
  if (!el) return;
  el.style.height = 'auto';
  el.style.height = `${el.scrollHeight + el.offsetHeight - el.clientHeight}px`;
}

type AutoTextareaProps = Omit<TextareaHTMLAttributes<HTMLTextAreaElement>, 'value'> & { value: string };

/** One-row textarea that grows with its content (CSS field-sizing where supported). */
export const AutoTextarea = forwardRef<HTMLTextAreaElement, AutoTextareaProps>(function AutoTextarea(
  { className = '', style, value, ...rest }, ref
) {
  const inner = useRef<HTMLTextAreaElement | null>(null);
  const setRefs = useCallback((el: HTMLTextAreaElement | null) => {
    inner.current = el;
    if (typeof ref === 'function') ref(el);
    else if (ref) ref.current = el;
  }, [ref]);
  useLayoutEffect(() => { if (!FIELD_SIZING) fitHeight(inner.current); }, [value]);
  useEffect(() => {
    // Re-fit when the width changes (window resize, sidebar toggle) — wrapping changes.
    const el = inner.current;
    if (FIELD_SIZING || !el || typeof ResizeObserver === 'undefined') return;
    let width = el.clientWidth;
    const ro = new ResizeObserver(() => {
      if (el.clientWidth !== width) { width = el.clientWidth; fitHeight(el); }
    });
    ro.observe(el);
    return () => ro.disconnect();
  }, []);
  return (
    <textarea
      ref={setRefs}
      rows={1}
      value={value}
      className={`block w-full resize-none overflow-hidden ${className}`}
      style={FIELD_SIZING ? ({ ...style, fieldSizing: 'content' } as CSSProperties) : style}
      {...rest}
    />
  );
});

/** Shared look of the editors' text fields. */
export const fieldCls =
  'rounded border border-white/8 bg-white/4 px-2.5 py-1.5 text-[12px] leading-snug text-white/85 placeholder-white/25 outline-none transition hover:border-white/15 focus:border-accent/40 focus:bg-white/6';

export function IconButton({ label, onClick, disabled, children, focusKey, tone = 'default', className = '' }: {
  label: string;
  onClick: () => void;
  disabled?: boolean;
  children: ReactNode;
  focusKey?: string;
  tone?: 'default' | 'danger';
  className?: string;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      disabled={disabled}
      aria-label={label}
      title={label}
      data-focus-key={focusKey}
      className={`grid h-7 w-7 shrink-0 place-items-center rounded text-[12px] leading-none text-white/35 transition hover:bg-white/8 disabled:cursor-default disabled:opacity-25 disabled:hover:bg-transparent ${
        tone === 'danger' ? 'hover:text-red-300/90' : 'hover:text-white/85'
      } ${className}`}
    >
      {children}
    </button>
  );
}

/**
 * Grip for HTML5 drag and drop. Only the grip is draggable (a draggable row
 * would fight text selection in its textarea); the whole row is used as the
 * drag image. Hidden on touch-only devices, where ↑/↓ do the job.
 */
export function DragHandle({ label, onDragStart, onDragEnd, rowRef }: {
  label: string;
  onDragStart: (e: React.DragEvent) => void;
  onDragEnd: () => void;
  rowRef?: RefObject<HTMLElement>;
}) {
  return (
    <span
      draggable
      aria-hidden="true"
      title={label}
      onDragStart={(e) => {
        const row = rowRef?.current;
        if (row) e.dataTransfer.setDragImage(row, 12, 12);
        onDragStart(e);
      }}
      onDragEnd={onDragEnd}
      className="hidden h-7 w-4 shrink-0 cursor-grab select-none place-items-center text-white/20 transition hover:text-white/60 active:cursor-grabbing [@media(pointer:fine)]:grid"
    >
      <svg width="8" height="14" viewBox="0 0 8 14" fill="currentColor" aria-hidden="true">
        <circle cx="2" cy="2" r="1.2" /><circle cx="6" cy="2" r="1.2" />
        <circle cx="2" cy="7" r="1.2" /><circle cx="6" cy="7" r="1.2" />
        <circle cx="2" cy="12" r="1.2" /><circle cx="6" cy="12" r="1.2" />
      </svg>
    </span>
  );
}

/** Insertion marker for drag and drop; the parent must be `relative`. */
export function DropLine({ at }: { at: 'top' | 'bottom' }) {
  return (
    <div
      aria-hidden="true"
      className={`pointer-events-none absolute inset-x-0 z-10 h-0.5 rounded-full bg-accent shadow-glow ${
        at === 'top' ? '-top-px' : '-bottom-px'
      }`}
    />
  );
}

/** Where a pointer is over a row: its upper or lower half. */
export function pointerHalf(e: React.DragEvent, el: HTMLElement): 'before' | 'after' {
  const r = el.getBoundingClientRect();
  return e.clientY < r.top + r.height / 2 ? 'before' : 'after';
}

/**
 * For a pointer over the gaps of a list (between cards, below the last): the
 * id of the first child (by its `data-drop-id`) whose middle is below the
 * pointer, or null for "at the end".
 */
export function dropIdAt(container: HTMLElement, clientY: number): string | null {
  for (const el of Array.from(container.children)) {
    if (!(el instanceof HTMLElement) || !el.dataset.dropId) continue;
    const r = el.getBoundingClientRect();
    if (clientY < r.top + r.height / 2) return el.dataset.dropId;
  }
  return null;
}

export function EditPreviewToggle({ preview, onChange }: { preview: boolean; onChange: (preview: boolean) => void }) {
  const opt = (value: boolean, label: string) => (
    <button
      type="button"
      aria-pressed={preview === value}
      onClick={() => onChange(value)}
      className={`rounded px-2.5 py-1 text-[11px] transition ${
        preview === value ? 'bg-white/12 font-medium text-white/90' : 'text-white/45 hover:text-white/75'
      }`}
    >
      {label}
    </button>
  );
  return (
    <div className="inline-flex shrink-0 rounded-md border border-white/10 bg-white/4 p-0.5" role="group" aria-label="View">
      {opt(false, 'Edit')}
      {opt(true, 'Preview')}
    </div>
  );
}

/** Title block of an editor pane. */
export function EditorHeader({ eyebrow, title, subtitle, meta, isNew, note, actions }: {
  eyebrow: string;
  title: string;
  subtitle?: string;
  meta: BlockMeta | null | undefined;
  isNew?: boolean;
  note?: ReactNode;
  actions?: ReactNode;
}) {
  const custom = !!meta?.custom;
  return (
    <div className="mb-4 flex flex-wrap items-start gap-x-4 gap-y-2">
      <div className="min-w-0 flex-1">
        <p className="text-[9px] font-bold uppercase tracking-[0.16em] text-white/30">{eyebrow}</p>
        <h2 className="mt-0.5 text-[16px] font-semibold leading-tight text-white/90">{title}</h2>
        {subtitle && <p className="mt-0.5 text-[11px] text-white/45">{subtitle}</p>}
        <p className="mt-1.5 flex flex-wrap items-center gap-x-2 gap-y-1 text-[10px] text-white/40">
          <span
            className={`rounded px-1.5 py-px text-[8px] font-bold uppercase tracking-wider ${
              isNew ? 'bg-amber-400/15 text-amber-300/85'
              : custom ? 'bg-accent/15 text-accent/80'
              : 'bg-white/8 text-white/45'
            }`}
          >
            {isNew ? 'New' : custom ? 'Custom' : 'Default'}
          </span>
          <span>{provenanceText(isNew ? null : meta)}</span>
          {note}
        </p>
      </div>
      {actions && <div className="flex shrink-0 items-center gap-2">{actions}</div>}
    </div>
  );
}

/** Someone else saved the unit being edited; the draft waits for a decision. */
export function ConflictBanner({ what, meta, onLoadTheirs, onKeepMine }: {
  what: string;
  meta: BlockMeta | null | undefined;
  onLoadTheirs: () => void;
  onKeepMine: () => void;
}) {
  const who = !meta
    ? 'It was deleted'
    : meta.custom
      ? `${meta.updatedBy ?? 'Another admin'} saved it${meta.updatedAt ? ` ${fmtWhen(meta.updatedAt)}` : ''}`
      : 'It was reset to the built-in default';
  return (
    <div role="alert" className="mb-4 rounded-lg border border-amber-400/35 bg-amber-400/8 px-3.5 py-3">
      <p className="text-[12px] font-medium text-amber-200/90">Someone else saved {what} while you were editing</p>
      <p className="mt-0.5 text-[11px] leading-relaxed text-amber-100/60">
        {who}. Your draft is still here — load their version (your changes are discarded), or keep yours
        and save it over theirs.
      </p>
      <div className="mt-2.5 flex flex-wrap gap-2">
        <button
          type="button"
          onClick={onLoadTheirs}
          className="rounded border border-amber-400/40 bg-amber-400/10 px-3 py-1.5 text-[11px] font-medium text-amber-200 transition hover:bg-amber-400/20"
        >
          Load their version
        </button>
        <button
          type="button"
          onClick={onKeepMine}
          className="rounded border border-white/15 px-3 py-1.5 text-[11px] text-white/65 transition hover:border-white/30 hover:text-white"
        >
          Keep mine
        </button>
      </div>
    </div>
  );
}

export interface FooterReset {
  label: string;
  onClick: () => void;
}

/** Sticky save bar: status, validation / server errors, Save · Discard · Reset. */
export function EditorFooter({
  dirty, busy, onSave, onDiscard, reset, error, onDismissError, issues = [], onShowIssue, notice,
}: {
  dirty: boolean;
  /** 'Saving…' / 'Resetting…' while a request is in flight. */
  busy: string | null;
  onSave: () => void;
  onDiscard: () => void;
  reset?: FooterReset | null;
  error?: string | null;
  onDismissError?: () => void;
  issues?: DraftIssue[];
  onShowIssue?: (id: string) => void;
  /** Transient confirmation ("Saved"). */
  notice?: string | null;
}) {
  const blocked = issues.length > 0;
  const status = busy
    ? { text: busy, cls: 'text-white/55', dot: 'animate-pulse bg-accent/70' }
    : dirty
      ? { text: 'Unsaved changes', cls: 'text-amber-200/85', dot: 'bg-amber-400' }
      : notice
        ? { text: notice, cls: 'text-accent-ok/85', dot: 'bg-accent-ok' }
        : { text: 'No unsaved changes', cls: 'text-white/35', dot: 'bg-white/20' };

  return (
    <div className="sticky bottom-0 z-20 mt-auto border-t border-white/10 bg-ink-900/95 px-4 py-2.5 backdrop-blur md:px-6">
      {error && (
        <div role="alert" className="mb-2 flex items-start gap-2 rounded border border-red-400/30 bg-red-500/10 px-3 py-2">
          <p className="min-w-0 flex-1 text-[11px] leading-snug text-red-200/90">{error}</p>
          {onDismissError && (
            <button type="button" onClick={onDismissError} aria-label="Dismiss error"
              className="shrink-0 text-[11px] text-red-200/50 transition hover:text-red-100">✕</button>
          )}
        </div>
      )}
      {blocked && (
        <div className="mb-2 rounded border border-amber-400/25 bg-amber-400/8 px-3 py-1.5">
          <p className="text-[10px] font-bold uppercase tracking-wider text-amber-300/80">
            Fix {plural(issues.length, 'problem')} before saving
          </p>
          <ul className="mt-0.5 space-y-0.5">
            {issues.slice(0, 3).map((iss, i) => (
              <li key={`${iss.id ?? 'x'}-${i}`} className="flex items-baseline gap-2 text-[11px] text-amber-100/75">
                <span className="min-w-0">{iss.message}</span>
                {iss.id && onShowIssue && (
                  <button type="button" onClick={() => onShowIssue(iss.id!)}
                    className="shrink-0 text-[10px] text-amber-200/70 underline underline-offset-2 hover:text-amber-100">
                    Show
                  </button>
                )}
              </li>
            ))}
            {issues.length > 3 && <li className="text-[10px] text-amber-100/50">…and {issues.length - 3} more</li>}
          </ul>
        </div>
      )}
      <div className="flex flex-wrap items-center gap-2">
        <span className={`flex items-center gap-1.5 text-[11px] ${status.cls}`} role="status" aria-live="polite">
          <span className={`h-1.5 w-1.5 rounded-full ${status.dot}`} aria-hidden />
          {status.text}
        </span>
        <div className="ml-auto flex flex-wrap items-center justify-end gap-2">
          {reset && (
            <button
              type="button"
              onClick={reset.onClick}
              disabled={!!busy}
              className="rounded border border-transparent px-2.5 py-1.5 text-[11px] text-white/40 transition hover:border-red-400/30 hover:text-red-300/85 disabled:opacity-40"
            >
              {reset.label}
            </button>
          )}
          <button
            type="button"
            onClick={onDiscard}
            disabled={!dirty || !!busy}
            className="rounded border border-white/12 px-3 py-1.5 text-[11px] text-white/55 transition hover:border-white/25 hover:text-white disabled:opacity-30 disabled:hover:border-white/12 disabled:hover:text-white/55"
          >
            Discard
          </button>
          <button
            type="button"
            onClick={onSave}
            disabled={!dirty || !!busy || blocked}
            title={`Save (${SAVE_SHORTCUT})`}
            className="flex items-center gap-2 rounded bg-accent/20 px-3.5 py-1.5 text-[11px] font-medium text-accent transition hover:bg-accent/30 disabled:bg-white/6 disabled:text-white/30"
          >
            {busy === 'Saving…' ? 'Saving…' : 'Save'}
            <kbd className="hidden rounded border border-white/15 px-1 font-sans text-[9px] opacity-60 sm:inline">{SAVE_SHORTCUT}</kbd>
          </button>
        </div>
      </div>
    </div>
  );
}

/**
 * Scope list beside the editor on wide screens; on phones a "Scope: …" bar
 * that folds the list open above the editor.
 */
export function ScopedEditorLayout({ scopeName, renderList, children }: {
  scopeName: string;
  renderList: (closeOnPhone: () => void) => ReactNode;
  children: ReactNode;
}) {
  const [open, setOpen] = useState(false);
  const listId = useId();
  return (
    <div className="flex flex-1 flex-col md:flex-row">
      <aside className="shrink-0 border-b border-white/8 bg-ink-900/40 md:w-72 md:border-b-0 md:border-r">
        <button
          type="button"
          onClick={() => setOpen((o) => !o)}
          aria-expanded={open}
          aria-controls={listId}
          className="flex w-full items-center gap-2 px-4 py-2.5 text-left md:hidden"
        >
          <span className="text-[9px] font-bold uppercase tracking-[0.14em] text-white/30">Scope</span>
          <span className="min-w-0 flex-1 truncate text-[12px] text-white/80">{scopeName}</span>
          <span className="shrink-0 text-[10px] text-accent/70">{open ? 'Close' : 'Change'}</span>
        </button>
        <div
          id={listId}
          className={`${open ? 'block' : 'hidden'} max-h-[60vh] overflow-y-auto border-t border-white/6 md:sticky md:top-0 md:block md:max-h-[calc(100dvh-4rem)] md:border-t-0`}
        >
          {renderList(() => setOpen(false))}
        </div>
      </aside>
      <div className="flex min-w-0 flex-1 flex-col">{children}</div>
    </div>
  );
}
