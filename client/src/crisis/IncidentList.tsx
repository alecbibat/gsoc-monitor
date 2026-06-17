import { useCrisisStore, type Incident, type IncidentStatus, type IncidentType } from './crisisStore';

const STATUS_BADGE: Record<IncidentStatus, { dot: string; badge: string; label: string }> = {
  active:    { dot: '#ef4444', badge: 'text-red-400 bg-red-500/15 border-red-500/40',     label: 'Active' },
  contained: { dot: '#f59e0b', badge: 'text-amber-300 bg-amber-400/15 border-amber-400/40', label: 'Contained' },
  resolved:  { dot: '#22c55e', badge: 'text-green-400 bg-green-500/15 border-green-500/40', label: 'Resolved' },
};

const TYPE_LABEL: Record<IncidentType, string> = {
  wildfire: 'Wildfire',
  hurricane: 'Hurricane',
  earthquake: 'Earthquake',
  flood: 'Flood',
  chemical: 'Chemical / HazMat',
  'mass-casualty': 'Mass Casualty',
  cyber: 'Cyber',
  security: 'Security Threat',
  'severe-weather': 'Severe Weather',
  other: 'Other',
};

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

function IncidentCard({ incident }: { incident: Incident }) {
  const openIncident  = useCrisisStore((s) => s.openIncident);
  const removeIncident = useCrisisStore((s) => s.removeIncident);

  const sb = STATUS_BADGE[incident.incidentStatus];
  const assigned = incident.assignments.filter((a) => !a.endedAt).length;
  const actions  = incident.actionLog.filter((e) => e.entryType === 'action').length;
  const events   = incident.actionLog.filter((e) => e.entryType === 'event').length;

  return (
    <button
      onClick={() => openIncident(incident.id)}
      className="group flex flex-col rounded-xl border border-white/10 bg-ink-900/80 p-4 text-left transition hover:border-white/25 hover:bg-ink-900"
    >
      {/* Header */}
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
            <span>{TYPE_LABEL[incident.incidentType]}</span>
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

      {/* Summary snippet */}
      <p className="mt-3 line-clamp-2 min-h-[2.4em] text-[11px] leading-snug text-white/45">
        {incident.executiveSummary || <span className="text-white/25 italic">No executive summary yet</span>}
      </p>

      {/* Stats */}
      <div className="mt-3 grid grid-cols-4 gap-1 rounded-lg border border-white/6 bg-white/4 py-2">
        <Stat value={assigned} label="Staff" />
        <Stat value={actions}  label="Actions" />
        <Stat value={events}   label="Events" />
        <Stat value={incident.drawLayers.length} label="Layers" />
      </div>

      {/* Footer */}
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

export function IncidentList() {
  const incidents     = useCrisisStore((s) => s.incidents);
  const createIncident = useCrisisStore((s) => s.createIncident);

  const sorted = [...incidents].sort((a, b) => {
    const order = { active: 0, contained: 1, resolved: 2 };
    const d = order[a.incidentStatus] - order[b.incidentStatus];
    return d !== 0 ? d : new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime();
  });

  const activeCount = incidents.filter((i) => i.incidentStatus === 'active').length;

  return (
    <div className="mx-auto max-w-5xl">
      {/* Intro row */}
      <div className="mb-5 flex items-center justify-between">
        <div>
          <h2 className="text-[16px] font-semibold text-white/90">Incidents</h2>
          <p className="mt-0.5 text-[11px] text-white/40">
            {incidents.length === 0
              ? 'No incidents yet'
              : `${incidents.length} total · ${activeCount} active`}
          </p>
        </div>
        <button
          onClick={() => createIncident()}
          className="flex items-center gap-1.5 rounded-lg border border-red-500/40 bg-red-500/12 px-4 py-2 text-[12px] font-semibold text-red-400 transition hover:border-red-500/60 hover:bg-red-500/20"
        >
          <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round">
            <line x1="12" y1="5" x2="12" y2="19" />
            <line x1="5" y1="12" x2="19" y2="12" />
          </svg>
          New Incident
        </button>
      </div>

      {/* Grid */}
      {incidents.length === 0 ? (
        <button
          onClick={() => createIncident()}
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
          {sorted.map((inc) => (
            <IncidentCard key={inc.id} incident={inc} />
          ))}
        </div>
      )}
    </div>
  );
}
