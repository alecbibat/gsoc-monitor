import { Component, type ReactNode } from 'react';

// The public share page is opened by untrained stakeholders and stays open
// for days — across redeploys, which invalidate the content-hashed lazy
// chunks a long-lived tab still references. Without a boundary, a rejected
// dynamic import (or any render error) unmounts the entire React root and the
// viewer sees a blank page over the dark body background.
//
// Stale-chunk failures are self-healing: one automatic reload fetches the
// fresh index.html and chunk names. The sessionStorage latch stops a reload
// loop if the failure is something else; then (and for non-chunk errors) we
// show an explicit reload prompt instead of nothing.

const RELOAD_LATCH = 'gsoc-share-chunk-reload';

const isStaleChunkError = (err: unknown): boolean =>
  err instanceof Error &&
  /dynamically imported module|Loading chunk|error loading|Failed to fetch|Importing a module script failed/i.test(err.message);

export class ShareErrorBoundary extends Component<{ children: ReactNode }, { failed: boolean }> {
  state = { failed: false };

  static getDerivedStateFromError(): { failed: boolean } {
    return { failed: true };
  }

  componentDidCatch(error: unknown) {
    console.error('[share] render error:', error);
    if (isStaleChunkError(error) && !sessionStorage.getItem(RELOAD_LATCH)) {
      sessionStorage.setItem(RELOAD_LATCH, '1');
      window.location.reload();
    }
  }

  render() {
    if (!this.state.failed) return this.props.children;
    return (
      <div className="flex min-h-screen items-center justify-center bg-ink-950 p-6 text-white">
        <div className="max-w-md text-center">
          <p className="text-[15px] text-white/70">This report can’t be displayed right now.</p>
          <p className="mt-2 text-[12px] text-white/40">
            The app was likely updated while this page was open.
          </p>
          <button
            onClick={() => {
              sessionStorage.removeItem(RELOAD_LATCH);
              window.location.reload();
            }}
            className="mt-4 rounded border border-white/20 bg-white/8 px-4 py-2 text-[12px] text-white/80 transition hover:border-white/35 hover:bg-white/12"
          >
            Reload page
          </button>
        </div>
      </div>
    );
  }
}
