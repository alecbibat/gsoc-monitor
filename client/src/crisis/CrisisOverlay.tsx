import { useEffect } from 'react';
import { createPortal } from 'react-dom';
import { useCrisisStore, type CrisisTab } from './crisisStore';
import { SituationReport } from './tabs/SituationReport';

const TABS: { id: CrisisTab; label: string }[] = [
  { id: 'situation-report', label: 'Situation Report' },
];

const STATUS_BADGE: Record<
  string,
  { dot: string; badge: string }
> = {
  active:    { dot: '#ef4444', badge: 'text-red-400 bg-red-500/15 border-red-500/40' },
  contained: { dot: '#f59e0b', badge: 'text-amber-300 bg-amber-400/15 border-amber-400/40' },
  resolved:  { dot: '#22c55e', badge: 'text-green-400 bg-green-500/15 border-green-500/40' },
};

export function CrisisOverlay() {
  const open         = useCrisisStore((s) => s.open);
  const close        = useCrisisStore((s) => s.close);
  const activeTab    = useCrisisStore((s) => s.activeTab);
  const setTab       = useCrisisStore((s) => s.setTab);
  const status       = useCrisisStore((s) => s.incidentStatus);
  const name         = useCrisisStore((s) => s.incidentName);
  const reset        = useCrisisStore((s) => s.reset);

  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') close(); };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [open, close]);

  if (!open) return null;

  const { dot, badge } = STATUS_BADGE[status] ?? STATUS_BADGE.active;

  return createPortal(
    <div
      className="fixed inset-0 z-[2000] flex flex-col bg-ink-950/98 backdrop-blur-sm"
      role="dialog"
      aria-modal
      aria-label="Crisis Management"
    >
      {/* ── Header ─────────────────────────────────────────────────────────── */}
      <header className="flex shrink-0 items-center gap-4 border-b border-white/10 bg-ink-900/70 px-6 py-3">

        {/* Identity */}
        <div className="flex items-center gap-3">
          {/* Status pulse dot */}
          <div className="relative flex h-2.5 w-2.5 shrink-0">
            {status === 'active' && (
              <span
                className="absolute inline-flex h-full w-full animate-ping rounded-full opacity-70"
                style={{ background: dot }}
              />
            )}
            <span
              className="relative inline-flex h-2.5 w-2.5 rounded-full"
              style={{ background: dot }}
            />
          </div>

          <div className="min-w-0">
            <div className="text-[9px] font-bold uppercase tracking-[0.18em] text-white/35">
              Crisis Management
            </div>
            <div className="truncate text-[14px] font-semibold text-white/90">
              {name || 'New Incident'}
            </div>
          </div>

          <span className={`shrink-0 rounded-full border px-2.5 py-0.5 text-[9px] font-bold uppercase tracking-widest ${badge}`}>
            {status}
          </span>
        </div>

        {/* Tabs */}
        <nav className="ml-4 flex gap-1">
          {TABS.map((tab) => (
            <button
              key={tab.id}
              onClick={() => setTab(tab.id)}
              className={`rounded-md px-4 py-1.5 text-[12px] font-medium transition ${
                activeTab === tab.id
                  ? 'bg-accent/15 text-accent'
                  : 'text-white/40 hover:text-white/65'
              }`}
            >
              {tab.label}
            </button>
          ))}
          {/* Placeholder tabs to show future growth */}
          {['Resource Tracker', 'Comms Log', 'Action Items'].map((label) => (
            <button
              key={label}
              disabled
              className="cursor-not-allowed rounded-md px-4 py-1.5 text-[12px] font-medium text-white/18"
              title="Coming soon"
            >
              {label}
            </button>
          ))}
        </nav>

        {/* Right controls */}
        <div className="ml-auto flex items-center gap-2">
          <button
            onClick={() => {
              if (confirm('Clear all incident data and start fresh?')) reset();
            }}
            className="rounded border border-white/8 px-3 py-1.5 text-[11px] text-white/30 transition hover:border-white/16 hover:text-white/50"
          >
            Clear
          </button>
          <button
            onClick={close}
            className="flex items-center gap-1.5 rounded border border-white/12 px-3 py-1.5 text-[11px] text-white/50 transition hover:border-white/22 hover:text-white"
            aria-label="Close"
          >
            <svg width="11" height="11" viewBox="0 0 24 24" fill="none">
              <path d="M6 6L18 18M6 18L18 6" stroke="currentColor" strokeWidth="2" strokeLinecap="round" />
            </svg>
            Esc
          </button>
        </div>
      </header>

      {/* ── Content ────────────────────────────────────────────────────────── */}
      <main className="min-h-0 flex-1 overflow-y-auto px-6 py-5">
        {activeTab === 'situation-report' && <SituationReport />}
      </main>
    </div>,
    document.body
  );
}
