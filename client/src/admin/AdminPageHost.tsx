import { Component, Suspense, useEffect, useRef, type ReactNode } from 'react';
import { createPortal } from 'react-dom';
import { useAuthStore } from '../auth/authStore';
import { lazyWithReload } from '../lib/lazyWithReload';
import { useAdminPageStore, isAdminSection, type AdminSection } from './adminPageStore';
import { confirmDiscardIfDirty } from './dirtyGuard';

// ── Admin page host ──────────────────────────────────────────────────────────
//
// Always mounted in the signed-in app (UserMenu), but renders nothing unless
// the admin page is open AND the user is an admin — so a member's browser
// never even fetches the page's chunk. It also owns the page's URL: while the
// page is open the hash reads `#admin/<section>` (a reload or a pasted link
// lands back on the same section), and it is cleared on close.
//
// The hash is written with history.replaceState, never pushed: switching
// sections must not pile up history entries, and Back must keep meaning
// "leave the app", not "undo a click in the admin nav".

const AdminPage = lazyWithReload(() => import('./AdminPage').then((m) => ({ default: m.AdminPage })));

/**
 * `#admin/iap` → `{ section: 'iap' }`; `#admin` (or an unknown section) → `{}`
 * (open on the current section); anything else → null.
 */
export function parseAdminHash(hash: string): { section?: AdminSection } | null {
  const m = /^#admin(?:\/([^/?#]*))?\/?$/.exec(hash);
  if (!m) return null;
  return isAdminSection(m[1]) ? { section: m[1] } : {};
}

export function adminHash(section: AdminSection): string {
  return `#admin/${section}`;
}

/** Replace the URL's hash in place ('' removes it) without a history entry or a hashchange. */
function replaceHash(hash: string): void {
  if (window.location.hash === hash || (!hash && !window.location.hash)) return;
  const { pathname, search } = window.location;
  try {
    window.history.replaceState(window.history.state, '', `${pathname}${search}${hash}`);
  } catch {
    /* sandboxed frame: the hash is a convenience, the page works without it */
  }
}

export function AdminPageHost() {
  const isAdmin = useAuthStore((s) => s.user?.role === 'admin');
  const open = useAdminPageStore((s) => s.open);
  const section = useAdminPageStore((s) => s.section);

  // Deep link on load, and a hash edited by hand while the app runs (the only
  // way a hashchange fires — our own writes use replaceState). Changing
  // section or leaving that way goes through the same unsaved-changes guard
  // as the nav; declining puts the hash back.
  useEffect(() => {
    if (!isAdmin) return;
    const initial = parseAdminHash(window.location.hash);
    if (initial && !useAdminPageStore.getState().open) useAdminPageStore.getState().openAdmin(initial.section);

    const onHashChange = () => {
      const target = parseAdminHash(window.location.hash);
      const st = useAdminPageStore.getState();
      if (target) {
        if (!st.open) { st.openAdmin(target.section); return; }
        if (!target.section || target.section === st.section) return;
        if (confirmDiscardIfDirty()) st.setSection(target.section);
        else replaceHash(adminHash(st.section));
      } else if (st.open) {
        if (confirmDiscardIfDirty()) st.close();
        else replaceHash(adminHash(st.section));
      }
    };
    window.addEventListener('hashchange', onHashChange);
    return () => window.removeEventListener('hashchange', onHashChange);
  }, [isAdmin]);

  // Keep the hash in step with the page. Cleared only on an open → closed
  // transition, so the initial render (still closed) can't strip a deep link
  // before the effect above has opened it.
  const wasOpen = useRef(false);
  const showing = open && isAdmin;
  useEffect(() => {
    if (showing) {
      wasOpen.current = true;
      replaceHash(adminHash(section));
    } else if (wasOpen.current) {
      wasOpen.current = false;
      if (parseAdminHash(window.location.hash)) replaceHash('');
    }
  }, [showing, section]);

  if (!showing) return null;

  return (
    <AdminErrorBoundary>
      <Suspense fallback={<AdminLoading />}>
        <AdminPage />
      </Suspense>
    </AdminErrorBoundary>
  );
}

// ── Loading / failure shells ──────────────────────────────────────────────────
// Same footprint as the page, so opening it gives immediate feedback on a slow
// link, and a failed chunk or a render bug inside an editor shows a way out
// instead of unmounting the whole dashboard (nothing above this catches).
// Portalled like the page itself: rendered in place they would be trapped in
// the top bar's z-20 stacking context, under an open crisis workspace.

function Shell({ children }: { children: ReactNode }) {
  return createPortal(
    <div
      role="dialog"
      aria-modal="true"
      aria-label="Admin"
      className="pointer-events-auto fixed inset-0 z-[4000] flex flex-col items-center justify-center gap-3 bg-ink-950 p-6 text-center"
    >
      {children}
    </div>,
    document.body,
  );
}

function AdminLoading() {
  return (
    <Shell>
      <p className="text-[12px] text-white/45" role="status">Loading admin…</p>
      <button
        onClick={() => useAdminPageStore.getState().close()}
        className="rounded border border-white/12 px-3 py-1.5 text-[11px] text-white/50 transition hover:border-white/22 hover:text-white"
      >
        Cancel
      </button>
    </Shell>
  );
}

class AdminErrorBoundary extends Component<{ children: ReactNode }, { failed: boolean }> {
  state = { failed: false };

  static getDerivedStateFromError(): { failed: boolean } {
    return { failed: true };
  }

  componentDidCatch(error: unknown) {
    console.error('[admin] page failed:', error);
  }

  render() {
    if (!this.state.failed) return this.props.children;
    return (
      <Shell>
        <p className="text-[13px] text-white/75">The admin page couldn’t be displayed.</p>
        <p className="max-w-sm text-[11px] text-white/40">
          The app may have been updated while this tab was open. Reloading fetches the latest version.
        </p>
        <div className="flex gap-2">
          <button
            onClick={() => window.location.reload()}
            className="rounded border border-white/20 bg-white/8 px-3 py-1.5 text-[11px] text-white/80 transition hover:border-white/35 hover:bg-white/12"
          >
            Reload page
          </button>
          <button
            onClick={() => useAdminPageStore.getState().close()}
            className="rounded border border-white/12 px-3 py-1.5 text-[11px] text-white/50 transition hover:border-white/22 hover:text-white"
          >
            Close
          </button>
        </div>
      </Shell>
    );
  }
}
