import { useEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import {
  useCrisisStore, useActiveIncident, extractPublicState, type CrisisTab,
} from './crisisStore';
import { SituationReport } from './tabs/SituationReport';
import { IncidentList } from './IncidentList';

const TABS: { id: CrisisTab; label: string }[] = [
  { id: 'situation-report', label: 'Situation Report' },
];

const STATUS_BADGE: Record<string, { dot: string; badge: string }> = {
  active:    { dot: '#ef4444', badge: 'text-red-400 bg-red-500/15 border-red-500/40' },
  contained: { dot: '#f59e0b', badge: 'text-amber-300 bg-amber-400/15 border-amber-400/40' },
  resolved:  { dot: '#22c55e', badge: 'text-green-400 bg-green-500/15 border-green-500/40' },
};

// ── Share button ──────────────────────────────────────────────────────────────

function ShareButton() {
  const inc = useActiveIncident();
  const setShareToken = useCrisisStore((s) => s.setShareToken);
  const [publishing, setPublishing] = useState(false);
  const [copied, setCopied] = useState(false);

  const shareToken = inc?.shareToken ?? null;
  const shareUrl = shareToken ? `${window.location.origin}/?share=${shareToken}` : null;

  const handlePublish = async () => {
    if (!inc) return;
    setPublishing(true);
    try {
      const res = await fetch('/api/crisis/publish', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(extractPublicState(inc)),
      });
      if (!res.ok) throw new Error('Failed');
      const { token } = await res.json() as { token: string };
      setShareToken(token);
    } catch (err) {
      console.error('[crisis] publish failed', err);
    } finally {
      setPublishing(false);
    }
  };

  const handleCopy = () => {
    if (!shareUrl) return;
    navigator.clipboard.writeText(shareUrl).then(() => {
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    });
  };

  if (shareToken && shareUrl) {
    return (
      <div className="flex items-center gap-1.5">
        <span className="max-w-[160px] truncate rounded bg-green-500/10 px-2 py-1 text-[10px] text-green-400/80">
          {shareUrl}
        </span>
        <button onClick={handleCopy} className="rounded border border-white/10 px-2.5 py-1 text-[10px] text-white/50 transition hover:border-white/20 hover:text-white">
          {copied ? 'Copied!' : 'Copy'}
        </button>
        <button onClick={() => setShareToken(null)} className="text-[10px] text-white/20 transition hover:text-white/50" title="Stop sharing">✕</button>
      </div>
    );
  }

  return (
    <button
      onClick={handlePublish}
      disabled={publishing}
      className="rounded border border-white/12 px-3 py-1.5 text-[11px] text-white/50 transition hover:border-white/22 hover:text-white disabled:opacity-40"
    >
      {publishing ? 'Publishing…' : 'Share Link'}
    </button>
  );
}

// ── Auto-push the active incident to its share endpoint on every change ────────

