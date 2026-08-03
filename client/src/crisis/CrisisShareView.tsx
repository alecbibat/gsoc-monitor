import { lazy, Suspense, useEffect, useState } from 'react';
import type { CrisisPublicState, IcsRole, PersonnelAssignment } from './crisisStore';
import type { ShareLiveLayerId } from './shareLiveLayers';
import { CrisisShareMap } from './CrisisShareMap';
import { ShareWatchCard } from './ShareWatchCard';
import { isShareLiveLayerId } from './shareLiveLayers';

// The live globe (Cesium + every layer component) is only loaded when the
// incident actually prescribes live layers; plain share links keep the light
// Leaflet map.
const CrisisShareGlobe = lazy(() =>
  import('./CrisisShareGlobe').then((m) => ({ default: m.CrisisShareGlobe }))
);

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
    <div className="rounded-md border bg-ink-900/80 text-center" style={{ minWidth: role.parentId === null ? '190px' : '132px', borderColor: `${role.color}70` }}>
      <div className="h-1 w-full rounded-t-md" style={{ background: role.color }} />
      <div className="px-2 py-2">
        {role.abbrev && <p className="mb-0.5 text-[10px] font-bold uppercase tracking-[0.14em]" style={{ color: role.color }}>{role.abbrev}</p>}
        <p className={`font-bold leading-tight text-white/95 ${role.parentId === null ? 'text-[14px]' : 'text-[12px]'}`}>{role.title}</p>
        <p className="mt-1 text-[11px] text-white/65">{active ? active.name : '—'}</p>
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
          <span className="text-[10px] font-bold uppercase tracking-wider text-white/50">General Staff</span>
          <div className="h-px flex-1" style={{ background: WIRE }} />
        </div>
      )}
      {depth > 0 && (cmdKids.length + regKids.length) > 0 && (
        <button onClick={() => setCollapsed((v) => !v)} className="mt-1.5 flex items-center gap-1 rounded border border-white/10 px-2 py-0.5 text-[10px] text-white/45 hover:text-white/70 transition">
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

// ── Password gate ─────────────────────────────────────────────────────────────

// Viewers exchange the password for its SHA-256 hex digest and send that as the
// ?k= view key — the plaintext never travels in a URL. The key is kept in
// sessionStorage so a refresh (or the SSE reconnect) doesn't re-prompt.
async function sha256Hex(text: string): Promise<string> {
  const buf = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(text));
  return Array.from(new Uint8Array(buf)).map((b) => b.toString(16).padStart(2, '0')).join('');
}

const keyStorageId = (token: string) => `gsoc-share-key:${token}`;

function PasswordGate({ onSubmit, wrong, checking }: {
  onSubmit: (password: string) => void;
  wrong: boolean;
  checking: boolean;
}) {
  const [pw, setPw] = useState('');
  return (
    <div className="flex h-screen items-center justify-center bg-ink-950 px-6">
      <form
        className="w-full max-w-sm rounded-xl border border-white/12 bg-ink-900 px-6 py-7 text-center shadow-2xl"
        onSubmit={(e) => { e.preventDefault(); if (pw.trim()) onSubmit(pw.trim()); }}
      >
        <div className="mx-auto mb-4 grid h-12 w-12 place-items-center rounded-full border border-amber-400/30 bg-amber-400/10 text-[20px]">
          🔒
        </div>
        <h1 className="text-[16px] font-semibold text-white/90">Protected Situation Report</h1>
        <p className="mt-1.5 text-[12px] leading-relaxed text-white/50">
          This live incident report is password protected. Enter the password provided by the incident team.
        </p>
        <input
          autoFocus
          type="password"
          value={pw}
          onChange={(e) => setPw(e.target.value)}
          placeholder="Password"
          className="mt-4 w-full rounded border border-white/15 bg-white/8 px-3 py-2.5 text-center font-mono text-[14px] tracking-[0.2em] text-white/90 placeholder-white/25 outline-none transition focus:border-accent/50"
        />
        {wrong && (
          <p className="mt-2 text-[11px] text-red-400/90">Incorrect password — check with the incident team and try again.</p>
        )}
        <button
          type="submit"
          disabled={!pw.trim() || checking}
          className="mt-4 w-full rounded bg-accent/20 py-2.5 text-[13px] font-medium text-accent transition hover:bg-accent/30 disabled:opacity-40"
        >
          {checking ? 'Checking…' : 'View Report'}
        </button>
      </form>
    </div>
  );
}

// ── Main view ─────────────────────────────────────────────────────────────────

export function CrisisShareView({ token }: { token: string }) {
  const [data, setData] = useState<CrisisPublicState | null>(null);
  const [error, setError] = useState<string | null>(null);
  // null = no key yet; '' = tried without a key (legacy open links)
  const [viewKey, setViewKey] = useState<string | null>(
    () => sessionStorage.getItem(keyStorageId(token)),
  );
  const [locked, setLocked] = useState(false);
  const [wrongPw, setWrongPw] = useState(false);
  const [checking, setChecking] = useState(false);
  // Set once the snapshot fetch succeeds — gates the SSE stream so it never
  // spins 401s against a locked link.
  const [unlocked, setUnlocked] = useState(false);
  // Layers this viewer switched off locally — live feeds via the legend chips
  // under the globe, drawn layers via the Map Layers list. Kept as "off" sets
  // so anything newly prescribed over SSE defaults to on.
  const [offLive, setOffLive] = useState<Set<ShareLiveLayerId>>(new Set());
  const [offDraw, setOffDraw] = useState<Set<string>>(new Set());

  const toggleLive = (id: ShareLiveLayerId) =>
    setOffLive((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id); else next.add(id);
      return next;
    });
  const toggleDraw = (id: string) =>
    setOffDraw((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id); else next.add(id);
      return next;
    });
  const resetLayers = () => { setOffLive(new Set()); setOffDraw(new Set()); };

  // Global CSS sets overflow:hidden for the globe app. Override it here so the
  // read-only share page can scroll normally.
  useEffect(() => {
    const prev = document.body.style.overflow;
    document.body.style.overflow = 'auto';
    return () => { document.body.style.overflow = prev; };
  }, []);

  useEffect(() => {
    let cancelled = false;
    const qs = viewKey ? `?k=${viewKey}` : '';
    fetch(`/api/crisis/share/${token}${qs}`)
      .then(async (r) => {
        if (cancelled) return;
        if (r.status === 401) {
          // Wrong (or missing) key. Only flag "incorrect password" when the
          // viewer actually typed one this session — a stale stored key or the
          // first keyless probe just shows the gate.
          setLocked(true);
          setWrongPw(viewKey !== null && checking);
          setChecking(false);
          return;
        }
        if (!r.ok) throw new Error('Share link not found');
        const d = (await r.json()) as CrisisPublicState;
        if (cancelled) return;
        setData(d);
        setLocked(false);
        setWrongPw(false);
        setChecking(false);
        setUnlocked(true);
        if (viewKey) sessionStorage.setItem(keyStorageId(token), viewKey);
      })
      .catch((e) => { if (!cancelled) { setError((e as Error).message); setChecking(false); } });
    return () => { cancelled = true; };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [token, viewKey]);

  useEffect(() => {
    if (!unlocked) return;
    const qs = viewKey ? `?k=${viewKey}` : '';
    const es = new EventSource(`/api/crisis/share/${token}/events${qs}`);
    es.addEventListener('connected', (e) => setData(JSON.parse((e as MessageEvent).data) as CrisisPublicState));
    es.addEventListener('update',    (e) => setData(JSON.parse((e as MessageEvent).data) as CrisisPublicState));
    es.addEventListener('revoked',   () => { es.close(); setError('This link has been revoked by the incident owner.'); });
    es.onerror = () => { /* reconnects automatically */ };
    return () => es.close();
  }, [token, viewKey, unlocked]);

  const handlePassword = (password: string) => {
    setChecking(true);
    setWrongPw(false);
    // Generated passwords are uppercase-only — accept lowercase entry (mobile
    // keyboards default to it) by normalizing before hashing.
    sha256Hex(password.toUpperCase())
      .then((hex) => {
        // Same wrong password twice: the fetch effect won't re-run (key
        // unchanged), so surface the error directly.
        if (hex === viewKey) { setChecking(false); setWrongPw(true); return; }
        setViewKey(hex);
      })
      .catch(() => { setChecking(false); setWrongPw(true); });
  };

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

  if (locked) {
    return <PasswordGate onSubmit={handlePassword} wrong={wrongPw} checking={checking} />;
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
  // Live layers prescribed by the incident team; drop ids this build no longer
  // knows (snapshots outlive deploys). Array.isArray guards because share
  // snapshots are stored as opaque JSON — a malformed one must not blank the
  // whole public page.
  const liveLayers = (Array.isArray(data.liveLayers) ? data.liveLayers : [])
    .filter((id) => isShareLiveLayerId(id));
  const drawLayers = Array.isArray(data.drawLayers) ? data.drawLayers : [];
  // Viewer-side hides mask a layer's visible flag rather than replace it: a
  // layer the incident team hid can never be surfaced by a local toggle.
  const maskedDrawLayers = drawLayers.map((l) =>
    offDraw.has(l.id) ? { ...l, visible: false } : l
  );
  const drawnLayers = maskedDrawLayers.filter((l) => l.visible && l.positions.length > 0);

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
            <p className="text-[10px] font-bold uppercase tracking-[0.18em] text-white/45">Live Situation Report</p>
            <p className="text-[20px] font-semibold text-white/95">{data.incidentName || 'Unnamed Incident'}</p>
          </div>
          <span className={`shrink-0 rounded-full border px-2.5 py-0.5 text-[10px] font-bold uppercase tracking-widest ${badge}`}>{data.incidentStatus}</span>
          <div className="ml-auto text-right">
            <p className="text-[10px] text-white/40">Last updated</p>
            <p className="text-[11px] text-white/60">{fmtTs(data.lastUpdated)}</p>
          </div>
        </div>
      </header>

      <main className="mx-auto max-w-5xl space-y-8 px-8 py-8">

        {/* Incident info + summary */}
        <div className="grid grid-cols-2 gap-6">
          <div>
            <h2 className="mb-3 text-[13px] font-bold uppercase tracking-[0.14em] text-white/60">Executive Summary</h2>
            <p className="whitespace-pre-wrap rounded-lg border border-white/8 bg-white/4 px-4 py-3 text-[14px] leading-relaxed text-white/85">
              {data.executiveSummary || <span className="text-white/25 italic">No summary provided</span>}
            </p>
          </div>
          <div>
            <h2 className="mb-3 text-[13px] font-bold uppercase tracking-[0.14em] text-white/60">Incident Details</h2>
            <div className="space-y-2 rounded-lg border border-white/8 bg-white/4 px-4 py-3">
              {[
                ['Location', data.incidentLocation],
                ['Start', data.incidentDatetime ? new Date(data.incidentDatetime).toLocaleString() : '—'],
                ['End', data.incidentEndDatetime ? new Date(data.incidentEndDatetime).toLocaleString() : '—'],
                ['Type', data.incidentType],
              ].map(([label, value]) => (
                <div key={label} className="flex gap-3">
                  <span className="w-24 shrink-0 text-[11px] text-white/50">{label}</span>
                  <span className="text-[13px] text-white/85">{value || '—'}</span>
                </div>
              ))}
            </div>
          </div>
        </div>

        {/* Live property watch — same scan as the operator Watch tab */}
        <div>
          <div className="mb-3 flex items-baseline gap-3">
            <h2 className="text-[13px] font-bold uppercase tracking-[0.14em] text-white/60">Property Watch</h2>
            <span className="text-[11px] text-white/35">Hazards near monitored locations · updates live</span>
          </div>
          <ShareWatchCard />
        </div>

        {/* Org chart */}
        {roots.length > 0 && (
          <div>
            <h2 className="mb-3 text-[13px] font-bold uppercase tracking-[0.14em] text-white/60">ICS / NIMS Organizational Structure</h2>
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
            <h2 className="mb-3 text-[13px] font-bold uppercase tracking-[0.14em] text-white/60">Actions &amp; Events Log</h2>
            <div className="divide-y divide-white/6 rounded-lg border border-white/8 bg-ink-950/60">
              {[...data.actionLog]
                .sort((a, b) => new Date(b.timestamp).getTime() - new Date(a.timestamp).getTime())
                .map((entry) => (
                  <div key={entry.id} className="flex items-start gap-3 px-4 py-3">
                    <span className={`mt-0.5 shrink-0 rounded-full border px-1.5 py-0.5 text-[7px] font-bold uppercase tracking-widest ${TYPE_STYLES[entry.entryType ?? 'action']}`}>
                      {entry.entryType ?? 'action'}
                    </span>
                    <span className="w-36 shrink-0 text-[11px] text-white/45">{fmtTs(entry.timestamp)}</span>
                    <p className="flex-1 text-[13px] leading-snug text-white/80">{entry.description || <span className="text-white/30 italic">No description</span>}</p>
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

        {/* Interactive incident map. With live layers prescribed by the
            incident team, this is the full interactive globe streaming those
            feeds in real time; otherwise a light flat map of just the drawn
            layers, opened centred on their combined extent. */}
        {liveLayers.length > 0 ? (
          <div>
            <div className="mb-3 flex items-baseline gap-3">
              <h2 className="text-[13px] font-bold uppercase tracking-[0.14em] text-white/60">Live Incident Map</h2>
              <span className="text-[11px] text-white/40">
                Interactive globe · live data layers selected by the incident team
              </span>
            </div>
            <Suspense
              fallback={
                <div className="grid h-[72vh] min-h-[440px] w-full place-items-center rounded-lg border border-white/8 bg-ink-950/60">
                  <div className="h-6 w-6 animate-spin rounded-full border-2 border-white/20 border-t-accent" />
                </div>
              }
            >
              <CrisisShareGlobe
                liveLayers={liveLayers}
                offLive={offLive}
                onToggleLive={toggleLive}
                onResetLayers={resetLayers}
                drawLayers={maskedDrawLayers}
              />
            </Suspense>
          </div>
        ) : drawLayers.some((l) => l.visible && l.positions.length > 0) ? (
          <div>
            <h2 className="mb-3 text-[13px] font-bold uppercase tracking-[0.14em] text-white/60">Incident Map</h2>
            <CrisisShareMap layers={drawnLayers} />
          </div>
        ) : null}

        {/* Map layers list — each card toggles that layer on the map above */}
        {drawLayers.length > 0 && (
          <div>
            <div className="mb-3 flex items-baseline gap-3">
              <h2 className="text-[13px] font-bold uppercase tracking-[0.14em] text-white/60">Map Layers</h2>
              <span className="text-[11px] text-white/35">Click a layer to show or hide it on the map</span>
            </div>
            <div className="space-y-3">
              {drawLayers.map((layer) => {
                const teamHidden = !layer.visible;
                const shown = layer.visible && !offDraw.has(layer.id);
                return (
                  <button
                    key={layer.id}
                    onClick={() => { if (!teamHidden) toggleDraw(layer.id); }}
                    disabled={teamHidden}
                    aria-pressed={shown}
                    className={`block w-full overflow-hidden rounded-lg border text-left transition ${
                      shown
                        ? 'border-white/12 bg-ink-950/60 hover:border-white/25'
                        : 'border-white/8 bg-ink-950/60 opacity-50 hover:opacity-70'
                    } ${teamHidden ? 'cursor-not-allowed hover:opacity-50' : ''}`}
                  >
                    {(layer as { thumbnail?: string }).thumbnail && (
                      <img
                        src={(layer as { thumbnail?: string }).thumbnail}
                        alt={`${layer.name} map view`}
                        className="h-40 w-full object-cover"
                      />
                    )}
                    <div className="flex items-center gap-2 px-3 py-2">
                      <div className="h-3 w-3 shrink-0 rounded-full" style={{ background: layer.color, opacity: shown ? 1 : 0.4 }} />
                      <span className="text-[12px] text-white/80">{layer.name}</span>
                      <span className="text-[10px] text-white/40">{layer.type} · {layer.geometry}</span>
                      <span className="ml-auto text-[10px] text-white/35">{layer.positions.length} points</span>
                      <span
                        className={`shrink-0 rounded-full border px-2 py-0.5 text-[9px] font-bold uppercase tracking-widest ${
                          teamHidden
                            ? 'border-white/12 text-white/30'
                            : shown
                              ? 'border-accent/30 bg-accent/8 text-accent/80'
                              : 'border-white/15 text-white/40'
                        }`}
                      >
                        {teamHidden ? 'Hidden by team' : shown ? 'On map' : 'Hidden'}
                      </span>
                    </div>
                  </button>
                );
              })}
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
