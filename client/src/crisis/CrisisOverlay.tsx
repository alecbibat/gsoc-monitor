import { useEffect, useState } from 'react';
import { createPortal } from 'react-dom';
import {
  useCrisisStore, useActiveIncident, extractPublicState, type CrisisTab,
} from './crisisStore';
import { useAuthStore } from '../auth/authStore';
import { SituationReport } from './tabs/SituationReport';
import { IncidentList } from './IncidentList';
import { CrisisReportModal } from './CrisisReportModal';

const TABS: { id: CrisisTab; label: string }[] = [
  { id: 'situation-report', label: 'Situation Report' },
];

const STATUS_BADGE: Record<string, { dot: string; badge: string }> = {
  active:    { dot: '#ef4444', badge: 'text-red-400 bg-red-500/15 border-red-500/40' },
  contained: { dot: '#f59e0b', badge: 'text-amber-300 bg-amber-400/15 border-amber-400/40' },
  resolved:  { dot: '#22c55e', badge: 'text-green-400 bg-green-500/15 border-green-500/40' },
};

// ── Share links panel ─────────────────────────────────────────────────────────

function ShareLinksPanel() {
  const inc = useActiveIncident();
  const addShareLink = useCrisisStore((s) => s.addShareLink);
  const deactivateShareLink = useCrisisStore((s) => s.deactivateShareLink);
  const [open, setOpen] = useState(false);
  const [publishing, setPublishing] = useState(false);
  const [copiedToken, setCopiedToken] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  const shareLinks = inc?.shareLinks ?? [];
  const activeLinks = shareLinks.filter((l) => l.active);

  const handleCreate = async () => {
    if (!inc) return;
    setPublishing(true);
    setError(null);
    try {
      const res = await fetch('/api/crisis/publish', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(extractPublicState(inc)),
      });
      if (res.status === 413) throw new Error('Incident is too large to share (too many images/attachments).');
      if (!res.ok) throw new Error('Could not create link — please try again.');
      const { token, url } = await res.json() as { token: string; url: string };
      const fullUrl = `${window.location.origin}${url}`;
      addShareLink(token, fullUrl);
      setOpen(true);
    } catch (err) {
      console.error('[crisis] publish failed', err);
      setError(err instanceof Error ? err.message : 'Could not create link.');
    } finally {
      setPublishing(false);
    }
  };

  const handleDeactivate = async (token: string) => {
    deactivateShareLink(token);
    try {
      await fetch(`/api/crisis/share/${token}`, { method: 'DELETE' });
    } catch { /* server already gone */ }
  };

  const handleCopy = (url: string, token: string) => {
    navigator.clipboard.writeText(url).then(() => {
      setCopiedToken(token);
      setTimeout(() => setCopiedToken(null), 2000);
    });
  };

  return (
    <div className="relative">
      <button
        onClick={() => setOpen((v) => !v)}
        className={`flex items-center gap-1.5 rounded border px-3 py-1.5 text-[11px] transition ${
          activeLinks.length > 0
            ? 'border-green-500/30 bg-green-500/8 text-green-400/80 hover:border-green-500/50 hover:text-green-400'
            : 'border-white/12 text-white/50 hover:border-white/22 hover:text-white'
        }`}
      >
        {activeLinks.length > 0 && (
          <span className="h-1.5 w-1.5 rounded-full bg-green-500 animate-pulse" />
        )}
        Share Links
        {activeLinks.length > 0 && (
          <span className="rounded bg-green-500/20 px-1 text-[9px] text-green-400">{activeLinks.length}</span>
        )}
      </button>

      {open && (
        <div className="absolute right-0 top-full z-50 mt-1.5 w-80 rounded-lg border border-white/12 bg-ink-900/98 shadow-2xl backdrop-blur-sm">
          <div className="border-b border-white/8 px-3 py-2.5 flex items-center justify-between">
            <span className="text-[10px] font-bold uppercase tracking-wider text-white/40">Share Links</span>
            <button onClick={() => setOpen(false)} className="text-white/25 hover:text-white/55 text-[11px]">✕</button>
          </div>

          <div className="max-h-64 overflow-y-auto">
            {shareLinks.length === 0 ? (
              <p className="px-3 py-4 text-center text-[10px] text-white/30">
                No links created yet — create one below
              </p>
            ) : (
              <div className="divide-y divide-white/6">
                {[...shareLinks].reverse().map((link) => (
                  <div key={link.token} className={`px-3 py-2.5 ${link.active ? '' : 'opacity-40'}`}>
                    <div className="flex items-center gap-1.5 mb-1">
                      <span className={`h-1.5 w-1.5 rounded-full shrink-0 ${link.active ? 'bg-green-500' : 'bg-white/20'}`} />
                      <span className="text-[9px] text-white/35">
                        {link.active ? 'Active' : 'Revoked'} · {new Date(link.createdAt).toLocaleString(undefined, { month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit' })}
                      </span>
                    </div>
                    <div className="flex items-center gap-1.5">
                      <code className="min-w-0 flex-1 truncate rounded bg-white/5 px-1.5 py-0.5 text-[9px] text-white/50">
                        {link.url}
                      </code>
                      {link.active && (
                        <>
                          <button
                            onClick={() => handleCopy(link.url, link.token)}
                            className="shrink-0 rounded border border-white/10 px-2 py-0.5 text-[9px] text-white/45 transition hover:border-white/20 hover:text-white"
                          >
                            {copiedToken === link.token ? '✓' : 'Copy'}
                          </button>
                          <button
                            onClick={() => handleDeactivate(link.token)}
                            className="shrink-0 text-[9px] text-white/20 transition hover:text-red-400/70"
                            title="Revoke this link"
                          >
                            Revoke
                          </button>
                        </>
                      )}
                    </div>
                  </div>
                ))}
              </div>
            )}
          </div>

          <div className="border-t border-white/8 px-3 py-2.5">
            <button
              onClick={handleCreate}
              disabled={publishing}
              className="w-full rounded bg-accent/15 py-1.5 text-[10px] text-accent transition hover:bg-accent/25 disabled:opacity-40"
            >
              {publishing ? 'Creating…' : '+ Create new link'}
            </button>
            {error ? (
              <p className="mt-1.5 text-center text-[8px] text-red-400/80">{error}</p>
            ) : (
              <p className="mt-1.5 text-center text-[8px] text-white/20">
                Links stay active until you revoke them
              </p>
            )}
          </div>
        </div>
      )}
    </div>
  );
}

// ── Incident detail (right-side panel, leaves the globe visible on the left) ───

function IncidentDetail() {
  const close            = useCrisisStore((s) => s.close);
  const backToList       = useCrisisStore((s) => s.backToList);
  const removeIncident   = useCrisisStore((s) => s.removeIncident);
  const standDown        = useCrisisStore((s) => s.standDownIncident);
  const reopen           = useCrisisStore((s) => s.reopenIncident);
  const activeTab        = useCrisisStore((s) => s.activeTab);
  const setTab           = useCrisisStore((s) => s.setTab);
  const inc              = useActiveIncident();
  const user             = useAuthStore((s) => s.user);
  const [showReport, setShowReport] = useState(false);

  if (!inc) return null;
  const isArchived = !!inc.archivedAt;
  const canDelete  = !isArchived || user?.role === 'admin';
  const { dot, badge } = STATUS_BADGE[inc.incidentStatus] ?? STATUS_BADGE.active;

  return (
    <>
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
      <div className="pointer-events-auto flex h-full w-full flex-col border-l border-white/10 bg-ink-950/98 pb-safe shadow-2xl backdrop-blur-sm md:w-[46vw] md:min-w-[460px] md:max-w-[720px]">
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
              {inc.incidentStatus === 'active' && !isArchived && (
                <span className="absolute inline-flex h-full w-full animate-ping rounded-full opacity-70" style={{ background: dot }} />
              )}
              <span className="relative inline-flex h-2.5 w-2.5 rounded-full" style={{ background: isArchived ? '#4b5563' : dot }} />
            </div>
            <div className="min-w-0">
              <div className="text-[9px] font-bold uppercase tracking-[0.18em] text-white/35">Situation Report</div>
              <div className="truncate text-[13px] font-semibold text-white/90">{inc.incidentName || 'Untitled Incident'}</div>
            </div>
            <span className={`shrink-0 rounded-full border px-2 py-0.5 text-[9px] font-bold uppercase tracking-widest ${badge}`}>
              {inc.incidentStatus}
            </span>
            {isArchived && (
              <span className="shrink-0 rounded-full border border-white/15 bg-white/6 px-2 py-0.5 text-[9px] font-bold uppercase tracking-widest text-white/40">
                Archived
              </span>
            )}
          </div>

          <div className="ml-auto flex items-center gap-2">
            {!isArchived && <ShareLinksPanel />}

            {/* Stand-down or reopen depending on archive state */}
            {isArchived ? (
              <>
                <button
                  onClick={() => setShowReport(true)}
                  className="flex items-center gap-1.5 rounded border border-white/10 px-3 py-1.5 text-[11px] text-white/40 transition hover:border-white/22 hover:text-white/70"
                >
                  <svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                    <polyline points="6 9 6 2 18 2 18 9" />
                    <path d="M6 18H4a2 2 0 01-2-2v-5a2 2 0 012-2h16a2 2 0 012 2v5a2 2 0 01-2 2h-2" />
                    <rect x="6" y="14" width="12" height="8" />
                  </svg>
                  PDF Report
                </button>
                <button
                  onClick={() => {
                    if (confirm(`Reopen "${inc.incidentName || 'Untitled'}"? It will return to the active incident list.`)) {
                      reopen(inc.id);
                    }
                  }}
                  className="rounded border border-accent/25 bg-accent/8 px-3 py-1.5 text-[11px] text-accent/70 transition hover:border-accent/45 hover:text-accent"
                >
                  Reopen Incident
                </button>
              </>
            ) : (
              <button
                onClick={() => {
                  if (confirm(`Stand down incident "${inc.incidentName || 'Untitled'}"?\n\nIt will be moved to the archive. You can reopen or generate a PDF report from the archive.`)) {
                    standDown(inc.id);
                  }
                }}
                className="rounded border border-amber-500/25 bg-amber-500/8 px-3 py-1.5 text-[11px] text-amber-300/60 transition hover:border-amber-500/40 hover:text-amber-300/90"
              >
                Stand Down
              </button>
            )}

            {canDelete && (
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
            )}

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

    {showReport && (
      <CrisisReportModal incident={inc} onClose={() => setShowReport(false)} />
    )}
    </>
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

// Auto-publish of share links lives in IncidentSync (always mounted); this
// overlay is lazy-loaded and only mounted while open — see App.tsx.
export function CrisisOverlay() {
  const open  = useCrisisStore((s) => s.open);
  const close = useCrisisStore((s) => s.close);
  const activeIncidentId = useCrisisStore((s) => s.activeIncidentId);

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
