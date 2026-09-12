import { lazy, Suspense, useEffect, useRef, useState } from 'react';
import {
  consumeSsoError, fetchAuthConfig, login, startSso,
  FALLBACK_AUTH_CONFIG, type AuthConfig,
} from '../auth/authApi';
import type { CrisisPublicState, IcsRole, PersonnelAssignment } from './crisisStore';
import type { ShareLiveLayerId } from './shareLiveLayers';
import { LOCATION_GROUPS, type LocationGroup } from '../layers/locations/locations';
import { CrisisShareMap } from './CrisisShareMap';
import { ShareWatchCard } from './ShareWatchCard';
import { isShareLiveLayerId } from './shareLiveLayers';
import { measureLayer } from './layerMeasure';
import { incidentShipMmsis, incidentVessels, shipLocationGroup } from './incidentShips';
import { useFleetPositions } from '../layers/ships/useFleetPositions';
import { STATUS_TONE, lastSeenText, positionText, statusOf } from '../layers/ships/shipStatus';
import { ImageLightbox, ZoomableImage } from './ImageLightbox';
import { TYPE_STYLES, TimelineView, LogShowMore, DEFAULT_LOG_LIMIT, entryTypeOf } from './logViews';
// Share snapshots outlive deploys, so status/type may arrive as retired ids —
// the def lookups normalize them (contained → recovery, chemical → HazMat, …).
import { incidentStatusDef, incidentTypeDef } from './taxonomy';
import {
  checklistTemplateFor, isChecklistStateMap,
  type ChecklistItemState, type ChecklistStateMap,
} from './checklistTemplate';
import { intakeTemplateFor, isIntakeAnswers, answeredCount } from './intakeTemplate';
import { ChecklistBoard } from './ChecklistBoard';
import { IntakeTable } from './IntakeTable';
import { PdfViewer } from './PdfViewer';

// The live globe (Cesium + every layer component) is only loaded when the
// incident actually prescribes live layers; plain share links keep the light
// Leaflet map. The import can be triggered mid-session by an SSE update — in
// a tab that outlived a redeploy, that chunk no longer exists, and without
// the catch the rejection would take down the whole page instead of just the
// map area.
function GlobeUnavailable() {
  return (
    <div className="flex h-full min-h-[240px] items-center justify-center rounded-lg border border-white/10 bg-white/4 p-6 text-center">
      <div>
        <p className="text-[13px] text-white/60">The live map can’t load — the app was updated while this page was open.</p>
        <button
          onClick={() => window.location.reload()}
          className="mt-3 rounded border border-white/20 bg-white/8 px-3 py-1.5 text-[11px] text-white/75 transition hover:border-white/35"
        >
          Reload to update
        </button>
      </div>
    </div>
  );
}
const CrisisShareGlobe = lazy(() =>
  import('./CrisisShareGlobe')
    .then((m) => ({ default: m.CrisisShareGlobe }))
    .catch(() => ({ default: GlobeUnavailable as unknown as typeof import('./CrisisShareGlobe').CrisisShareGlobe }))
);

