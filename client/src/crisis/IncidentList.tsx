import { memo, useEffect, useId, useState } from 'react';
import { useCrisisStore, entryTypeOf, type Incident } from './crisisStore';
import {
  INCIDENT_CATEGORIES, incidentStatusDef, incidentTypeDef, incidentTypesInCategory,
  type IncidentType,
} from './taxonomy';
import { publishShareSnapshots } from './publishSnapshot';
import { useAuthStore } from '../auth/authStore';
import { CrisisReportModal } from './CrisisReportModal';
import { DeleteIncidentDialog } from './DeleteIncidentDialog';
import { hasLiveShare, shareLinkHealth, useNow } from './shareLinkStatus';
import { useSyncHealth } from './syncHealth';
import {
  aarProgress, fmtAgo, incidentPropertyLabel, lastActivityAt, localDateKey, staffedCount,
} from './incidentSummary';

// ── New-incident type picker ──────────────────────────────────────────────────
// Creation starts from the taxonomy (roadmap S3): picking a type first means
// the incident lands with its category color and sensible defaults instead of
// everything starting as "Other". A filter box takes focus on open: typing a
// few letters and Enter is faster under stress than scanning 26 types.

function NewIncidentPicker({ onClose }: { onClose: () => void }) {
  const createIncident = useCrisisStore((s) => s.createIncident);
  const [query, setQuery] = useState('');
  const titleId = useId();

  useEffect(() => {
    // Document capture + stopPropagation (same as logViews EntryDetailModal):
    // one Esc closes only this picker, not the whole crisis workspace behind it.
    const handler = (e: KeyboardEvent) => {
      if (e.key !== 'Escape') return;
      e.stopPropagation();
      onClose();
    };
    document.addEventListener('keydown', handler, true);
    return () => document.removeEventListener('keydown', handler, true);
  }, [onClose]);

  const pick = (type: IncidentType) => {
    createIncident(type);
    onClose();
  };

  // Matches a type's label, or its category's ("weather", "security").
  const q = query.trim().toLowerCase();
  const groups = INCIDENT_CATEGORIES
    .map((cat) => ({
      cat,
      types: incidentTypesInCategory(cat.id).filter(
        (t) => !q || t.label.toLowerCase().includes(q) || cat.label.toLowerCase().includes(q)
      ),
    }))
    .filter((g) => g.types.length > 0);
  const firstMatch = groups[0]?.types[0];

  return (
    <div className="fixed inset-0 z-[2600] flex items-center justify-center bg-black/60 p-4" onClick={onClose}>
      <div
        role="dialog"
        aria-modal="true"
        aria-labelledby={titleId}
        className="max-h-[80vh] w-full max-w-2xl overflow-y-auto rounded-xl border border-white/12 bg-ink-950 p-5 shadow-2xl"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="mb-3 flex items-center justify-between">
          <div>
            <h3 id={titleId} className="text-[15px] font-semibold text-white/90">New Incident</h3>
            <p className="mt-0.5 text-[11px] text-white/40">What kind of incident is this? You can change it later.</p>
          </div>
          <button onClick={onClose} aria-label="Close" className="rounded px-2 py-1 text-[12px] text-white/30 hover:text-white/60">✕</button>
        </div>
        <input
          autoFocus
          type="search"
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === 'Enter' && firstMatch) {
              e.preventDefault();
              pick(firstMatch.id);
            }
          }}
          placeholder="Filter types… (Enter picks the first match)"
          aria-label="Filter incident types"
          autoComplete="off"
          className="mb-4 w-full rounded-lg border border-white/12 bg-white/6 px-3 py-2 text-[12px] text-white/85 placeholder-white/30 outline-none focus:border-white/25"
        />
        <div className="space-y-4">
          {groups.map(({ cat, types }) => (
            <div key={cat.id}>
              <div className="mb-1.5 text-[9px] font-bold uppercase tracking-[0.16em] text-white/30">{cat.label}</div>
              <div className="grid grid-cols-2 gap-1.5 sm:grid-cols-3">
                {types.map((t) => (
                  <button
                    key={t.id}
                    onClick={() => pick(t.id)}
                    className={`flex items-center gap-2 rounded-lg border px-2.5 py-2 text-left text-[12px] text-white/75 transition hover:border-white/25 hover:bg-white/8 ${
                      q && t === firstMatch ? 'border-accent/40 bg-accent/8' : 'border-white/8 bg-white/4'
                    }`}
                  >
                    <span className="h-2 w-2 shrink-0 rounded-full" style={{ background: t.color }} />
                    <span className="truncate">{t.icon} {t.label}</span>
                  </button>
                ))}
              </div>
            </div>
          ))}
          {groups.length === 0 && (
            <p className="py-4 text-center text-[12px] text-white/40">
              No type matches “{query.trim()}”.{' '}
              <button onClick={() => pick('other')} className="text-accent/80 underline-offset-2 hover:underline">
                Start as Other
              </button>
            </p>
          )}
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
// Memoized: a peer's edit swaps only that incident's object in the store, so
// every other card skips the re-render (and its log scans). `now` ticks once
// a minute for the "last activity" and link-expiry labels.

