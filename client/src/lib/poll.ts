// Polling that respects tab visibility: ticks are skipped while the tab is
// hidden (no wasted upstream calls / battery), and a skipped tick fires
// immediately when the tab becomes visible again so the data is never staler
// than it would have been. On an always-visible GSOC wall display this behaves
// exactly like a plain setInterval.
export function startVisiblePolling(fn: () => void, intervalMs: number): () => void {
  let missed = false;
  fn(); // immediate first run, matching the layers' previous behaviour
  const id = setInterval(() => {
    if (document.hidden) {
      missed = true;
      return;
    }
    fn();
  }, intervalMs);
  const onVisible = () => {
    if (!document.hidden && missed) {
      missed = false;
      fn();
    }
  };
  document.addEventListener('visibilitychange', onVisible);
  return () => {
    clearInterval(id);
    document.removeEventListener('visibilitychange', onVisible);
  };
}