function fmtTs(iso: string) {
  try { return new Date(iso).toLocaleString('en-US', { month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit', timeZoneName: 'short' }); }
  catch { return iso; }
}

// ── Stand-down page for revoked/expired links ────────────────────────────────

interface GonePayload {
  gone: true;
  reason: 'revoked' | 'expired';
  revokedAt?: string | null;
  expiresAt?: string | null;
  incidentName?: string | null;
  incidentStatus?: string | null;
  executiveSummary?: string | null;
  lastUpdated?: string | null;
}

function ClosurePage({ payload }: { payload: GonePayload }) {
  const status = incidentStatusDef(payload.incidentStatus);
  const closedAt = payload.revokedAt ?? payload.expiresAt ?? payload.lastUpdated;
  return (
    <div className="flex min-h-screen items-center justify-center bg-ink-950 p-6 text-white">
      <div className="w-full max-w-lg rounded-xl border border-white/10 bg-ink-900/70 p-6">
        <p className="text-[10px] font-bold uppercase tracking-[0.18em] text-white/40">Situation Report — Concluded</p>
        <div className="mt-2 flex items-center gap-3">
          <span className="h-2.5 w-2.5 rounded-full" style={{ background: status.dot }} />
          <h1 className="text-[20px] font-semibold text-white/95">{payload.incidentName || 'Incident'}</h1>
          <span className={`rounded-full border px-2.5 py-0.5 text-[10px] font-bold uppercase tracking-widest ${status.badge}`}>
            {status.label}
          </span>
        </div>
        {closedAt && (
          <p className="mt-2 text-[12px] text-white/45">
            {payload.reason === 'revoked' ? 'Stood down' : 'Report closed'} · {fmtTs(closedAt)}
          </p>
        )}
        {payload.executiveSummary && (
          <p className="mt-4 whitespace-pre-wrap rounded-lg border border-white/8 bg-white/4 px-4 py-3 text-[13px] leading-relaxed text-white/75">
            {payload.executiveSummary}
          </p>
        )}
        <p className="mt-4 text-[11px] text-white/35">
          {payload.reason === 'revoked'
            ? 'This share link was closed by the incident team when the incident concluded.'
            : 'This share link has expired.'}{' '}
          If you need continued access, contact the GSOC for a new link.
        </p>
      </div>
    </div>
  );
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

const WRONG_PW_MSG = 'Incorrect password — check with the incident team and try again.';

function PasswordGate({ onSubmit, error, checking }: {
  onSubmit: (password: string) => void;
  error: string | null;
  checking: boolean;
}) {
  const [pw, setPw] = useState('');
  return (
    <div className="flex h-screen items-center justify-center bg-ink-950 px-6">
      <form
        className="w-full max-w-sm rounded-xl border border-white/15 bg-ink-900 px-6 py-7 text-center shadow-2xl"
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
          className="mt-4 w-full rounded border border-white/15 bg-white/10 px-3 py-2.5 text-center font-mono text-[14px] tracking-[0.2em] text-white/90 placeholder-white/25 outline-none transition focus:border-accent/50"
        />
        {error && (
          <p className="mt-2 text-[11px] text-red-400/90">{error}</p>
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

// ── Sign-in gate ──────────────────────────────────────────────────────────────
//
// Share links require an account. This is what a stakeholder sees when they
// open one without a session: SSO if configured, and an inline password form so
// they never leave the link they were sent (signing in elsewhere and navigating
// back is exactly the step people abandon).

function ShareSignInGate({ token, onSignedIn }: { token: string; onSignedIn: () => void }) {
  const [authConfig, setAuthConfig] = useState<AuthConfig>(FALLBACK_AUTH_CONFIG);
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [error, setError] = useState<string | null>(() => consumeSsoError());
  const [submitting, setSubmitting] = useState(false);
  const [showPassword, setShowPassword] = useState(false);

  useEffect(() => { void fetchAuthConfig().then(setAuthConfig); }, []);

  const ssoEnabled = authConfig.sso.enabled;
  const passwordIsSecondary = ssoEnabled && authConfig.passwordLoginAdminOnly;
  const showForm = authConfig.passwordLogin && (!passwordIsSecondary || showPassword);

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    setSubmitting(true);
    setError(null);
    try {
      await login(email, password);
      onSignedIn();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Could not sign in — please try again.');
    } finally {
      setSubmitting(false);
    }
  };

  const inputCls =
    'w-full rounded border border-white/15 bg-white/8 px-3 py-2.5 text-[13px] text-white/90 placeholder-white/25 outline-none transition focus:border-accent/50';

  return (
    <div className="flex min-h-screen items-center justify-center bg-ink-950 px-6 py-10">
      <div className="w-full max-w-sm space-y-4 rounded-xl border border-white/15 bg-ink-900 px-6 py-7 text-center shadow-2xl">
        <div className="mx-auto grid h-12 w-12 place-items-center rounded-full border border-accent/30 bg-accent/10 text-[20px]">
          🔐
        </div>
        <div>
          <h1 className="text-[16px] font-semibold text-white/90">Protected Situation Report</h1>
          <p className="mt-1.5 text-[12px] leading-relaxed text-white/50">
            Sign in to view this incident report.
          </p>
        </div>

        {error && (
          <p className="rounded border border-amber-400/25 bg-amber-400/8 px-3 py-2 text-left text-[11px] leading-relaxed text-amber-200/85">
            {error}
          </p>
        )}

        {ssoEnabled && (
          // returnTo brings them back to this exact link after the round trip.
          <button
            onClick={() => startSso(`/?share=${encodeURIComponent(token)}`)}
            className="w-full rounded-lg border border-accent/30 bg-accent/15 py-2.5 text-[12px] font-semibold text-accent transition hover:border-accent/50 hover:bg-accent/25"
          >
            {authConfig.sso.label ?? 'Sign in with SSO'}
          </button>
        )}

        {ssoEnabled && authConfig.passwordLogin && (
          <div className="flex items-center gap-3">
            <div className="h-px flex-1 bg-white/8" />
            <span className="text-[9px] uppercase tracking-[0.2em] text-white/25">or</span>
            <div className="h-px flex-1 bg-white/8" />
          </div>
        )}

        {passwordIsSecondary && !showPassword && (
          <button
            onClick={() => setShowPassword(true)}
            className="w-full text-[11px] text-white/35 transition hover:text-white/60"
          >
            Sign in with a password
          </button>
        )}

        {showForm && (
          <form onSubmit={submit} className="space-y-2.5 text-left">
            <input
              type="email" placeholder="Email" value={email} required autoComplete="username"
              onChange={(e) => setEmail(e.target.value)} className={inputCls}
            />
            <input
              type="password" placeholder="Password" value={password} required autoComplete="current-password"
              onChange={(e) => setPassword(e.target.value)} className={inputCls}
            />
            <button
              type="submit" disabled={submitting}
              className="w-full rounded bg-accent/20 py-2.5 text-[13px] font-medium text-accent transition hover:bg-accent/30 disabled:opacity-40"
            >
              {submitting ? 'Signing in…' : 'Sign in'}
            </button>
          </form>
        )}

        <p className="text-[10px] leading-relaxed text-white/25">
          No account? Contact the GSOC — they can add you, or reissue this report with a
          temporary access password.
        </p>
      </div>
    </div>
  );
}

// ── Last-updated indicator ───────────────────────────────────────────────────
// The 30-second stakeholder question includes "is this current?" — a static
// timestamp can't answer that. Relative time, re-ticked every 30 s, amber once
// an OPEN incident hasn't updated in 45 min (closed incidents don't go stale).

function LastUpdated({ iso, closed }: { iso: string; closed: boolean }) {
  const [, tick] = useState(0);
  useEffect(() => {
    const t = setInterval(() => tick((n) => n + 1), 30_000);
    return () => clearInterval(t);
  }, []);
  const t = new Date(iso).getTime();
  if (Number.isNaN(t)) return null;
  const ageMin = Math.max(0, Math.round((Date.now() - t) / 60_000));
  const rel =
    ageMin < 1 ? 'just now'
    : ageMin < 60 ? `${ageMin}m ago`
    : ageMin < 48 * 60 ? `${Math.floor(ageMin / 60)}h ${ageMin % 60}m ago`
    : `${Math.floor(ageMin / 1440)}d ago`;
  const stale = !closed && ageMin >= 45;
  return (
    <div className="ml-auto text-right" title={new Date(iso).toLocaleString()}>
      <p className="text-[10px] text-white/40">Last updated</p>
      <p className={`text-[11px] font-semibold ${stale ? 'text-amber-300' : 'text-white/70'}`}>
        {rel}
        {stale && <span className="ml-1 font-normal text-amber-300/70">· may be stale</span>}
      </p>
    </div>
  );
}

// ── Main view ─────────────────────────────────────────────────────────────────

export function CrisisShareView({ token }: { token: string }) {
  const [data, setData] = useState<CrisisPublicState | null>(null);
  const [error, setError] = useState<string | null>(null);
  // Closure payload from a revoked/expired link (HTTP 410) — the viewer gets
  // a stand-down page with the incident's conclusion instead of a dead end.
  const [gone, setGone] = useState<GonePayload | null>(null);
  // null = no key yet; '' = tried without a key (legacy open links)
  const [viewKey, setViewKey] = useState<string | null>(
    () => sessionStorage.getItem(keyStorageId(token)),
  );
  // How the server refused us, if it did: 'signin' when only an account will
  // do, 'password' while an admin has the break-glass window open.
  const [lockedBy, setLockedBy] = useState<null | 'signin' | 'password'>(null);
  // Bumped after a successful inline sign-in to re-run the snapshot fetch.
  const [reloadNonce, setReloadNonce] = useState(0);
  const [gateError, setGateError] = useState<string | null>(null);
  const [checking, setChecking] = useState(false);
  // Set once the snapshot fetch succeeds — gates the SSE stream so it never
  // spins 401s against a locked link.
  const [unlocked, setUnlocked] = useState(false);
  // Layers this viewer switched off locally — live feeds via the legend chips
  // under the globe, drawn layers via the Map Layers list. Kept as "off" sets
  // so anything newly prescribed over SSE defaults to on.
  const [offLive, setOffLive] = useState<Set<ShareLiveLayerId>>(new Set());
  const [offDraw, setOffDraw] = useState<Set<string>>(new Set());
  const [hideInfo, setHideInfo] = useState(false);
  // System (auto-generated) entries start hidden — stakeholders open the log
  // for what operators wrote; the state-change narration is a toggle away.
  const [hideSystem, setHideSystem] = useState(true);
  // Viewers get the list by default: the question a share link is opened to
  // answer is "what has happened, most recent first", and the list says that
  // in the fewest words. The timeline is one toggle away for anyone who wants
  // the shape of the response instead.
  const [logView, setLogView] = useState<'list' | 'timeline'>('list');
  const [logLimit, setLogLimit] = useState(DEFAULT_LOG_LIMIT);
  // Hoisted above the paginated log rows: an SSE update can slide a row out
  // of the visible slice, and an open viewer must survive that unmount.
  const [logLightbox, setLogLightbox] = useState<{ src: string; alt?: string } | null>(null);
  // Share-page tabs. The situation report stays mounted (CSS-hidden) so the
  // globe keeps its camera; IAP/checklists mount on first visit and then stay
  // (the PDF shouldn't refetch and re-render on every tab hop).
  const [tab, setTab] = useState<'report' | 'iap' | 'checklists'>('report');
  const openedRef = useRef<Set<string>>(new Set(['report']));
  openedRef.current.add(tab);
  // Optimistic overlay for this viewer's in-flight checklist toggles — an SSE
  // update replaces the whole `data` object, so without the overlay a check
  // would flicker off until its own fanout echo lands.
  const [pendingChk, setPendingChk] = useState<ChecklistStateMap>({});
  const [chkError, setChkError] = useState<string | null>(null);
  // Optional attribution for this viewer's toggles, remembered per browser.
  const [viewerName, setViewerName] = useState(() => {
    try { return localStorage.getItem('gsoc-share-name') ?? ''; } catch { return ''; }
  });

  // Once the globe has mounted, keep it mounted even if a live prescription
  // update empties the layer/pin lists — swapping a viewer down to the flat
  // map mid-session would throw away their camera, basemap and pins.
  const globeEverRef = useRef(false);

  // Vessels attached to the incident. The snapshot carries identities only, so
  // positions come live from the public AIS endpoint here — a viewer opening a
  // week-old link sees where the ship is now, not where it was at publish. The
  // feed is only polled when the incident actually names vessels.
  // (Hooks run before the early returns below, so this reads data optionally.)
  const shipMmsis = incidentShipMmsis(data?.shipMmsis);
  const fleet = useFleetPositions(shipMmsis.length > 0);
  const vessels = incidentVessels(shipMmsis, fleet.ships);
  const shipGroup = shipLocationGroup(shipMmsis, fleet.ships);

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
          const body = (await r.json().catch(() => ({}))) as {
            passwordAccepted?: boolean; passwordRequired?: boolean; badPassword?: boolean;
          };
          // passwordRequired is the pre-gate field name, still sent, so a share
          // tab that outlived this deploy keeps working.
          const passwordOk = body.passwordAccepted ?? body.passwordRequired ?? false;
          setLockedBy(passwordOk ? 'password' : 'signin');
          // Only say "incorrect password" when one was actually tried — a stale
          // stored key or the first keyless probe just shows the gate.
          setGateError(passwordOk && body.badPassword && viewKey !== null ? WRONG_PW_MSG : null);
          setChecking(false);
          return;
        }
        if (r.status === 410) {
          const g = (await r.json()) as GonePayload;
          if (!cancelled) { setGone(g); setLockedBy(null); setChecking(false); }
          return;
        }
        if (!r.ok) throw new Error('Share link not found');
        const d = (await r.json()) as CrisisPublicState;
        if (cancelled) return;
        setData(d);
        setLockedBy(null);
        setGateError(null);
        setChecking(false);
        setUnlocked(true);
        if (viewKey) sessionStorage.setItem(keyStorageId(token), viewKey);
      })
      .catch((e) => { if (!cancelled) { setError((e as Error).message); setChecking(false); } });
    return () => { cancelled = true; };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [token, viewKey, reloadNonce]);

  useEffect(() => {
    if (!unlocked) return;
    const qs = viewKey ? `?k=${viewKey}` : '';
    const es = new EventSource(`/api/crisis/share/${token}/events${qs}`);
    es.addEventListener('connected', (e) => setData(JSON.parse((e as MessageEvent).data) as CrisisPublicState));
    es.addEventListener('update',    (e) => setData(JSON.parse((e as MessageEvent).data) as CrisisPublicState));
    es.addEventListener('revoked',   () => {
      es.close();
      // Refetch to pick up the closure payload (410) so the viewer lands on
      // the stand-down page rather than a bare revocation notice.
      const kq = viewKey ? `?k=${viewKey}` : '';
      fetch(`/api/crisis/share/${token}${kq}`)
        .then(async (r) => {
          if (r.status === 410) setGone((await r.json()) as GonePayload);
          else setError('This link has been revoked by the incident owner.');
        })
        .catch(() => setError('This link has been revoked by the incident owner.'));
    });
    es.onerror = () => {
      // Transient drops reconnect automatically. A CLOSED stream is terminal —
      // the server now refuses the connection (e.g. the link expired, or it
      // was revoked while this tab's stream was already dead) — so resync via
      // the snapshot: a 410 lands the viewer on the closure page instead of a
      // silently frozen "live" report.
      if (es.readyState !== EventSource.CLOSED) return;
      const kq = viewKey ? `?k=${viewKey}` : '';
      fetch(`/api/crisis/share/${token}${kq}`)
        .then(async (r) => {
          if (r.status === 410) setGone((await r.json()) as GonePayload);
        })
        .catch(() => { /* still offline — the viewer can reload manually */ });
    };
    return () => es.close();
  }, [token, viewKey, unlocked]);

  const handlePassword = (password: string) => {
    // crypto.subtle only exists in secure contexts — on a plain-HTTP origin
    // every attempt would otherwise dead-end as "incorrect password".
    if (!globalThis.crypto?.subtle) {
      setGateError('This protected report can only be unlocked over HTTPS — ask the incident team for an https:// link.');
      return;
    }
    setChecking(true);
    setGateError(null);
    // Generated passwords are uppercase-only — accept lowercase entry (mobile
    // keyboards default to it) by normalizing before hashing.
    sha256Hex(password.toUpperCase())
      .then((hex) => {
        // Same wrong password twice: the fetch effect won't re-run (key
        // unchanged), so surface the error directly.
        if (hex === viewKey) { setChecking(false); setGateError(WRONG_PW_MSG); return; }
        setViewKey(hex);
      })
      .catch(() => { setChecking(false); setGateError('Could not verify the password in this browser — try a current browser over HTTPS.'); });
  };

  const saveViewerName = (name: string) => {
    setViewerName(name);
    try { localStorage.setItem('gsoc-share-name', name); } catch { /* private mode */ }
  };

  // Check/uncheck from the share page: optimistic overlay + POST to the
  // token-gated toggle endpoint; the response (and the SSE fanout) carry the
  // server-stamped authoritative map.
  const toggleChecklist = (itemId: string, checked: boolean) => {
    const name = viewerName.trim();
    const optimistic: ChecklistItemState = {
      checked,
      at: new Date().toISOString(),
      ...(name ? { by: name } : {}),
    };
    setChkError(null);
    setPendingChk((p) => ({ ...p, [itemId]: optimistic }));
    const kq = viewKey ? `?k=${viewKey}` : '';
    fetch(`/api/crisis/share/${token}/checklist/${itemId}${kq}`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ checked, ...(name ? { by: name } : {}) }),
    })
      .then(async (res) => {
        if (!res.ok) {
          const detail = await res.json().catch(() => ({} as { error?: string }));
          throw new Error(detail?.error || `HTTP ${res.status}`);
        }
        const { checklists } = (await res.json()) as { checklists: ChecklistStateMap };
        setData((prev) => (prev ? { ...prev, checklists } : prev));
      })
      .catch((e) => {
        console.warn('[share] checklist toggle failed:', e);
        setChkError(`Could not save the change — ${(e as Error).message}. It may be read-only on this link.`);
      })
      .finally(() => {
        setPendingChk((p) => {
          if (p[itemId] !== optimistic) return p; // a newer toggle took over
          const { [itemId]: _done, ...rest } = p;
          return rest;
        });
      });
  };

  if (gone) {
    return <ClosurePage payload={gone} />;
  }

  if (error) {
    return (
      <div className="flex h-screen items-center justify-center bg-ink-950">
        <div className="text-center">
          <p className="text-[16px] text-white/50">{error}</p>
          <p className="mt-2 text-[12px] text-white/25">This link may have been revoked or is invalid.</p>
        </div>
      </div>
    );
  }

  if (lockedBy === 'signin') {
    return <ShareSignInGate token={token} onSignedIn={() => setReloadNonce((n) => n + 1)} />;
  }

  if (lockedBy === 'password') {
    return <PasswordGate onSubmit={handlePassword} error={gateError} checking={checking} />;
  }

  if (!data) {
    return (
      <div className="flex h-screen items-center justify-center bg-ink-950">
        <div className="h-6 w-6 animate-spin rounded-full border-2 border-white/20 border-t-accent" />
      </div>
    );
  }

  const status = incidentStatusDef(data.incidentStatus);
  const { dot, badge } = status;
  const roots = data.roles.filter((r) => r.parentId === null);
  // Live layers prescribed by the incident team; drop ids this build no longer
  // knows (snapshots outlive deploys). Array.isArray guards because share
  // snapshots are stored as opaque JSON — a malformed one must not blank the
  // whole public page.
  const liveLayers = (Array.isArray(data.liveLayers) ? data.liveLayers : [])
    .filter((id) => isShareLiveLayerId(id));
  // Property groups prescribed by the incident team: the incident's own group
  // first, then any extras — deduped, and unknown ids (stale snapshots)
  // dropped. These drive the share map pins and scope the Property Watch.
  const groupIds = [data.locationGroupId, ...(Array.isArray(data.extraLocationGroups) ? data.extraLocationGroups : [])]
    .filter((id): id is string => typeof id === 'string' && id.length > 0);
  const pinGroups = [...new Set(groupIds)]
    .map((id) => LOCATION_GROUPS.find((g) => g.id === id))
    .filter((g): g is LocationGroup => g !== undefined);
  const primaryGroupId = typeof data.locationGroupId === 'string' ? data.locationGroupId : null;
  // Vessels count too: they only render on the interactive globe (the flat
  // fallback map draws hand-drawn layers only), so an incident whose whole
  // location is a ship must get the globe.
  if (liveLayers.length > 0 || pinGroups.length > 0 || shipMmsis.length > 0) globeEverRef.current = true;
  const showGlobe = globeEverRef.current;
  const drawLayers = Array.isArray(data.drawLayers) ? data.drawLayers : [];
  // Viewer-side hides mask a layer's visible flag rather than replace it: a
  // layer the incident team hid can never be surfaced by a local toggle.
  const maskedDrawLayers = drawLayers.map((l) =>
    offDraw.has(l.id) ? { ...l, visible: false } : l
  );
  const drawnLayers = maskedDrawLayers.filter((l) => l.visible && l.positions.length > 0);

  // Checklists / intake / IAP all key off the NORMALIZED type id — snapshots
  // outlive deploys and can carry retired ids. Snapshot fields are untrusted
  // JSON, so both maps are shape-guarded before use.
  const typeId = incidentTypeDef(data.incidentType).id;
  const checklistTpl = checklistTemplateFor(typeId);
  const shareChecklists: ChecklistStateMap = isChecklistStateMap(data.checklists) ? data.checklists : {};
  const effectiveChecklists: ChecklistStateMap = { ...shareChecklists, ...pendingChk };
  const intakeTpl = intakeTemplateFor(typeId);
  const intakeAnswers = isIntakeAnswers(data.intake) ? data.intake : {};
  const intakeAnswered = answeredCount(intakeTpl, intakeAnswers);
  const iapUrl = `/api/crisis/share/${token}/iap${viewKey ? `?k=${viewKey}` : ''}`;

  const SHARE_TABS = [
    { id: 'report', label: 'Situation Report' },
    { id: 'iap', label: 'IAP' },
    { id: 'checklists', label: 'Checklists' },
  ] as const;

  return (
    <div className="min-h-screen bg-ink-950 text-white">
      {/* Header — wraps on phones (most shared-link viewers are on phones) */}
      <header className="pt-safe sticky top-0 z-10 border-b border-white/8 bg-ink-900/90 px-4 py-3 backdrop-blur-sm sm:px-8 sm:py-4">
        <div className="mx-auto flex max-w-5xl flex-wrap items-center gap-x-4 gap-y-1">
          <div className="relative flex h-2.5 w-2.5 shrink-0">
            {status.id === 'active' && <span className="absolute inline-flex h-full w-full animate-ping rounded-full opacity-70" style={{ background: dot }} />}
            <span className="relative inline-flex h-2.5 w-2.5 rounded-full" style={{ background: dot }} />
          </div>
          <div className="min-w-0">
            <p className="text-[10px] font-bold uppercase tracking-[0.18em] text-white/45">Live Situation Report</p>
            <p className="truncate text-[17px] font-semibold text-white/95 sm:text-[20px]">{data.incidentName || 'Unnamed Incident'}</p>
          </div>
          <span className={`shrink-0 rounded-full border px-2.5 py-0.5 text-[10px] font-bold uppercase tracking-widest ${badge}`}>{status.label}</span>
          <LastUpdated iso={data.lastUpdated} closed={status.id === 'closed'} />
        </div>
        {/* Tabs — the report is the landing view; IAP and checklists are a tap away */}
        <div className="mx-auto mt-2 flex max-w-5xl gap-1 overflow-x-auto">
          {SHARE_TABS.map((t) => (
            <button
              key={t.id}
              onClick={() => setTab(t.id)}
              className={`shrink-0 rounded-md px-3 py-1.5 text-[12px] font-medium transition ${
                tab === t.id ? 'bg-accent/15 text-accent' : 'text-white/40 hover:text-white/65'
              }`}
            >
              {t.label}
            </button>
          ))}
        </div>
      </header>

      {/* ── Situation Report tab — kept mounted (CSS-hidden) so the globe keeps
          its camera and the log filters survive tab hops ── */}
      <main className={`mx-auto max-w-5xl space-y-8 px-4 py-6 sm:px-8 sm:py-8 ${tab === 'report' ? '' : 'hidden'}`}>

        {/* BLUF: the 30-second answer, full width and first */}
        <div>
          <h2 className="mb-3 text-[13px] font-bold uppercase tracking-[0.14em] text-white/60">Executive Summary</h2>
          <p className="whitespace-pre-wrap rounded-lg border border-white/8 bg-white/4 px-4 py-3 text-[15px] leading-relaxed text-white/90">
            {data.executiveSummary || <span className="text-white/25 italic">No summary provided</span>}
          </p>
        </div>

        {/* Intake Q&A — appears once the team has answered at least one of the
            initial-contact questions in the Intake tab */}
        {intakeAnswered > 0 && (
          <div>
            <div className="mb-3 flex flex-wrap items-baseline gap-x-3 gap-y-0.5">
              <h2 className="text-[13px] font-bold uppercase tracking-[0.14em] text-white/60">Intake — Initial Contact</h2>
              <span className="text-[11px] text-white/35">{intakeAnswered} question{intakeAnswered === 1 ? '' : 's'} answered · updates live</span>
            </div>
            <IntakeTable template={intakeTpl} answers={intakeAnswers} />
          </div>
        )}

        {/* Affected properties next — live watch scoped to the property groups
            the incident team selected; no groups means nothing is shared here */}
        {pinGroups.length > 0 && (
          <div>
            <div className="mb-3 flex flex-wrap items-baseline gap-x-3 gap-y-0.5">
              <h2 className="text-[13px] font-bold uppercase tracking-[0.14em] text-white/60">Property Watch</h2>
              <span className="text-[11px] text-white/35">Hazards near the incident properties · updates live</span>
            </div>
            <ShareWatchCard groups={pinGroups} />
          </div>
        )}

        {/* Vessels — only the ships the incident team attached, never the rest
            of the fleet. Positions are read live, so this is the one part of
            the page that changes without the team touching the report. */}
        {vessels.length > 0 && (
          <div>
            <div className="mb-3 flex flex-wrap items-baseline gap-x-3 gap-y-0.5">
              <h2 className="text-[13px] font-bold uppercase tracking-[0.14em] text-white/60">Vessels</h2>
              <span className="text-[11px] text-white/35">
                {fleet.error
                  ? fleet.error
                  : fleet.loading
                    ? 'Reading positions…'
                    : `AIS positions · ${vessels.filter((v) => v.ship).length} of ${vessels.length} reporting`}
              </span>
            </div>
            <div className="grid gap-2 sm:grid-cols-2">
              {vessels.map((v) => {
                const st = v.ship ? statusOf(v.ship) : null;
                return (
                  <div key={v.roster.mmsi} className="rounded-lg border border-white/8 bg-white/4 px-4 py-3">
                    <div className="flex items-center gap-2">
                      <span className="h-2 w-2 shrink-0 rounded-full" style={{ background: v.color }} />
                      <span className="text-[14px] font-semibold text-white/90">{v.roster.name}</span>
                      {st && (
                        <span className={`ml-auto text-[11px] ${STATUS_TONE[st.kind]}`}>
                          {st.label}
                          {v.ship?.speedKt != null && st.kind === 'underway' ? ` · ${v.ship.speedKt.toFixed(1)} kt` : ''}
                        </span>
                      )}
                    </div>
                    {v.ship ? (
                      <div className="mt-1.5 space-y-0.5 text-[11px] text-white/55">
                        <p>
                          {/* An estimate is always labelled: a share link is
                              read by people who cannot ask where it came from. */}
                          {v.ship.estimated
                            ? `${positionText(v.ship.estimated.lat, v.ship.estimated.lon)} (estimated)`
                            : positionText(v.ship.latitude, v.ship.longitude)}{' '}
                          · reported {lastSeenText(v.ship.lastSeenSec)}
                        </p>
                        {v.ship.destination && (
                          <p>
                            Destination {v.ship.destination}
                            {v.ship.etaUtc
                              ? ` · ETA ${new Date(v.ship.etaUtc).toLocaleString()}`
                              : v.ship.etaText
                                ? ` · ETA ${v.ship.etaText}`
                                : ''}
                          </p>
                        )}
                      </div>
                    ) : (
                      // Never imply an all-clear from a missing report: say the
                      // position is unknown, not that the ship is fine.
                      <p className="mt-1.5 text-[11px] text-white/35">
                        {fleet.loading ? 'Reading position…' : 'No position reported — not shown on the map'}
                      </p>
                    )}
                  </div>
                );
              })}
            </div>
          </div>
        )}

        {/* Compact details */}
        <div>
          <h2 className="mb-3 text-[13px] font-bold uppercase tracking-[0.14em] text-white/60">Incident Details</h2>
          <div className="grid gap-x-8 gap-y-2 rounded-lg border border-white/8 bg-white/4 px-4 py-3 sm:grid-cols-2">
            {[
              ['Location', data.incidentLocation],
              ['Type', incidentTypeDef(data.incidentType).label],
              ['Start', data.incidentDatetime ? new Date(data.incidentDatetime).toLocaleString() : '—'],
              ['End', data.incidentEndDatetime ? new Date(data.incidentEndDatetime).toLocaleString() : '—'],
            ].map(([label, value]) => (
              <div key={label} className="flex gap-3">
                <span className="w-20 shrink-0 text-[11px] text-white/50">{label}</span>
                <span className="min-w-0 text-[13px] text-white/85">{value || '—'}</span>
              </div>
            ))}
          </div>
        </div>

        {/* Action log */}
        {data.actionLog.length > 0 && (() => {
          const infoCount = data.actionLog.filter((e) => entryTypeOf(e) === 'info').length;
          const systemCount = data.actionLog.filter((e) => entryTypeOf(e) === 'system').length;
          const visibleLog = data.actionLog.filter(
            (e) =>
              !(hideInfo && entryTypeOf(e) === 'info') &&
              !(hideSystem && entryTypeOf(e) === 'system')
          );
          const sortedLog = [...visibleLog].sort(
            (a, b) => new Date(b.timestamp).getTime() - new Date(a.timestamp).getTime()
          );
          const shownLog = sortedLog.slice(0, logLimit);
          return (
          <div>
            <div className="mb-3 flex items-center gap-3">
              <h2 className="text-[13px] font-bold uppercase tracking-[0.14em] text-white/60">Actions &amp; Events Log</h2>
              {infoCount > 0 && (
                <button
                  onClick={() => setHideInfo((h) => !h)}
                  className={`rounded border px-2.5 py-1 text-[10px] transition ${
                    hideInfo
                      ? 'border-cyan-400/30 bg-cyan-400/10 text-cyan-300/80 hover:text-cyan-300'
                      : 'border-white/10 text-white/35 hover:text-white/55'
                  }`}
                >
                  {hideInfo ? `Show info (${infoCount})` : `Hide info (${infoCount})`}
                </button>
              )}
              {systemCount > 0 && (
                <button
                  onClick={() => setHideSystem((h) => !h)}
                  className={`rounded border px-2.5 py-1 text-[10px] transition ${
                    hideSystem
                      ? 'border-white/10 text-white/35 hover:text-white/55'
                      : 'border-white/25 bg-white/10 text-white/60 hover:text-white/80'
                  }`}
                >
                  {hideSystem ? `Show system (${systemCount})` : `Hide system (${systemCount})`}
                </button>
              )}
              <div className="ml-auto flex rounded border border-white/10 text-[10px]">
                <button
                  onClick={() => setLogView('list')}
                  className={`rounded-l px-2.5 py-1 transition ${logView === 'list' ? 'bg-white/10 text-white/70' : 'text-white/30 hover:text-white/50'}`}
                >
                  List
                </button>
                <button
                  onClick={() => setLogView('timeline')}
                  className={`rounded-r px-2.5 py-1 transition ${logView === 'timeline' ? 'bg-white/10 text-white/70' : 'text-white/30 hover:text-white/50'}`}
                >
                  Timeline
                </button>
              </div>
            </div>
            <div className="rounded-lg border border-white/8 bg-ink-950/60">
              {visibleLog.length === 0 ? (
                <p className="px-4 py-6 text-center text-[12px] text-white/30 italic">
                  All entries are currently hidden — use the filter buttons above to show them
                </p>
              ) : logView === 'timeline' ? (
                <div className="px-4 py-4">
                  <TimelineView entries={visibleLog} />
                </div>
              ) : (
                <>
                  <div className="divide-y divide-white/6">
                    {shownLog.map((entry) => (
                      <div key={entry.id} className="flex flex-wrap items-start gap-x-3 gap-y-1 px-3 py-3 sm:flex-nowrap sm:px-4">
                        <span className={`mt-0.5 shrink-0 rounded-full border px-1.5 py-0.5 text-[7px] font-bold uppercase tracking-widest ${TYPE_STYLES[entryTypeOf(entry)]}`}>
                          {entryTypeOf(entry)}
                        </span>
                        <span className="shrink-0 text-[11px] text-white/45 sm:w-36">{fmtTs(entry.timestamp)}</span>
                        <p className={`w-full text-[13px] leading-snug sm:w-auto sm:flex-1 ${entry.system ? 'italic text-white/55' : 'text-white/80'}`}>{entry.description || <span className="text-white/30 italic">No description</span>}</p>
                        <div className="shrink-0 flex flex-col items-end gap-1">
                          {(entry as { attachmentData?: string }).attachmentData && (
                            <ZoomableImage
                              src={(entry as { attachmentData?: string }).attachmentData!}
                              alt={entry.attachmentName}
                              onOpen={() => setLogLightbox({
                                src: (entry as { attachmentData?: string }).attachmentData!,
                                alt: entry.attachmentName,
                              })}
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
                  <LogShowMore total={sortedLog.length} limit={logLimit} onLimitChange={setLogLimit} />
                </>
              )}
            </div>
          </div>
          );
        })()}

        {/* Interactive incident map. With live layers prescribed by the
            incident team, this is the full interactive globe streaming those
            feeds in real time; otherwise a light flat map of just the drawn
            layers, opened centred on their combined extent. */}
        {showGlobe ? (
          <div>
            <div className="mb-3 flex items-baseline gap-3">
              <h2 className="text-[13px] font-bold uppercase tracking-[0.14em] text-white/60">Live Incident Map</h2>
              <span className="text-[11px] text-white/40">
                Interactive globe · live layers, property pins{vessels.length > 0 ? ' and vessels' : ''} selected by the incident team
              </span>
            </div>
            <Suspense
              fallback={
                <div className="grid h-[72vh] min-h-[440px] w-full place-items-center rounded-lg border border-white/10 bg-ink-950/60">
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
                pinGroups={pinGroups}
                primaryGroupId={primaryGroupId}
                vessels={vessels}
                shipGroup={shipGroup}
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
                // Measured from the published geometry, so a viewer gets the
                // distance or area without asking the incident team for it.
                const measure = measureLayer(layer);
                return (
                  <button
                    key={layer.id}
                    onClick={() => { if (!teamHidden) toggleDraw(layer.id); }}
                    disabled={teamHidden}
                    aria-pressed={shown}
                    className={`block w-full overflow-hidden rounded-lg border text-left transition ${
                      shown
                        ? 'border-white/15 bg-ink-950/60 hover:border-white/25'
                        : 'border-white/10 bg-ink-950/60 opacity-50 hover:opacity-70'
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
                      {/* Inline label (not crisisStore's geometryLabel): this page
                          value-imports only taxonomy, keeping the store out of the
                          share bundle. */}
                      <span className="text-[10px] text-white/40">
                        {layer.type} · {layer.geometry === 'line' && layer.directional ? 'directional line' : layer.geometry}
                      </span>
                      {measure.kind !== 'none' ? (
                        <span className="ml-auto min-w-0 truncate text-[10px] text-accent/75" title={measure.summary}>
                          {measure.primary}
                          {measure.detail && <span className="text-white/35"> · {measure.detail}</span>}
                        </span>
                      ) : (
                        <span className="ml-auto text-[10px] text-white/35">{layer.positions.length} points</span>
                      )}
                      <span
                        className={`shrink-0 rounded-full border px-2 py-0.5 text-[9px] font-bold uppercase tracking-widest ${
                          teamHidden
                            ? 'border-white/15 text-white/30'
                            : shown
                              ? 'border-accent/30 bg-accent/10 text-accent/80'
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

        {/* Org chart — reference material, below the operational picture */}
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

        <p className="pb-safe border-t border-white/6 pt-4 text-center text-[9px] text-white/20">
          Published {fmtTs(data.publishedAt)} · Updates automatically in real-time
        </p>
      </main>

      {/* ── IAP tab — the pre-uploaded Incident Action Plan for this incident's
          type (or the general default), in an in-page PDF reader ── */}
      {openedRef.current.has('iap') && (
        <main className={`mx-auto max-w-5xl px-4 py-6 sm:px-8 sm:py-8 ${tab === 'iap' ? '' : 'hidden'}`}>
          <div className="mb-3 flex flex-wrap items-baseline gap-x-3 gap-y-0.5">
            <h2 className="text-[13px] font-bold uppercase tracking-[0.14em] text-white/60">Incident Action Plan</h2>
            <span className="text-[11px] text-white/35">
              Reference document for {incidentTypeDef(data.incidentType).label} incidents
            </span>
          </div>
          <PdfViewer
            url={iapUrl}
            emptyMessage="No Incident Action Plan has been uploaded for this incident type yet — the incident team can add one from the admin panel."
          />
        </main>
      )}

      {/* ── Checklists tab — ICS role checklists; checking an item records a
          timestamp (and your name, if given) for the whole response to see ── */}
      {openedRef.current.has('checklists') && (
        <main className={`mx-auto max-w-5xl px-4 py-6 sm:px-8 sm:py-8 ${tab === 'checklists' ? '' : 'hidden'}`}>
          <div className="mb-3 flex flex-wrap items-center gap-x-3 gap-y-1.5">
            <h2 className="text-[13px] font-bold uppercase tracking-[0.14em] text-white/60">ICS Role Checklists</h2>
            <span className="text-[11px] text-white/35">Live for everyone on this link · each check is timestamped</span>
            <label className="ml-auto flex items-center gap-1.5 text-[10px] text-white/40">
              Your name
              <input
                value={viewerName}
                onChange={(e) => saveViewerName(e.target.value)}
                placeholder="for the record"
                maxLength={60}
                className="w-32 rounded border border-white/12 bg-white/8 px-2 py-1 text-[11px] text-white/80 placeholder-white/25 outline-none transition focus:border-white/25"
              />
            </label>
          </div>
          {chkError && (
            <p className="mb-3 rounded border border-red-400/25 bg-red-400/8 px-3 py-2 text-[11px] text-red-300/90">
              {chkError}
            </p>
          )}
          <ChecklistBoard
            template={checklistTpl}
            state={effectiveChecklists}
            onToggle={toggleChecklist}
            footnote={viewerName.trim() ? `Checks are recorded as ${viewerName.trim()}` : 'Add your name above to attribute your checks (optional)'}
          />
        </main>
      )}

      {logLightbox && (
        <ImageLightbox
          src={logLightbox.src}
          alt={logLightbox.alt}
          onClose={() => setLogLightbox(null)}
        />
      )}
    </div>
  );
}
