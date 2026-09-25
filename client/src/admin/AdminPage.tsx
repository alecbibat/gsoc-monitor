import { useCallback, useEffect, useId, useRef, useState, type ReactNode } from 'react';
import { createPortal } from 'react-dom';
import { useAuthStore } from '../auth/authStore';
import { ADMIN_SECTIONS, isAdminSection, useAdminPageStore, type AdminSection } from './adminPageStore';
import { confirmDiscardIfDirty, useAdminDirtyStore } from './dirtyGuard';
import { ChecklistEditor } from './ChecklistEditor';
import { IntakeEditor } from './IntakeEditor';
import { RolesEditor } from './RolesEditor';
import { IapSection } from './IapSection';
import { TeamSection } from './TeamSection';
import { AccessSection } from './AccessSection';

// ── Admin page ───────────────────────────────────────────────────────────────
//
// Full-screen, above everything else (the crisis workspace is z-[2000], its
// report modal z-[3000]) because it is opened from inside an incident as well
// as from the user menu. Loaded lazily by AdminPageHost, which also keeps the
// URL hash in step. Every way out of a section — nav, Esc, ✕, a hand-edited
// hash, closing the tab — goes through the editors' unsaved-changes guard.

/** Section groups in ADMIN_SECTIONS order. */
const NAV_GROUPS = ADMIN_SECTIONS.reduce<{ group: string; sections: typeof ADMIN_SECTIONS }[]>((acc, s) => {
  const last = acc[acc.length - 1];
  if (last && last.group === s.group) last.sections.push(s);
  else acc.push({ group: s.group, sections: [s] });
  return acc;
}, []);

const sectionLabel = (id: AdminSection) => ADMIN_SECTIONS.find((s) => s.id === id)?.label ?? id;

function SectionBody({ section }: { section: AdminSection }): ReactNode {
  // The template editors lay themselves out edge to edge (scope list +
  // editor + sticky footer) and get at least the full height of the scroll
  // area; the simple sections pad and centre themselves.
  const full = (node: ReactNode) => <div className="flex min-h-full flex-col">{node}</div>;
  switch (section) {
    case 'checklists': return full(<ChecklistEditor />);
    case 'intake': return full(<IntakeEditor />);
    case 'roles': return full(<RolesEditor />);
    case 'iap': return <IapSection />;
    case 'team': return <TeamSection />;
    case 'access': return <AccessSection />;
  }
}

