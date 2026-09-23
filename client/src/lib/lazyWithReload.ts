import { lazy, type ComponentType } from 'react';

// Long-lived tabs (wall displays, laptops) outlive deploys. Each deploy renames
// the content-hashed lazy chunks and the server 404s the old names, so
// React.lazy would reject and, with no error boundary above it, unmount the whole
// dashboard (black screen). On a failed chunk load, reload once to pick up the
// new build. Latched by time, not once per session, because sessionStorage
// survives reloads and a wall tab sees many deploys.
const RELOAD_LATCH = 'gsoc-chunk-reload';
const LATCH_MS = 60_000;

function reloadOnce(): boolean {
  try {
    const last = Number(sessionStorage.getItem(RELOAD_LATCH) || 0);
    if (Date.now() - last < LATCH_MS) return false; // just reloaded: don't loop
    sessionStorage.setItem(RELOAD_LATCH, String(Date.now()));
  } catch {
    return false; // no storage means no loop guard, so keep today's behaviour
  }
  window.location.reload();
  return true;
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
export function lazyWithReload<T extends ComponentType<any>>(factory: () => Promise<{ default: T }>) {
  return lazy(() =>
    factory().catch((err: unknown) => {
      // Never settles, so the Suspense fallback stays up while the page navigates.
      if (reloadOnce()) return new Promise<{ default: T }>(() => {});
      throw err;
    })
  );
}
