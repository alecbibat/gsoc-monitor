// Printable archive report for a stood-down incident. Mirrors the layout of
// CrisisShareView but uses local Incident data (no API call, no SSE). Opened
// in a portal, and print CSS injected via useEffect hides everything else on
// the page so Ctrl-P / Cmd-P / Save as PDF renders only this report.

import { lazy, Suspense, useEffect } from 'react';
import { createPortal } from 'react-dom';
import type { Incident, IcsRole, PersonnelAssignment } from './crisisStore';
import { incidentStatusDef, incidentTypeDef } from './taxonomy';
import { usePrintStyles } from '../lib/printStyles';

// Lazy so Leaflet (used only by this printable report and the share view)
// stays out of the main bundle.
const CrisisShareMap = lazy(() =>
  import('./CrisisShareMap').then((m) => ({ default: m.CrisisShareMap }))
);

const ENTRY_STYLES = {
  action: 'text-blue-300 bg-blue-400/15 border-blue-400/30',
  event:  'text-amber-300 bg-amber-400/15 border-amber-400/30',
  info:   'text-cyan-300 bg-cyan-400/15 border-cyan-400/30',
};

function fmtTs(iso: string) {
  try {
    return new Date(iso).toLocaleString('en-US', {
      month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit', timeZoneName: 'short',
    });
  } catch { return iso; }
}

// ── Read-only org chart (always fully expanded for print) ─────────────────────

const WIRE = 'rgba(255,255,255,0.12)';
const WIRE_DASH = `repeating-linear-gradient(to right,${WIRE} 0,${WIRE} 5px,transparent 5px,transparent 10px)`;

function Stem({ h = 22, dashed = false }: { h?: number; dashed?: boolean }) {
  return (
    <div className="w-px shrink-0" style={{
      height: h,
      background: dashed
        ? `repeating-linear-gradient(to bottom,${WIRE} 0,${WIRE} 4px,transparent 4px,transparent 8px)`
        : WIRE,
    }} />
  );
}

function ConnectorRow({ children, dashed = false }: { children: React.ReactNode; dashed?: boolean }) {
  const items = Array.isArray(children) ? children : [children];
  const n = items.filter(Boolean).length;
  const sidePct = 50 / n;
  return (
    <div className="relative flex w-full">
      {n > 1 && (
        <div aria-hidden className="pointer-events-none absolute top-0 h-px" style={{ left: `${sidePct}%`, right: `${sidePct}%`, background: dashed ? WIRE_DASH : WIRE }} />
      )}
      {items.filter(Boolean).map((child, i) => (
        <div key={i} className="flex flex-1 flex-col items-center">
          <Stem dashed={dashed} />
          {child}
        </div>
      ))}
    </div>
  );
}

function OrgNode({ role, assignments }: { role: IcsRole; assignments: PersonnelAssignment[] }) {
  const active = assignments.find((a) => a.roleId === role.id && !a.endedAt);
  return (
    <div className="rounded-md border bg-ink-900/80 text-center" style={{ minWidth: role.parentId === null ? '160px' : '110px', borderColor: `${role.color}40` }}>
      <div className="h-0.5 w-full rounded-t-md" style={{ background: role.color }} />
      <div className="px-2 py-2">
        {role.abbrev && <p className="mb-0.5 text-[8px] font-bold uppercase tracking-[0.14em]" style={{ color: role.color }}>{role.abbrev}</p>}
        <p className={`font-semibold leading-tight text-white/85 ${role.parentId === null ? 'text-[11px]' : 'text-[9px]'}`}>{role.title}</p>
        <p className="mt-1 text-[8px] text-white/35">{active ? active.name : '—'}</p>
      </div>
    </div>
  );
}

