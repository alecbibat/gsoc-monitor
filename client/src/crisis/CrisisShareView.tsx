import { useEffect, useState } from 'react';
import type { CrisisPublicState, IcsRole, PersonnelAssignment } from './crisisStore';

const STATUS_BADGE: Record<string, { dot: string; badge: string }> = {
  active:    { dot: '#ef4444', badge: 'text-red-400 bg-red-500/15 border-red-500/40' },
  contained: { dot: '#f59e0b', badge: 'text-amber-300 bg-amber-400/15 border-amber-400/40' },
  resolved:  { dot: '#22c55e', badge: 'text-green-400 bg-green-500/15 border-green-500/40' },
};

const TYPE_STYLES = {
  action: 'text-blue-300 bg-blue-400/15 border-blue-400/30',
  event:  'text-amber-300 bg-amber-400/15 border-amber-400/30',
};

function fmtTs(iso: string) {
  try { return new Date(iso).toLocaleString('en-US', { month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit', timeZoneName: 'short' }); }
  catch { return iso; }
}

// ── Read-only org chart ───────────────────────────────────────────────────────

const WIRE = 'rgba(255,255,255,0.12)';
const WIRE_DASH = `repeating-linear-gradient(to right,${WIRE} 0,${WIRE} 5px,transparent 5px,transparent 10px)`;

function ROStem({ h = 22, dashed = false }: { h?: number; dashed?: boolean }) {
  return (
    <div className="w-px shrink-0" style={{
      height: h,
      background: dashed
        ? `repeating-linear-gradient(to bottom,${WIRE} 0,${WIRE} 4px,transparent 4px,transparent 8px)`
        : WIRE,
    }} />
  );
}

function ROConnectorRow({ children, dashed = false }: { children: React.ReactNode; dashed?: boolean }) {
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
          <ROStem dashed={dashed} />
          {child}
        </div>
      ))}
    </div>
  );
}