function useAutoPublish() {
  const inc = useActiveIncident();
  const token = inc?.shareToken ?? null;
  const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => {
    if (!inc || !token) return;
    if (timerRef.current) clearTimeout(timerRef.current);
    timerRef.current = setTimeout(() => {
      fetch(`/api/crisis/share/${token}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(extractPublicState(inc)),
      }).catch(console.error);
    }, 1_500);
    return () => { if (timerRef.current) clearTimeout(timerRef.current); };
  }, [inc, token]);
}

// ── Incident detail (right-side panel, leaves the globe visible on the left) ───

function IncidentDetail() {
  const close      = useCrisisStore((s) => s.close);
  const backToList = useCrisisStore((s) => s.backToList);
  const removeIncident = useCrisisStore((s) => s.removeIncident);
  const activeTab  = useCrisisStore((s) => s.activeTab);
  const setTab     = useCrisisStore((s) => s.setTab);
  const inc        = useActiveIncident();

  if (!inc) return null;
  const { dot, badge } = STATUS_BADGE[inc.incidentStatus] ?? STATUS_BADGE.active;

  return (
    <div className="pointer-events-none fixed inset-0 z-[2000] flex">
      {/* Left: transparent — the live globe shows through and stays interactive */}
      <div className="pointer-events-none relative flex-1">
        <div className="absolute left-5 top-5 rounded-lg border border-white/10 bg-ink-950/70 px-3 py-1.5 backdrop-blur-sm">
          <div className="text-[8px] font-bold uppercase tracking-[0.18em] text-white/35">Live Map</div>
          <div className="text-[11px] text-white/60">Drawn layers shown · drag to explore</div>
        </div>
      </div>

      {/* Right: opaque editing panel — kept under half-width so the globe's
          centre stays visible in the reserved segment on the left */}
      <div className="pointer-events-auto flex h-full w-[46vw] min-w-[460px] max-w-[720px] flex-col border-l border-white/10 bg-ink-950/98 shadow-2xl backdrop-blur-sm">
        {/* Header */}
        <header className="flex shrink-0 items-center gap-3 border-b border-white/10 bg-ink-900/70 px-5 py-3">
          <button
            onClick={backToList}
            className="flex items-center gap-1 rounded border border-white/10 px-2.5 py-1.5 text-[11px] text-white/45 transition hover:border-white/22 hover:text-white"
            title="All incidents"
          >
            <svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
              <polyline points="15 18 9 12 15 6" />
            </svg>
            Incidents
          </button>

          <div className="flex min-w-0 items-center gap-2.5">
            <div className="relative flex h-2.5 w-2.5 shrink-0">
              {inc.incidentStatus === 'active' && (
                <span className="absolute inline-flex h-full w-full animate-ping rounded-full opacity-70" style={{ background: dot }} />
              )}
              <span className="relative inline-flex h-2.5 w-2.5 rounded-full" style={{ background: dot }} />
            </div>
            <div className="min-w-0">
              <div className="text-[9px] font-bold uppercase tracking-[0.18em] text-white/35">Situation Report</div>
              <div className="truncate text-[13px] font-semibold text-white/90">{inc.incidentName || 'Untitled Incident'}</div>
            </div>
            <span className={`shrink-0 rounded-full border px-2 py-0.5 text-[9px] font-bold uppercase tracking-widest ${badge}`}>
              {inc.incidentStatus}
            </span>
          </div>

          <div className="ml-auto flex items-center gap-2">
            <ShareButton />
            <button
              onClick={() => {
                if (confirm(`Delete incident "${inc.incidentName || 'Untitled'}"?`)) {
                  removeIncident(inc.id);
                }
              }}
              className="rounded border border-white/8 px-3 py-1.5 text-[11px] text-white/30 transition hover:border-red-500/30 hover:text-red-400/70"
            >
              Delete
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

        {/* Tabs */}
        <div className="flex shrink-0 gap-1 border-b border-white/8 bg-ink-900/40 px-5 py-2">
          {TABS.map((tab) => (
            <button
              key={tab.id}
              onClick={() => setTab(tab.id)}
              className={`rounded-md px-3.5 py-1.5 text-[12px] font-medium transition ${
                activeTab === tab.id ? 'bg-accent/15 text-accent' : 'text-white/40 hover:text-white/65'
              }`}
            >
              {tab.label}
            </button>
          ))}
          {['Resource Tracker', 'Comms Log'].map((label) => (
            <button key={label} disabled className="cursor-not-allowed rounded-md px-3.5 py-1.5 text-[12px] font-medium text-white/18" title="Coming soon">
              {label}
            </button>
          ))}
        </div>

        {/* Content */}
        <main className="min-h-0 flex-1 overflow-y-auto px-5 py-5">
          {activeTab === 'situation-report' && <SituationReport />}
        </main>
      </div>
    </div>
  );
}

// ── List shell (full screen) ──────────────────────────────────────────────────

function IncidentListShell() {
  const close = useCrisisStore((s) => s.close);
  return (
    <div className="fixed inset-0 z-[2000] flex flex-col bg-ink-950/98 backdrop-blur-sm">
      <header className="flex shrink-0 items-center gap-4 border-b border-white/10 bg-ink-900/70 px-6 py-3.5">
        <div className="flex items-center gap-2.5">
          <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="#ef4444" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
            <path d="M10.29 3.86L1.82 18a2 2 0 001.71 3h16.94a2 2 0 001.71-3L13.71 3.86a2 2 0 00-3.42 0z" />
            <line x1="12" y1="9" x2="12" y2="13" />
            <line x1="12" y1="17" x2="12.01" y2="17" />
          </svg>
          <div>
            <div className="text-[9px] font-bold uppercase tracking-[0.18em] text-white/35">Crisis Management</div>
            <div className="text-[14px] font-semibold text-white/90">Incident Dashboard</div>
          </div>
        </div>
        <button
          onClick={close}
          className="ml-auto flex items-center gap-1.5 rounded border border-white/12 px-3 py-1.5 text-[11px] text-white/50 transition hover:border-white/22 hover:text-white"
          aria-label="Close"
        >
          <svg width="11" height="11" viewBox="0 0 24 24" fill="none">
            <path d="M6 6L18 18M6 18L18 6" stroke="currentColor" strokeWidth="2" strokeLinecap="round" />
          </svg>
          Esc
        </button>
      </header>
      <main className="min-h-0 flex-1 overflow-y-auto px-6 py-6">
        <IncidentList />
      </main>
    </div>
  );
}

// ── Root ──────────────────────────────────────────────────────────────────────

export function CrisisOverlay() {
  const open  = useCrisisStore((s) => s.open);
  const close = useCrisisStore((s) => s.close);
  const activeIncidentId = useCrisisStore((s) => s.activeIncidentId);

  useAutoPublish();

  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') close(); };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [open, close]);

  if (!open) return null;

  return createPortal(
    activeIncidentId ? <IncidentDetail /> : <IncidentListShell />,
    document.body
  );
}