function OrgSubtree({ roleId, roles, assignments }: { roleId: string; roles: IcsRole[]; assignments: PersonnelAssignment[] }) {
  const role = roles.find((r) => r.id === roleId);
  if (!role) return null;
  const children = roles.filter((r) => r.parentId === roleId).sort((a, b) => a.order - b.order);
  const cmdKids = children.filter((r) => r.isCommandStaff);
  const regKids = children.filter((r) => !r.isCommandStaff);

  return (
    <div className="flex flex-col items-center">
      <OrgNode role={role} assignments={assignments} />
      {cmdKids.length > 0 && (
        <>
          <Stem h={12} dashed />
          <ConnectorRow dashed>
            {cmdKids.map((r) => <OrgSubtree key={r.id} roleId={r.id} roles={roles} assignments={assignments} />)}
          </ConnectorRow>
        </>
      )}
      {cmdKids.length > 0 && regKids.length > 0 && (
        <div className="my-3 flex w-full items-center gap-2 px-1">
          <div className="h-px flex-1" style={{ background: WIRE }} />
          <span className="text-[7px] font-bold uppercase tracking-wider text-white/25">General Staff</span>
          <div className="h-px flex-1" style={{ background: WIRE }} />
        </div>
      )}
      {regKids.length > 0 && (
        <>
          {cmdKids.length === 0 && <Stem />}
          <ConnectorRow>
            {regKids.map((r) => <OrgSubtree key={r.id} roleId={r.id} roles={roles} assignments={assignments} />)}
          </ConnectorRow>
        </>
      )}
    </div>
  );
}

// ── Main modal ────────────────────────────────────────────────────────────────

interface Props {
  incident: Incident;
  onClose: () => void;
}

