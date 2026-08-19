import { useEffect, useState } from 'react';
import { useCrisisStore, entryTypeOf, type Incident } from './crisisStore';
import {
  INCIDENT_CATEGORIES, incidentStatusDef, incidentTypeDef, incidentTypesInCategory,
  type IncidentType,
} from './taxonomy';
import { publishShareSnapshots } from './publishSnapshot';
import { useAuthStore } from '../auth/authStore';
import { CrisisReportModal } from './CrisisReportModal';

// ── New-incident type picker ──────────────────────────────────────────────────
// Creation starts from the taxonomy (roadmap S3): picking a type first means
// the incident lands with its category color and sensible defaults instead of
// everything starting as "Other".

function NewIncidentPicker({ onClose }: { onClose: () => void }) {
  const createIncident = useCrisisStore((s) => s.createIncident);

  useEffect(() => {
    const handler = (e: KeyboardEvent) => { if (e.key === 'Escape') onClose(); };
    window.addEventListener('keydown', handler);
    return () => window.removeEventListener('keydown', handler);
  }, [onClose]);

  const pick = (type: IncidentType) => {
    createIncident(type);
    onClose();
  };

  return (
    <div className="fixed inset-0 z-[2600] flex items-center justify-center bg-black/60 p-4" onClick={onClose}>
      <div
        className="max-h-[80vh] w-full max-w-2xl overflow-y-auto rounded-xl border border-white/12 bg-ink-950 p-5 shadow-2xl"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="mb-4 flex items-center justify-between">
          <div>
            <h3 className="text-[15px] font-semibold text-white/90">New Incident</h3>
            <p className="mt-0.5 text-[11px] text-white/40">What kind of incident is this? You can change it later.</p>
          </div>
          <button onClick={onClose} className="rounded px-2 py-1 text-[12px] text-white/30 hover:text-white/60">✕</button>
        </div>
        <div className="space-y-4">
          {INCIDENT_CATEGORIES.map((cat) => (
            <div key={cat.id}>
              <div className="mb-1.5 text-[9px] font-bold uppercase tracking-[0.16em] text-white/30">{cat.label}</div>
              <div className="grid grid-cols-2 gap-1.5 sm:grid-cols-3">
                {incidentTypesInCategory(cat.id).map((t) => (
                  <button
                    key={t.id}
                    onClick={() => pick(t.id)}
                    className="flex items-center gap-2 rounded-lg border border-white/8 bg-white/4 px-2.5 py-2 text-left text-[12px] text-white/75 transition hover:border-white/25 hover:bg-white/8"
                  >
                    <span className="h-2 w-2 shrink-0 rounded-full" style={{ background: t.color }} />
                    <span className="truncate">{t.icon} {t.label}</span>
                  </button>
                ))}
              </div>
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}

function fmtWhen(iso: string) {
  try {
    return new Date(iso).toLocaleString('en-US', {
      month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit',
    });
  } catch { return iso; }
}

function Stat({ value, label }: { value: number; label: string }) {
  return (
    <div className="text-center">
      <div className="text-[15px] font-semibold text-white/80">{value}</div>
      <div className="text-[8px] uppercase tracking-wider text-white/30">{label}</div>
    </div>
  );
}

// ── Active incident card ───────────────────────────────────────────────────────

function IncidentCard({ incident }: { incident: Incident }) {
  const openIncident   = useCrisisStore((s) => s.openIncident);
  const removeIncident = useCrisisStore((s) => s.removeIncident);

  const sb = incidentStatusDef(incident.incidentStatus);
  const td = incidentTypeDef(incident.incidentType);
  const assigned = incident.assignments.filter((a) => !a.endedAt).length;
  // Operator-logged counts: auto-generated entries class as system, not events.
  const actions  = incident.actionLog.filter((e) => entryTypeOf(e) === 'action').length;
  const events   = incident.actionLog.filter((e) => entryTypeOf(e) === 'event').length;

  return (
    <button
      onClick={() => openIncident(incident.id)}
      className="group flex flex-col rounded-xl border border-white/10 bg-ink-900/80 p-4 text-left transition hover:border-white/25 hover:bg-ink-900"
      style={{ borderLeft: `3px solid ${td.color}` }}
    >
      <div className="flex items-start gap-2.5">
        <div className="relative mt-1 flex h-2.5 w-2.5 shrink-0">
          {incident.incidentStatus === 'active' && (
            <span className="absolute inline-flex h-full w-full animate-ping rounded-full opacity-70" style={{ background: sb.dot }} />
          )}
          <span className="relative inline-flex h-2.5 w-2.5 rounded-full" style={{ background: sb.dot }} />
        </div>
        <div className="min-w-0 flex-1">
          <h3 className="truncate text-[15px] font-semibold text-white/90">
            {incident.incidentName || <span className="text-white/40">Untitled Incident</span>}
          </h3>
          <div className="mt-0.5 flex items-center gap-2 text-[10px] text-white/40">
            <span style={{ color: td.color }}>{td.icon} {td.label}</span>
            {incident.incidentLocation && (
              <>
                <span className="text-white/20">·</span>
                <span className="truncate">{incident.incidentLocation}</span>
              </>
            )}
          </div>
        </div>
        <span className={`shrink-0 rounded-full border px-2 py-0.5 text-[8px] font-bold uppercase tracking-widest ${sb.badge}`}>
          {sb.label}
        </span>
      </div>

      <p className="mt-3 line-clamp-2 min-h-[2.4em] text-[11px] leading-snug text-white/45">
        {incident.executiveSummary || <span className="text-white/25 italic">No executive summary yet</span>}
      </p>

      <div className="mt-3 grid grid-cols-4 gap-1 rounded-lg border border-white/6 bg-white/4 py-2">
        <Stat value={assigned} label="Staff" />
        <Stat value={actions}  label="Actions" />
        <Stat value={events}   label="Events" />
        <Stat value={incident.drawLayers.length} label="Layers" />
      </div>

      <div className="mt-3 flex items-center gap-2 text-[9px] text-white/30">
        <span>Created {fmtWhen(incident.createdAt)}</span>
        {incident.shareToken && (
          <span className="flex items-center gap-1 rounded bg-green-500/10 px-1.5 py-0.5 text-green-400/70">
            <span className="h-1 w-1 rounded-full bg-green-400" /> Shared
          </span>
        )}
        <span
          role="button"
          tabIndex={0}
          onClick={(e) => {
            e.stopPropagation();
            if (confirm(`Delete incident "${incident.incidentName || 'Untitled'}"? This cannot be undone.`)) {
              removeIncident(incident.id);
            }
          }}
          onKeyDown={(e) => e.stopPropagation()}
          className="ml-auto rounded px-2 py-0.5 text-white/25 opacity-0 transition hover:bg-red-500/10 hover:text-red-400 group-hover:opacity-100"
        >
          Delete
        </span>
      </div>
    </button>
  );
}

// ── Archived incident card ─────────────────────────────────────────────────────

function ArchivedCard({
  incident,
  isAdmin,
  onReport,
}: {
  incident: Incident;
  isAdmin: boolean;
  onReport: (inc: Incident) => void;
}) {
  const openIncident   = useCrisisStore((s) => s.openIncident);
  const reopenIncident = useCrisisStore((s) => s.reopenIncident);
  const removeIncident = useCrisisStore((s) => s.removeIncident);

  const assigned = incident.assignments.filter((a) => !a.endedAt).length;
  const actions  = incident.actionLog.filter((e) => entryTypeOf(e) === 'action').length;
  const events   = incident.actionLog.filter((e) => entryTypeOf(e) === 'event').length;

  return (
    <div className="flex flex-col rounded-xl border border-white/8 bg-ink-900/50 p-4">
      {/* Header */}
      <div className="flex items-start gap-2.5">
        <div className="mt-1 h-2.5 w-2.5 shrink-0 rounded-full bg-white/20" />
        <div className="min-w-0 flex-1">
          <h3 className="truncate text-[15px] font-semibold text-white/65">
            {incident.incidentName || <span className="text-white/30">Untitled Incident</span>}
          </h3>
          <div className="mt-0.5 flex items-center gap-2 text-[10px] text-white/30">
            <span>{incidentTypeDef(incident.incidentType).icon} {incidentTypeDef(incident.incidentType).label}</span>
            {incident.incidentLocation && (
              <>
                <span className="text-white/15">·</span>
                <span className="truncate">{incident.incidentLocation}</span>
              </>
            )}
          </div>
        </div>
        <span className="shrink-0 rounded-full border border-white/15 bg-white/6 px-2 py-0.5 text-[8px] font-bold uppercase tracking-widest text-white/40">
          Archived
        </span>
      </div>

      {/* Summary */}
      <p className="mt-3 line-clamp-2 min-h-[2.4em] text-[11px] leading-snug text-white/35">
        {incident.executiveSummary || <span className="italic text-white/20">No executive summary</span>}
      </p>

      {/* Stats */}
      <div className="mt-3 grid grid-cols-4 gap-1 rounded-lg border border-white/5 bg-white/3 py-2">
        <Stat value={assigned} label="Staff" />
        <Stat value={actions}  label="Actions" />
        <Stat value={events}   label="Events" />
        <Stat value={incident.drawLayers.length} label="Layers" />
      </div>

      {/* Timestamps + actions */}
      <div className="mt-3 space-y-2.5">
        <div className="flex items-center gap-2 text-[9px] text-white/25">
          <span>Created {fmtWhen(incident.createdAt)}</span>
          {incident.archivedAt && (
            <>
              <span className="text-white/15">·</span>
              <span>Stood down {fmtWhen(incident.archivedAt)}</span>
            </>
          )}
        </div>
        <div className="flex items-center gap-2">
          {/* View: open in detail */}
          <button
            onClick={() => openIncident(incident.id)}
            className="rounded border border-white/10 px-3 py-1.5 text-[11px] text-white/40 transition hover:border-white/22 hover:text-white/70"
          >
            View
          </button>
          {/* Reopen: clear archivedAt, makes it active again */}
          <button
            onClick={() => {
              if (confirm(`Reopen "${incident.incidentName || 'Untitled'}"? It will return to the active incident list.`)) {
                reopenIncident(incident.id);
                // Reopening from the list never mounts useAutoPublish for this
                // incident, so push the transition to the share links here
                // (mirrors what reopenIncident just stored).
                publishShareSnapshots({ ...incident, incidentStatus: 'monitoring', archivedAt: null });
              }
            }}
            className="rounded border border-accent/25 bg-accent/8 px-3 py-1.5 text-[11px] text-accent/70 transition hover:border-accent/45 hover:text-accent"
          >
            Reopen
          </button>
          {/* PDF Report */}
          <button
            onClick={() => onReport(incident)}
            className="flex items-center gap-1.5 rounded border border-white/10 px-3 py-1.5 text-[11px] text-white/40 transition hover:border-white/22 hover:text-white/70"
          >
            <svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
              <polyline points="6 9 6 2 18 2 18 9" />
              <path d="M6 18H4a2 2 0 01-2-2v-5a2 2 0 012-2h16a2 2 0 012 2v5a2 2 0 01-2 2h-2" />
              <rect x="6" y="14" width="12" height="8" />
            </svg>
            PDF Report
          </button>
          {/* Delete — admin only */}
          {isAdmin && (
            <button
              onClick={() => {
                if (confirm(`Permanently delete archived incident "${incident.incidentName || 'Untitled'}"? This cannot be undone.`)) {
                  removeIncident(incident.id);
                }
              }}
              className="ml-auto rounded px-2 py-1.5 text-[11px] text-white/20 transition hover:bg-red-500/10 hover:text-red-400"
            >
              Delete
            </button>
          )}
        </div>
      </div>
    </div>
  );
}

// ── Root list ─────────────────────────────────────────────────────────────────

export function IncidentList() {
  const incidents      = useCrisisStore((s) => s.incidents);
  const user           = useAuthStore((s) => s.user);
  const isAdmin        = user?.role === 'admin';

  const [archiveOpen, setArchiveOpen] = useState(true);
  const [reportIncident, setReportIncident] = useState<Incident | null>(null);
  const [pickerOpen, setPickerOpen] = useState(false);

  const active   = [...incidents]
    .filter((i) => !i.archivedAt)
    .sort((a, b) => {
      const d = incidentStatusDef(a.incidentStatus).listRank - incidentStatusDef(b.incidentStatus).listRank;
      return d !== 0 ? d : new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime();
    });

  const archived = [...incidents]
    .filter((i) => !!i.archivedAt)
    .sort((a, b) => new Date(b.archivedAt!).getTime() - new Date(a.archivedAt!).getTime());

  const activeCount = active.filter((i) => i.incidentStatus === 'active').length;

  return (
    <div className="mx-auto max-w-5xl">
      {/* Active section header */}
      <div className="mb-5 flex items-center justify-between">
        <div>
          <h2 className="text-[16px] font-semibold text-white/90">Incidents</h2>
          <p className="mt-0.5 text-[11px] text-white/40">
            {active.length === 0
              ? 'No active incidents'
              : `${active.length} total · ${activeCount} active`}
          </p>
        </div>
        <button
          onClick={() => setPickerOpen(true)}
          className="flex items-center gap-1.5 rounded-lg border border-red-500/40 bg-red-500/12 px-4 py-2 text-[12px] font-semibold text-red-400 transition hover:border-red-500/60 hover:bg-red-500/20"
        >
          <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round">
            <line x1="12" y1="5" x2="12" y2="19" />
            <line x1="5" y1="12" x2="19" y2="12" />
          </svg>
          New Incident
        </button>
      </div>

      {/* Active grid */}
      {active.length === 0 ? (
        <button
          onClick={() => setPickerOpen(true)}
          className="flex w-full flex-col items-center justify-center rounded-xl border border-dashed border-white/15 bg-white/3 py-16 text-center transition hover:border-white/30 hover:bg-white/5"
        >
          <div className="mb-3 flex h-12 w-12 items-center justify-center rounded-full border border-white/15 bg-white/5">
            <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" className="text-white/40">
              <path d="M10.29 3.86L1.82 18a2 2 0 001.71 3h16.94a2 2 0 001.71-3L13.71 3.86a2 2 0 00-3.42 0z" />
              <line x1="12" y1="9" x2="12" y2="13" />
              <line x1="12" y1="17" x2="12.01" y2="17" />
            </svg>
          </div>
          <p className="text-[13px] font-medium text-white/60">Start your first incident</p>
          <p className="mt-1 text-[11px] text-white/30">Create an incident to build its situation report, org chart, and map layers</p>
        </button>
      ) : (
        <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3">
          {active.map((inc) => (
            <IncidentCard key={inc.id} incident={inc} />
          ))}
        </div>
      )}

      {/* Archive section */}
      {archived.length > 0 && (
        <div className="mt-10">
          <button
            onClick={() => setArchiveOpen((v) => !v)}
            className="mb-4 flex w-full items-center gap-3 text-left"
          >
            <div className="flex items-center gap-2">
              <svg
                width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor"
                strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"
                className={`text-white/30 transition-transform ${archiveOpen ? 'rotate-90' : ''}`}
              >
                <polyline points="9 18 15 12 9 6" />
              </svg>
              <h2 className="text-[13px] font-semibold text-white/50">Archive</h2>
              <span className="rounded-full border border-white/10 bg-white/5 px-2 py-0.5 text-[9px] font-semibold text-white/30">
                {archived.length}
              </span>
            </div>
            <div className="h-px flex-1 bg-white/8" />
            {!isAdmin && (
              <span className="text-[9px] text-white/20">Admin required to delete</span>
            )}
          </button>

          {archiveOpen && (
            <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3">
              {archived.map((inc) => (
                <ArchivedCard
                  key={inc.id}
                  incident={inc}
                  isAdmin={isAdmin}
                  onReport={setReportIncident}
                />
              ))}
            </div>
          )}
        </div>
      )}

      {/* New-incident type picker */}
      {pickerOpen && <NewIncidentPicker onClose={() => setPickerOpen(false)} />}

      {/* PDF report modal */}
      {reportIncident && (
        <CrisisReportModal
          incident={reportIncident}
          onClose={() => setReportIncident(null)}
        />
      )}
    </div>
  );
}