export function AdminPage() {
  const user = useAuthStore((s) => s.user);
  const section = useAdminPageStore((s) => s.section);
  const dirty = useAdminDirtyStore((s) => s.dirty);
  const rootRef = useRef<HTMLDivElement>(null);
  const mainRef = useRef<HTMLElement>(null);
  const selectId = useId();
  // What was on the page before this opened — read at first render, before
  // this page (or a popover an editor portals to <body> on mount) is added.
  const [underneath] = useState(() => Array.from(document.body.children));

  const requestClose = useCallback(() => {
    if (confirmDiscardIfDirty()) useAdminPageStore.getState().close();
  }, []);

  const goTo = (next: AdminSection) => {
    if (next === useAdminPageStore.getState().section) return;
    if (confirmDiscardIfDirty()) useAdminPageStore.getState().setSection(next);
  };

  // Esc closes (through the guard). Document BUBBLE phase, deliberately:
  //  - it runs after React's own handlers, so an editor that uses Esc itself
  //    (cancel an inline edit, close a popover) can claim the press with
  //    preventDefault() / stopPropagation() and the page stays open;
  //  - while the page is up, NO keystroke goes on to the window-level
  //    listeners underneath: the crisis workspace's Esc would close the
  //    incident too, and map drawing / measuring treat Enter and Backspace
  //    as finish / undo — typing in an editor must never do either.
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      e.stopPropagation();
      // Esc during IME composition only cancels the composition.
      if (e.key !== 'Escape' || e.defaultPrevented || e.isComposing) return;
      requestClose();
    };
    document.addEventListener('keydown', onKey);
    return () => document.removeEventListener('keydown', onKey);
  }, [requestClose]);

  // Leaving the app (reload, closing the tab, signing out) with an unsaved draft.
  useEffect(() => {
    if (!dirty) return;
    const onBeforeUnload = (e: BeforeUnloadEvent) => {
      e.preventDefault();
      e.returnValue = ''; // Chrome < 119 still needs this to show the prompt
    };
    window.addEventListener('beforeunload', onBeforeUnload);
    return () => window.removeEventListener('beforeunload', onBeforeUnload);
  }, [dirty]);

  // However the page goes away, a stale "dirty" must not outlive it: the next
  // open would otherwise ask about edits that no longer exist.
  useEffect(() => () => useAdminDirtyStore.getState().setDirty(false), []);

  // Modal for real: everything that was on the page before (the globe, the
  // crisis workspace — its own body-level portal) is made inert while this is
  // up, so Tab and screen readers stay inside. Only elements this changed are
  // restored. Focus moves in on open and goes back to whatever opened the
  // page on close.
  useEffect(() => {
    const self = rootRef.current;
    const opener = document.activeElement instanceof HTMLElement ? document.activeElement : null;
    const changed: HTMLElement[] = [];
    for (const el of underneath) {
      if (el === self || !(el instanceof HTMLElement) || !el.isConnected || el.inert) continue;
      el.inert = true;
      changed.push(el);
    }
    self?.focus({ preventScroll: true });
    return () => {
      for (const el of changed) el.inert = false;
      if (opener && opener !== document.body && opener.isConnected) opener.focus({ preventScroll: true });
    };
  }, [underneath]);

  // A new section starts at the top, not at the previous one's scroll offset.
  useEffect(() => { mainRef.current?.scrollTo({ top: 0 }); }, [section]);

  return createPortal(
    <div
      ref={rootRef}
      role="dialog"
      aria-modal="true"
      aria-label="Admin"
      tabIndex={-1}
      className="pointer-events-auto fixed inset-0 z-[4000] flex flex-col bg-ink-950 text-white outline-none"
    >
      <header className="flex shrink-0 items-center gap-3 border-b border-white/10 bg-ink-900 px-4 pb-3 pt-safe md:px-6">
        <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"
          className="shrink-0 text-accent/80" aria-hidden="true">
          <path d="M12 2L2 7l10 5 10-5-10-5zM2 17l10 5 10-5M2 12l10 5 10-5" />
        </svg>
        <div className="min-w-0">
          <div className="text-[9px] font-bold uppercase tracking-[0.18em] text-white/35">GSOC Monitor</div>
          <h1 className="text-[14px] font-semibold text-white/90">Admin</h1>
        </div>
        <div className="ml-auto flex min-w-0 items-center gap-3">
          {dirty && (
            <span className="shrink-0 rounded bg-amber-400/15 px-1.5 py-0.5 text-[9px] font-bold uppercase tracking-wider text-amber-300/85">
              Unsaved
            </span>
          )}
          {user && (
            <span className="hidden min-w-0 truncate text-[11px] text-white/40 sm:block">
              Signed in as <span className="text-white/70">{user.name}</span>
            </span>
          )}
          <button
            onClick={requestClose}
            className="flex shrink-0 items-center gap-1.5 rounded border border-white/12 px-3 py-1.5 text-[11px] text-white/50 transition hover:border-white/22 hover:text-white"
            aria-label="Close admin"
            title="Close (Esc)"
          >
            <svg width="11" height="11" viewBox="0 0 24 24" fill="none" aria-hidden="true">
              <path d="M6 6L18 18M6 18L18 6" stroke="currentColor" strokeWidth="2" strokeLinecap="round" />
            </svg>
            <span className="hidden sm:inline">Esc</span>
          </button>
        </div>
      </header>

      <div className="flex min-h-0 flex-1 flex-col md:flex-row">
        {/* Phones: the nav collapses into a select. */}
        <div className="shrink-0 border-b border-white/8 bg-ink-900/60 px-4 py-2 md:hidden">
          <label htmlFor={selectId} className="sr-only">Admin section</label>
          <select
            id={selectId}
            value={section}
            onChange={(e) => { if (isAdminSection(e.target.value)) goTo(e.target.value); }}
            className="w-full rounded border border-white/10 bg-ink-900 px-2.5 py-2 text-[12px] text-white/80 outline-none focus:border-accent/40"
          >
            {NAV_GROUPS.map((g) => (
              <optgroup key={g.group} label={g.group}>
                {g.sections.map((s) => <option key={s.id} value={s.id}>{s.label}</option>)}
              </optgroup>
            ))}
          </select>
        </div>

        <nav
          aria-label="Admin sections"
          className="hidden w-56 shrink-0 overflow-y-auto border-r border-white/8 bg-ink-900/60 py-4 md:block"
        >
          {NAV_GROUPS.map((g) => (
            <div key={g.group} className="mb-5 last:mb-0">
              <h2 className="mb-1.5 px-5 text-[9px] font-bold uppercase tracking-[0.16em] text-white/30">{g.group}</h2>
              <ul>
                {g.sections.map((s) => {
                  const active = s.id === section;
                  return (
                    <li key={s.id}>
                      <button
                        onClick={() => goTo(s.id)}
                        aria-current={active ? 'page' : undefined}
                        className={`w-full border-l-2 px-5 py-2 text-left text-[12px] transition ${
                          active
                            ? 'border-accent bg-accent/10 font-medium text-accent'
                            : 'border-transparent text-white/55 hover:bg-white/4 hover:text-white/85'
                        }`}
                      >
                        {s.label}
                      </button>
                    </li>
                  );
                })}
              </ul>
            </div>
          ))}
        </nav>

        <main
          ref={mainRef}
          aria-label={sectionLabel(section)}
          className="min-h-0 flex-1 overflow-y-auto pb-safe"
        >
          <SectionBody key={section} section={section} />
        </main>
      </div>
    </div>,
    document.body,
  );
}