export function CrisisReportModal({ incident, onClose }: Props) {
  // Shared report print stylesheet: paper-light theme, page-break discipline,
  // repeating page header (see lib/printStyles.ts).
  usePrintStyles('crisis-report-root');

  useEffect(() => {
    const handler = (e: KeyboardEvent) => { if (e.key === 'Escape') onClose(); };
    window.addEventListener('keydown', handler);
    return () => window.removeEventListener('keydown', handler);
  }, [onClose]);

  const { dot, badge, label: statusLabel } = incidentStatusDef(incident.incidentStatus);
  const roots = incident.roles.filter((r) => r.parentId === null);
  const mapLayers = incident.drawLayers.filter((l) => l.positions.length > 0);

  const modal = (
    <div className="crisis-report-root fixed inset-0 z-[3000] overflow-y-auto bg-ink-950 text-white">

      {/* Repeating page header — print only */}
      <div className="print-page-header hidden">
        <span className="font-bold uppercase tracking-widest">GSOC Monitor · Incident Archive Report</span>
        <span>{incident.incidentName || 'Untitled Incident'}</span>
        <span className="ml-auto">Generated {new Date().toLocaleString()}</span>
      </div>

      {/* Top bar — hidden when printing */}
      <div className="crisis-report-no-print sticky top-0 z-10 flex items-center gap-4 border-b border-white/8 bg-ink-900/90 px-8 py-3 backdrop-blur-sm">
        <div>
          <p className="text-[9px] font-bold uppercase tracking-[0.18em] text-white/30">Incident Archive Report</p>
          <p className="text-[15px] font-semibold text-white/85">{incident.incidentName || 'Untitled Incident'}</p>
        </div>
        <div className="ml-auto flex items-center gap-2">
          <button
            onClick={() => window.print()}
            className="flex items-center gap-1.5 rounded border border-accent/30 bg-accent/8 px-3 py-1.5 text-[11px] text-accent transition hover:border-accent/50 hover:bg-accent/18"
          >
            <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
              <polyline points="6 9 6 2 18 2 18 9" />
              <path d="M6 18H4a2 2 0 01-2-2v-5a2 2 0 012-2h16a2 2 0 012 2v5a2 2 0 01-2 2h-2" />
              <rect x="6" y="14" width="12" height="8" />
            </svg>
            Print / Save as PDF
          </button>
          <button
            onClick={onClose}
            className="flex items-center gap-1.5 rounded border border-white/12 px-3 py-1.5 text-[11px] text-white/50 transition hover:border-white/22 hover:text-white"
          >
            <svg width="10" height="10" viewBox="0 0 24 24" fill="none">
              <path d="M6 6L18 18M6 18L18 6" stroke="currentColor" strokeWidth="2" strokeLinecap="round" />
            </svg>
            Close
          </button>
        </div>
      </div>

      {/* Report header */}
      <header className="border-b border-white/8 bg-ink-900/90 px-8 py-4">
        <div className="mx-auto flex max-w-5xl items-center gap-4">
          <div className="relative flex h-2.5 w-2.5 shrink-0">
            <span className="relative inline-flex h-2.5 w-2.5 rounded-full" style={{ background: dot }} />
          </div>
          <div>
            <p className="text-[9px] font-bold uppercase tracking-[0.18em] text-white/30">Incident Archive Report</p>
            <p className="text-[18px] font-semibold text-white/90">{incident.incidentName || 'Unnamed Incident'}</p>
          </div>
          <span className={`print-color shrink-0 rounded-full border px-2.5 py-0.5 text-[9px] font-bold uppercase tracking-widest ${badge}`}>
            {statusLabel}
          </span>
          <span className="shrink-0 rounded-full border border-white/20 bg-white/8 px-2.5 py-0.5 text-[9px] font-bold uppercase tracking-widest text-white/50">
            Archived
          </span>
          <div className="ml-auto text-right">
            {incident.archivedAt && (
              <>
                <p className="text-[9px] text-white/25">Stood down</p>
                <p className="text-[10px] text-white/45">{fmtTs(incident.archivedAt)}</p>
              </>
            )}
          </div>
        </div>
      </header>

      <main className="mx-auto max-w-5xl space-y-8 px-8 py-8">

        {/* Summary + details */}
        <div className="grid grid-cols-2 gap-6">
          <div>
            <h2 className="mb-3 text-[10px] font-bold uppercase tracking-[0.14em] text-white/30">Executive Summary</h2>
            <p className="whitespace-pre-wrap rounded-lg border border-white/8 bg-white/4 px-4 py-3 text-[13px] leading-relaxed text-white/75">
              {incident.executiveSummary || <span className="text-white/25 italic">No summary provided</span>}
            </p>
          </div>
          <div>
            <h2 className="mb-3 text-[10px] font-bold uppercase tracking-[0.14em] text-white/30">Incident Details</h2>
            <div className="space-y-2 rounded-lg border border-white/8 bg-white/4 px-4 py-3">
              {([
                ['Location', incident.incidentLocation],
                ['Start', incident.incidentDatetime ? new Date(incident.incidentDatetime).toLocaleString() : '—'],
                ['End', incident.incidentEndDatetime ? new Date(incident.incidentEndDatetime).toLocaleString() : '—'],
                ['Type', incidentTypeDef(incident.incidentType).label],
                ['Created', fmtTs(incident.createdAt)],
                ['Archived', incident.archivedAt ? fmtTs(incident.archivedAt) : '—'],
                ...(incident.closedBy ? [['Stood down by', incident.closedBy]] : []),
                ...(incident.standDownReason ? [['Reason', incident.standDownReason]] : []),
              ] as [string, string][]).map(([label, value]) => (
                <div key={label} className="flex gap-3">
                  <span className="w-20 shrink-0 text-[10px] text-white/35">{label}</span>
                  <span className="text-[12px] text-white/75 capitalize">{value || '—'}</span>
                </div>
              ))}
            </div>
          </div>
        </div>

        {/* Org chart */}
        {roots.length > 0 && (
          <div>
            <h2 className="mb-3 text-[10px] font-bold uppercase tracking-[0.14em] text-white/30">ICS / NIMS Organizational Structure</h2>
            <div className="overflow-x-auto rounded-lg border border-white/8 bg-ink-950/60 px-6 py-5">
              <div className="flex min-w-[700px] flex-col items-center py-2">
                {roots.map((r) => (
                  <OrgSubtree key={r.id} roleId={r.id} roles={incident.roles} assignments={incident.assignments} />
                ))}
              </div>
            </div>
          </div>
        )}

        {/* Action log */}
        {incident.actionLog.length > 0 && (
          <div>
            <h2 className="mb-3 text-[10px] font-bold uppercase tracking-[0.14em] text-white/30">
              Actions &amp; Events Log
              <span className="ml-2 font-normal normal-case text-white/25">({incident.actionLog.length} entries)</span>
            </h2>
            <div className="divide-y divide-white/6 rounded-lg border border-white/8 bg-ink-950/60">
              {[...incident.actionLog]
                .sort((a, b) => new Date(b.timestamp).getTime() - new Date(a.timestamp).getTime())
                .map((entry) => (
                  <div key={entry.id} className="flex items-start gap-3 px-4 py-3">
                    <span className={`print-color mt-0.5 shrink-0 rounded-full border px-1.5 py-0.5 text-[7px] font-bold uppercase tracking-widest ${ENTRY_STYLES[entry.entryType ?? 'action']}`}>
                      {entry.entryType ?? 'action'}
                    </span>
                    <span className="w-36 shrink-0 text-[10px] text-white/30">{fmtTs(entry.timestamp)}</span>
                    <p className="flex-1 text-[12px] leading-snug text-white/70">
                      {entry.description || <span className="text-white/25 italic">No description</span>}
                    </p>
                    {entry.attachmentData && (
                      <img
                        src={entry.attachmentData}
                        alt={entry.attachmentName}
                        className="shrink-0 max-h-48 max-w-[220px] rounded border border-white/12 object-cover shadow-lg"
                      />
                    )}
                  </div>
                ))}
            </div>
          </div>
        )}

        {/* Incident map */}
        {mapLayers.length > 0 && (
          <div>
            <h2 className="mb-3 text-[10px] font-bold uppercase tracking-[0.14em] text-white/30">Incident Map</h2>
            <Suspense fallback={<div className="h-40 rounded-lg bg-white/5" />}>
              <CrisisShareMap layers={mapLayers} />
            </Suspense>
          </div>
        )}

        {/* Map layer list with thumbnails */}
        {incident.drawLayers.length > 0 && (
          <div>
            <h2 className="mb-3 text-[10px] font-bold uppercase tracking-[0.14em] text-white/30">Map Layers</h2>
            <div className="space-y-3">
              {incident.drawLayers.map((layer) => (
                <div key={layer.id} className="overflow-hidden rounded-lg border border-white/8 bg-ink-950/60">
                  {layer.thumbnail && (
                    <img src={layer.thumbnail} alt={`${layer.name} map view`} className="h-40 w-full object-cover" />
                  )}
                  <div className="flex items-center gap-2 px-3 py-2">
                    <div className="h-3 w-3 shrink-0 rounded-full" style={{ background: layer.color }} />
                    <span className="text-[11px] text-white/70">{layer.name}</span>
                    <span className="text-[9px] text-white/30">{layer.type} · {layer.geometry}</span>
                    <span className="ml-auto text-[9px] text-white/25">{layer.positions.length} points</span>
                  </div>
                </div>
              ))}
            </div>
          </div>
        )}

        {/* Footer */}
        <p className="border-t border-white/6 pt-4 text-center text-[9px] text-white/20">
          Created {fmtTs(incident.createdAt)}
          {incident.archivedAt && ` · Stood down ${fmtTs(incident.archivedAt)}`}
          {' · '}Report generated {new Date().toLocaleString()}
        </p>
      </main>
    </div>
  );

  return createPortal(modal, document.body);
}