const IncidentCard = memo(function IncidentCard({ incident, now }: { incident: Incident; now: number }) {
  const openIncident   = useCrisisStore((s) => s.openIncident);
  const removeIncident = useCrisisStore((s) => s.removeIncident);
  const [confirmDelete, setConfirmDelete] = useState(false);

  const sb = incidentStatusDef(incident.incidentStatus);
  const td = incidentTypeDef(incident.incidentType);
  const property = incidentPropertyLabel(incident.locationGroupId);
  const assigned = incident.assignments.filter((a) => !a.endedAt).length;
  // Operator-logged counts: auto-generated entries class as system, not events.
  const actions  = incident.actionLog.filter((e) => entryTypeOf(e) === 'action').length;
  const events   = incident.actionLog.filter((e) => entryTypeOf(e) === 'event').length;
  const shared   = hasLiveShare(incident, now);
  const links    = shareLinkHealth(incident.shareLinks, now);
  const name     = incident.incidentName || 'Untitled Incident';

  // The card is one big button; Delete is a SIBLING (a button inside a button
  // is invalid, and Enter on it opened the incident). It shows on hover and
  // keyboard focus, and always on touch screens, where there is no hover to
  // reveal it and an invisible tap target is a trap.
  return (
    <div className="group relative flex">
      <button
        onClick={() => openIncident(incident.id)}
        className="flex w-full flex-col rounded-xl border border-white/10 bg-ink-900/80 p-4 text-left transition hover:border-white/25 hover:bg-ink-900"
        style={{ borderLeft: `3px solid ${td.color}` }}
      >
        <div className="flex w-full items-start gap-2.5">
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
            <div className="mt-0.5 flex min-w-0 items-center gap-2 text-[10px] text-white/40">
              <span className="shrink-0" style={{ color: td.color }}>{td.icon} {td.label}</span>
              {property && (
                <>
                  <span className="text-white/20">·</span>
                  <span className="max-w-[50%] shrink-0 truncate text-white/60" title="Property">{property}</span>
                </>
              )}
              {incident.incidentLocation && (
                <>
                  <span className="text-white/20">·</span>
                  <span className="min-w-0 truncate">{incident.incidentLocation}</span>
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

        <div className="mt-3 grid w-full grid-cols-4 gap-1 rounded-lg border border-white/6 bg-white/4 py-2">
          <Stat value={assigned} label="Staff" />
          <Stat value={actions}  label="Actions" />
          <Stat value={events}   label="Events" />
          <Stat value={incident.drawLayers.length} label="Layers" />
        </div>

        {/* pr leaves room for the Delete button laid over this corner. */}
        <div className="mt-3 flex w-full flex-wrap items-center gap-x-2 gap-y-1 pr-16 text-[9px] text-white/30">
          <span>Created {fmtWhen(incident.createdAt)}</span>
          <span className="text-white/15">·</span>
          <span title="Latest log entry or checklist update">Updated {fmtAgo(lastActivityAt(incident, now), now)}</span>
          {shared ? (
            <span className="flex items-center gap-1 rounded bg-green-500/10 px-1.5 py-0.5 text-green-400/70">
              <span className="h-1 w-1 rounded-full bg-green-400" /> Shared
            </span>
          ) : links.expired > 0 && (
            <span className="rounded bg-amber-500/10 px-1.5 py-0.5 text-amber-300/80" title="Viewers see an expired page. Renew it from Share Links.">
              Link expired
            </span>
          )}
        </div>
      </button>
      <button
        onClick={() => setConfirmDelete(true)}
        aria-label={`Delete incident ${name}`}
        className="absolute bottom-2.5 right-2.5 rounded px-2.5 py-1.5 text-[10px] text-white/30 opacity-0 transition hover:bg-red-500/10 hover:text-red-400 focus:opacity-100 group-hover:opacity-100 [@media(hover:none)]:opacity-100"
      >
        Delete
      </button>
      {confirmDelete && (
        <DeleteIncidentDialog
          incident={incident}
          requirePhrase={!incident.archivedAt}
          onClose={() => setConfirmDelete(false)}
          onConfirm={() => { setConfirmDelete(false); removeIncident(incident.id); }}
        />
      )}
    </div>
  );
});

// ── Archived incident card ─────────────────────────────────────────────────────

function AarChip({ incident, today }: { incident: Incident; today: string }) {
  const p = aarProgress(incident.aar, today);
  const complete = p.answered === 4 && p.openActions === 0;
  const parts = [`AAR ${p.answered}/4`];
  if (p.openActions > 0) parts.push(`${p.openActions} open action${p.openActions === 1 ? '' : 's'}`);
  return (
    <span
      className={`rounded px-1.5 py-0.5 text-[9px] ${
        p.overdue > 0 ? 'bg-red-500/10 text-red-300/80'
          : complete ? 'bg-green-500/10 text-green-400/70'
          : 'bg-amber-500/10 text-amber-300/75'
      }`}
      title={`After-action review: ${p.answered} of 4 questions answered · ${p.openActions} open corrective action${p.openActions === 1 ? '' : 's'}${p.overdue ? `, ${p.overdue} overdue` : ''}`}
    >
      {complete ? 'AAR complete' : parts.join(' · ')}
      {p.overdue > 0 && ` (${p.overdue} overdue)`}
    </span>
  );
}

const ArchivedCard = memo(function ArchivedCard({
  incident,
  isAdmin,
  today,
  onReport,
}: {
  incident: Incident;
  isAdmin: boolean;
  today: string;
  onReport: (inc: Incident) => void;
}) {
  const openIncident   = useCrisisStore((s) => s.openIncident);
  const reopenIncident = useCrisisStore((s) => s.reopenIncident);
  const removeIncident = useCrisisStore((s) => s.removeIncident);
  const [confirmDelete, setConfirmDelete] = useState(false);

  // Everyone who held a role. Stand-down releases every seat, so a count of
  // open assignments would read 0 on every archived card.
  const staffed  = staffedCount(incident);
  const actions  = incident.actionLog.filter((e) => entryTypeOf(e) === 'action').length;
  const events   = incident.actionLog.filter((e) => entryTypeOf(e) === 'event').length;
  const property = incidentPropertyLabel(incident.locationGroupId);

  return (
    <div className="flex flex-col rounded-xl border border-white/8 bg-ink-900/50 p-4">
      {/* Header */}
      <div className="flex items-start gap-2.5">
        <div className="mt-1 h-2.5 w-2.5 shrink-0 rounded-full bg-white/20" />
        <div className="min-w-0 flex-1">
          <h3 className="truncate text-[15px] font-semibold text-white/65">
            {incident.incidentName || <span className="text-white/30">Untitled Incident</span>}
          </h3>
          <div className="mt-0.5 flex min-w-0 items-center gap-2 text-[10px] text-white/30">
            <span className="shrink-0">{incidentTypeDef(incident.incidentType).icon} {incidentTypeDef(incident.incidentType).label}</span>
            {property && (
              <>
                <span className="text-white/15">·</span>
                <span className="max-w-[50%] shrink-0 truncate text-white/45" title="Property">{property}</span>
              </>
            )}
            {incident.incidentLocation && (
              <>
                <span className="text-white/15">·</span>
                <span className="min-w-0 truncate">{incident.incidentLocation}</span>
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
        <Stat value={staffed}  label="Staffed" />
        <Stat value={actions}  label="Actions" />
        <Stat value={events}   label="Events" />
        <Stat value={incident.drawLayers.length} label="Layers" />
      </div>

      {/* Timestamps + actions */}
      <div className="mt-3 space-y-2.5">
        <div className="flex flex-wrap items-center gap-x-2 gap-y-1 text-[9px] text-white/25">
          <span>Created {fmtWhen(incident.createdAt)}</span>
          {incident.archivedAt && (
            <>
              <span className="text-white/15">·</span>
              <span>Stood down {fmtWhen(incident.archivedAt)}</span>
            </>
          )}
          <AarChip incident={incident} today={today} />
        </div>
        <div className="flex flex-wrap items-center gap-2">
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
          {/* After-action review: the four-question review, corrective
              actions, and the printable report */}
          <button
            onClick={() => onReport(incident)}
            className="flex items-center gap-1.5 rounded border border-white/10 px-3 py-1.5 text-[11px] text-white/40 transition hover:border-white/22 hover:text-white/70"
            title="After-action review and PDF report"
          >
            <svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
              <path d="M14 2H6a2 2 0 00-2 2v16a2 2 0 002 2h12a2 2 0 002-2V8z" />
              <polyline points="14 2 14 8 20 8" />
              <line x1="8" y1="13" x2="16" y2="13" />
              <line x1="8" y1="17" x2="13" y2="17" />
            </svg>
            After-Action Review
          </button>
          {/* Delete — admin only */}
          {isAdmin && (
            <button
              onClick={() => setConfirmDelete(true)}
              className="ml-auto rounded px-2 py-1.5 text-[11px] text-white/20 transition hover:bg-red-500/10 hover:text-red-400"
            >
              Delete
            </button>
          )}
        </div>
      </div>
      {confirmDelete && (
        <DeleteIncidentDialog
          incident={incident}
          requirePhrase={false}
          onClose={() => setConfirmDelete(false)}
          onConfirm={() => { setConfirmDelete(false); removeIncident(incident.id); }}
        />
      )}
    </div>
  );
});

// ── Root list ─────────────────────────────────────────────────────────────────

export function IncidentList() {
  const incidents      = useCrisisStore((s) => s.incidents);
  const user           = useAuthStore((s) => s.user);
  const isAdmin        = user?.role === 'admin';
  const now            = useNow(60_000);
  const today          = localDateKey(new Date(now));

  // The archive starts collapsed while anything is live: that is where the
  // operator's attention belongs, and the archive only grows.
  const [archiveOpen, setArchiveOpen] = useState(() => incidents.every((i) => !!i.archivedAt));
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

  // Until the initial load lands (it retries with backoff), an empty list
  // means "not loaded", not "no incidents" — inviting the operator to start
  // one would invite a duplicate. New Incident stays available regardless.
  const loadState = useSyncHealth((s) => s.loadState);
  const notLoaded = loadState !== 'ready' && incidents.length === 0;
  const notLoadedText = loadState === 'error' ? 'Can’t reach the server — retrying…' : 'Loading incidents…';

  return (
    <div className="mx-auto max-w-5xl">
      {/* Active section header */}
      <div className="mb-5 flex items-center justify-between">
        <div>
          <h2 className="text-[16px] font-semibold text-white/90">Incidents</h2>
          <p className="mt-0.5 text-[11px] text-white/40">
            {notLoaded
              ? notLoadedText
              : active.length === 0
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
      {notLoaded ? (
        <div
          role="status"
          className="flex w-full flex-col items-center justify-center rounded-xl border border-dashed border-white/15 bg-white/3 py-16 text-center"
        >
          {loadState === 'error' ? (
            <p className="text-[13px] font-medium text-amber-300/80">{notLoadedText}</p>
          ) : (
            <>
              <div className="mb-3 h-6 w-6 animate-spin rounded-full border-2 border-white/20 border-t-accent" />
              <p className="text-[13px] font-medium text-white/60">{notLoadedText}</p>
            </>
          )}
          <p className="mt-1 text-[11px] text-white/30">Existing incidents appear here once the server answers</p>
        </div>
      ) : active.length === 0 ? (
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
            <IncidentCard key={inc.id} incident={inc} now={now} />
          ))}
        </div>
      )}

      {/* Archive section */}
      {archived.length > 0 && (
        <div className="mt-10">
          <button
            onClick={() => setArchiveOpen((v) => !v)}
            aria-expanded={archiveOpen}
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
                  today={today}
                  onReport={setReportIncident}
                />
              ))}
            </div>
          )}
        </div>
      )}

      {/* New-incident type picker */}
      {pickerOpen && <NewIncidentPicker onClose={() => setPickerOpen(false)} />}

      {/* After-action review (report modal) */}
      {reportIncident && (
        <CrisisReportModal
          incident={reportIncident}
          onClose={() => setReportIncident(null)}
        />
      )}
    </div>
  );
}
