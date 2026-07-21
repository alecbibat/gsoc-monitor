import { lazy, Suspense, useEffect, useState } from 'react';

// Popover body (and the provenance catalogue it imports) loads only when the
// info button is first clicked.
const InfoPanelPopover = lazy(() =>
  import('./InfoPanelPopover').then((m) => ({ default: m.InfoPanelPopover }))
);

export function InfoPanel() {
  const [open, setOpen] = useState(false);

  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') setOpen(false);
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [open]);

  return (
    <div className="pointer-events-auto relative">
      <button
        onClick={() => setOpen((v) => !v)}
        className={`flex h-9 w-9 items-center justify-center rounded-lg border shadow-panel backdrop-blur-sm transition ${
          open
            ? 'border-accent/50 bg-accent/15 text-accent'
            : 'border-white/10 bg-ink-900/80 text-white/55 hover:text-white'
        }`}
        title="Data sources & provenance"
        aria-label="Data sources and provenance"
      >
        <svg width="18" height="18" viewBox="0 0 24 24" fill="none">
          <circle cx="12" cy="12" r="9" stroke="currentColor" strokeWidth="2" />
          <path
            d="M12 11v5"
            stroke="currentColor"
            strokeWidth="2"
            strokeLinecap="round"
          />
          <circle cx="12" cy="7.75" r="1.25" fill="currentColor" />
        </svg>
      </button>

      {open && (
        <Suspense fallback={null}>
          <InfoPanelPopover onClose={() => setOpen(false)} />
        </Suspense>
      )}
    </div>
  );
}