function RONode({ role, assignments }: { role: IcsRole; assignments: PersonnelAssignment[] }) {
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

function ROSubtree({ roleId, roles, assignments, depth = 0 }: { roleId: string; roles: IcsRole[]; assignments: PersonnelAssignment[]; depth?: number }) {
  const [collapsed, setCollapsed] = useState(depth >= 1);
  const role = roles.find((r) => r.id === roleId);
  if (!role) return null;
  const children = roles.filter((r) => r.parentId === roleId).sort((a, b) => a.order - b.order);
  const cmdKids = children.filter((r) => r.isCommandStaff);
  const regKids = children.filter((r) => !r.isCommandStaff);
  const show = depth === 0 || !collapsed;

  return (
    <div className="flex flex-col items-center">
      <RONode role={role} assignments={assignments} />
      {cmdKids.length > 0 && (
        <>
          <ROStem h={12} dashed />
          <ROConnectorRow dashed>
            {cmdKids.map((r) => <ROSubtree key={r.id} roleId={r.id} roles={roles} assignments={assignments} depth={depth + 1} />)}
          </ROConnectorRow>
        </>
      )}
      {cmdKids.length > 0 && regKids.length > 0 && (
        <div className="my-3 flex w-full items-center gap-2 px-1">
          <div className="h-px flex-1" style={{ background: WIRE }} />
          <span className="text-[7px] font-bold uppercase tracking-wider text-white/25">General Staff</span>
          <div className="h-px flex-1" style={{ background: WIRE }} />
        </div>
      )}
      {depth > 0 && (cmdKids.length + regKids.length) > 0 && (
        <button onClick={() => setCollapsed((v) => !v)} className="mt-1.5 flex items-center gap-1 rounded border border-white/10 px-2 py-0.5 text-[7px] text-white/25 hover:text-white/45 transition">
          {collapsed ? `▼ ${regKids.length + cmdKids.length}` : '▲ collapse'}
        </button>
      )}
      {regKids.length > 0 && show && (
        <>
          {cmdKids.length === 0 && <ROStem />}
          <ROConnectorRow>
            {regKids.map((r) => <ROSubtree key={r.id} roleId={r.id} roles={roles} assignments={assignments} depth={depth + 1} />)}
          </ROConnectorRow>
        </>
      )}
    </div>
  );
}

// ── Main view ─────────────────────────────────────────────────────────────────

export function CrisisShareView({ token }: { token: string }) {
  const [data, setData] = useState<CrisisPublicState | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    fetch(`/api/crisis/share/${token}`)
      .then((r) => { if (!r.ok) throw new Error('Share link not found'); return r.json(); })
      .then((d) => setData(d as CrisisPublicState))
      .catch((e) => setError((e as Error).message));
  }, [token]);

  useEffect(() => {
    const es = new EventSource(`/api/crisis/share/${token}/events`);
    es.addEventListener('connected', (e) => setData(JSON.parse((e as MessageEvent).data) as CrisisPublicState));
    es.addEventListener('update',    (e) => setData(JSON.parse((e as MessageEvent).data) as CrisisPublicState));
    es.addEventListener('revoked',   () => { es.close(); setError('This link has been revoked by the incident owner.'); });
    es.onerror = () => { /* reconnects automatically */ };
    return () => es.close();
  }, [token]);

  if (error) {
    return (
      <div className="flex h-screen items-center justify-center bg-ink-950">
        <div className="text-center">
          <p className="text-[16px] text-white/50">{error}</p>
          <p className="mt-2 text-[12px] text-white/25">This link may have expired or is invalid.</p>
        </div>
      </div>
    );
  }

  if (!data) {
    return (
      <div className="flex h-screen items-center justify-center bg-ink-950">
        <div className="h-6 w-6 animate-spin rounded-full border-2 border-white/20 border-t-accent" />
      </div>
    );
  }

  const { dot, badge } = STATUS_BADGE[data.incidentStatus] ?? STATUS_BADGE.active;
  const roots = data.roles.filter((r) => r.parentId === null);

  return (
    <div className="min-h-screen bg-ink-950 text-white">
      {/* Header */}
      <header className="sticky top-0 z-10 border-b border-white/8 bg-ink-900/90 px-8 py-4 backdrop-blur-sm">
        <div className="mx-auto flex max-w-5xl items-center gap-4">
          <div className="relative flex h-2.5 w-2.5 shrink-0">
            {data.incidentStatus === 'active' && <span className="absolute inline-flex h-full w-full animate-ping rounded-full opacity-70" style={{ background: dot }} />}
            <span className="relative inline-flex h-2.5 w-2.5 rounded-full" style={{ background: dot }} />
          </div>
          <div>
            <p className="text-[9px] font-bold uppercase tracking-[0.18em] text-white/30">Live Situation Report</p>
            <p className="text-[18px] font-semibold text-white/90">{data.incidentName || 'Unnamed Incident'}</p>
          </div>
          <span className={`shrink-0 rounded-full border px-2.5 py-0.5 text-[9px] font-bold uppercase tracking-widest ${badge}`}>{data.incidentStatus}</span>
          <div className="ml-auto text-right">
            <p className="text-[9px] text-white/25">Last updated</p>
            <p className="text-[10px] text-white/45">{fmtTs(data.lastUpdated)}</p>
          </div>
        </div>
      </header>

      <main className="mx-auto max-w-5xl space-y-8 px-8 py-8">

        {/* Incident info + summary */}
        <div className="grid grid-cols-2 gap-6">
          <div>
            <h2 className="mb-3 text-[10px] font-bold uppercase tracking-[0.14em] text-white/30">Executive Summary</h2>
            <p className="whitespace-pre-wrap rounded-lg border border-white/8 bg-white/4 px-4 py-3 text-[13px] leading-relaxed text-white/75">
              {data.executiveSummary || <span className="text-white/25 italic">No summary provided</span>}
            </p>
          </div>
          <div>
            <h2 className="mb-3 text-[10px] font-bold uppercase tracking-[0.14em] text-white/30">Incident Details</h2>
            <div className="space-y-2 rounded-lg border border-white/8 bg-white/4 px-4 py-3">
              {[
                ['Location', data.incidentLocation],
                ['Date / Time', data.incidentDatetime ? new Date(data.incidentDatetime).toLocaleString() : '—'],
                ['Type', data.incidentType],
              ].map(([label, value]) => (
                <div key={label} className="flex gap-3">
                  <span className="w-24 shrink-0 text-[10px] text-white/35">{label}</span>
                  <span className="text-[12px] text-white/75">{value || '—'}</span>
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
                  <ROSubtree key={r.id} roleId={r.id} roles={data.roles} assignments={data.assignments} />
                ))}
              </div>
            </div>
          </div>
        )}

        {/* Action log */}
        {data.actionLog.length > 0 && (
          <div>
            <h2 className="mb-3 text-[10px] font-bold uppercase tracking-[0.14em] text-white/30">Actions &amp; Events Log</h2>
            <div className="divide-y divide-white/6 rounded-lg border border-white/8 bg-ink-950/60">
              {[...data.actionLog]
                .sort((a, b) => new Date(b.timestamp).getTime() - new Date(a.timestamp).getTime())
                .map((entry) => (
                  <div key={entry.id} className="flex items-start gap-3 px-4 py-3">
                    <span className={`mt-0.5 shrink-0 rounded-full border px-1.5 py-0.5 text-[7px] font-bold uppercase tracking-widest ${TYPE_STYLES[entry.entryType ?? 'action']}`}>
                      {entry.entryType ?? 'action'}
                    </span>
                    <span className="w-36 shrink-0 text-[10px] text-white/30">{fmtTs(entry.timestamp)}</span>
                    <p className="flex-1 text-[12px] leading-snug text-white/70">{entry.description || <span className="text-white/25 italic">No description</span>}</p>
                    <div className="shrink-0 flex flex-col items-end gap-1">
                      {(entry as { attachmentData?: string }).attachmentData && (
                        <img
                          src={(entry as { attachmentData?: string }).attachmentData}
                          alt={entry.attachmentName}
                          className="max-h-48 max-w-[220px] rounded border border-white/12 object-cover shadow-lg"
                        />
                      )}
                      {entry.attachmentName && !(entry as { attachmentData?: string }).attachmentData && (
                        <span className="text-[9px] text-accent/70">📎 {entry.attachmentName}</span>
                      )}
                    </div>
                  </div>
                ))}
            </div>
          </div>
        )}

        {/* Map layers list (read-only) */}
        {data.drawLayers && data.drawLayers.length > 0 && (
          <div>
            <h2 className="mb-3 text-[10px] font-bold uppercase tracking-[0.14em] text-white/30">Map Layers</h2>
            <div className="space-y-3">
              {data.drawLayers.map((layer) => (
                <div key={layer.id} className="overflow-hidden rounded-lg border border-white/8 bg-ink-950/60">
                  {(layer as { thumbnail?: string }).thumbnail && (
                    <img
                      src={(layer as { thumbnail?: string }).thumbnail}
                      alt={`${layer.name} map view`}
                      className="h-40 w-full object-cover"
                    />
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

        <p className="border-t border-white/6 pt-4 text-center text-[9px] text-white/20">
          Published {fmtTs(data.publishedAt)} · Updates automatically in real-time
        </p>
      </main>
    </div>
  );
}
