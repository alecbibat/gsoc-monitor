import { useEffect, useMemo, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import {
  useCrisisStore, useActiveIncident, extractPublicState, type CrisisTab,
} from './crisisStore';
import { incidentStatusDef, incidentTypeDef } from './taxonomy';
import { StandDownModal } from './StandDownModal';
import { DeleteIncidentDialog } from './DeleteIncidentDialog';
import { useAuthStore } from '../auth/authStore';
import { useIsMobile } from '../ui/useIsMobile';
import {
  CRISIS_DOCK_DEFAULT_WIDTH, useCrisisDockStore, useCrisisMapFrameStore,
} from '../ui/uiStore';
import { useCesiumViewer } from '../cesium/CesiumContext';
import { flyToBoundingBox } from '../cesium/flyTo';
import { SituationReport, MapLayersSection } from './tabs/SituationReport';
import { IntakeTab } from './tabs/Intake';
import { ChecklistsTab } from './tabs/Checklists';
import { IapTab } from './tabs/Iap';
import { IncidentList } from './IncidentList';
import { CrisisReportModal } from './CrisisReportModal';
import { checklistProgress } from './checklistTemplate';
import { answeredCount } from './intakeTemplate';
import { useResolvedChecklist, useResolvedIntake } from './templates/templatesStore';
import { useEnsureTemplatesLoaded } from './templates/editorTabChrome';
import {
  fmtExpiry, fmtRemaining, isExpiredLink, shareLinkHealth, EXPIRY_WARN_MS, useNow,
} from './shareLinkStatus';
import { incidentExtent } from './incidentSummary';
import { dismissTopEscapeLayer, isTextEntry, useEscapeLayer } from './escapeLayers';

const TABS: { id: CrisisTab; label: string }[] = [
  { id: 'situation-report', label: 'Situation Report' },
  { id: 'intake', label: 'Intake' },
  { id: 'checklists', label: 'Checklists' },
  { id: 'iap', label: 'IAP' },
];

// ── Share links panel ─────────────────────────────────────────────────────────

// readOnly: the incident is archived. Links still open on it (a revoke that
// failed at stand-down, or one opened before the archive) must stay
// revocable. Revoking a leaked link is why share-link actions bypass the
// archive freeze in the store. Creating and renewing are not offered, since
// neither makes sense on a concluded incident.
function ShareLinksPanel({ readOnly = false }: { readOnly?: boolean }) {
  const inc = useActiveIncident();
  const addShareLink = useCrisisStore((s) => s.addShareLink);
  const deactivateShareLink = useCrisisStore((s) => s.deactivateShareLink);
  const renewShareLink = useCrisisStore((s) => s.renewShareLink);
  const [open, setOpen] = useState(false);
  const [publishing, setPublishing] = useState(false);
  const [copiedToken, setCopiedToken] = useState<string | null>(null);
  const [copiedPwToken, setCopiedPwToken] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [label, setLabel] = useState('');
  // Access stats per token, fetched when the panel opens ("opened N× · last …").
  const [access, setAccess] = useState<Record<string, { count: number; viewers: number; lastAt: string | null }>>({});
  // Tokens with a revoke in flight, so a double-click can't log it twice.
  const revokingRef = useRef<Set<string>>(new Set());
  const wrapRef = useRef<HTMLDivElement>(null);
  const buttonRef = useRef<HTMLButtonElement>(null);

  // Re-render every minute so the button's expiry state flips on an idle
  // incident; each render reads the clock itself.
  useNow(60_000);
  const now = Date.now();

  const shareLinks = inc?.shareLinks ?? [];
  const openLinks = shareLinks.filter((l) => l.active);
  const health = shareLinkHealth(shareLinks, now);

  // Esc closes the dropdown before it steps out of the incident, and focus
  // returns to the button if it was inside the dropdown.
  useEscapeLayer(open, () => {
    const hadFocus = wrapRef.current?.contains(document.activeElement) ?? false;
    setOpen(false);
    if (hadFocus) buttonRef.current?.focus();
  });

  // So does a tap or click anywhere outside it. A dropdown left open behind
  // other work is how it ends up covering the next thing.
  useEffect(() => {
    if (!open) return;
    const onDown = (e: PointerEvent) => {
      if (wrapRef.current && !wrapRef.current.contains(e.target as Node)) setOpen(false);
    };
    document.addEventListener('pointerdown', onDown, true);
    return () => document.removeEventListener('pointerdown', onDown, true);
  }, [open]);

  useEffect(() => {
    if (!open || shareLinks.length === 0) return;
    let cancelled = false;
    (async () => {
      const entries = await Promise.all(
        shareLinks.map(async (l) => {
          try {
            const r = await fetch(`/api/crisis/share/${l.token}/access`, { credentials: 'include' });
            if (!r.ok) return null;
            return [l.token, await r.json()] as const;
          } catch { return null; }
        })
      );
      if (!cancelled) setAccess(Object.fromEntries(entries.filter((e): e is NonNullable<typeof e> => e !== null)));
    })();
    return () => { cancelled = true; };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open, shareLinks.length]);

  const handleCreate = async () => {
    if (!inc) return;
    // The link belongs to the incident being published, even if the operator
    // has opened another one (or gone back to the list) by the time it resolves.
    const incId = inc.id;
    setPublishing(true);
    setError(null);
    try {
      const res = await fetch('/api/crisis/publish', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        // incidentId ties the link to the incident server-side (so deleting
        // the incident revokes it); label names the audience.
        body: JSON.stringify({ ...extractPublicState(inc), incidentId: inc.id, label: label.trim() || undefined }),
      });
      if (res.status === 413) throw new Error('Incident is too large to share (too many images/attachments).');
      if (!res.ok) {
        // Surface the server's reason — a bare "try again" hides whether this
        // is an auth lapse (401), a server fault (500/503), or something else.
        let detail = '';
        try { detail = ((await res.json()) as { error?: string }).error ?? ''; } catch { /* not JSON */ }
        throw new Error(`Could not create link (${res.status}${detail ? `: ${detail}` : ''}) — please try again.`);
      }
      const { token, url, password, expiresAt } = await res.json() as {
        token: string; url: string; password?: string; expiresAt?: string;
      };
      const fullUrl = `${window.location.origin}${url}`;
      addShareLink(token, fullUrl, password, label.trim() || undefined, expiresAt, incId);
      setLabel('');
      setOpen(true);
    } catch (err) {
      console.error('[crisis] publish failed', err);
      setError(err instanceof Error ? err.message : 'Could not create link.');
    } finally {
      setPublishing(false);
    }
  };

  const handleRenew = async (token: string) => {
    const incId = inc?.id;
    setError(null);
    try {
      const res = await fetch(`/api/crisis/share/${token}/renew`, { method: 'POST', credentials: 'include' });
      if (!res.ok) throw new Error(String(res.status));
      const { expiresAt } = await res.json() as { expiresAt: string };
      renewShareLink(token, expiresAt, incId);
    } catch (err) {
      console.warn('[crisis] renew failed', err);
      setError(`Could not renew link (${err instanceof Error ? err.message : 'network error'}) — viewers lose access at expiry; try again.`);
    }
  };

  // Revoke on the server first (as StandDownModal does) and only then mark it
  // revoked locally — flipping first showed and logged a failed revoke (401,
  // 503) as done while the link stayed live, with no Revoke button to retry.
  // The flip targets the link's own incident in case the operator moved on.
  const handleDeactivate = async (token: string) => {
    if (revokingRef.current.has(token)) return;
    revokingRef.current.add(token);
    const incId = inc?.id;
    setError(null);
    try {
      const res = await fetch(`/api/crisis/share/${token}`, { method: 'DELETE', credentials: 'include' });
      // 404 = the server has no such row (already gone), so treat it as revoked.
      if (!res.ok && res.status !== 404) throw new Error(String(res.status));
      deactivateShareLink(token, incId);
    } catch (err) {
      console.warn('[crisis] revoke failed', err);
      setError(`Could not revoke link (${err instanceof Error ? err.message : 'network error'}) — it is still live; please try again.`);
    } finally {
      revokingRef.current.delete(token);
    }
  };

  const handleCopy = (url: string, token: string) => {
    navigator.clipboard.writeText(url).then(() => {
      setCopiedToken(token);
      setTimeout(() => setCopiedToken(null), 2000);
    });
  };

  const handleCopyPassword = (password: string, token: string) => {
    navigator.clipboard.writeText(password).then(() => {
      setCopiedPwToken(token);
      setTimeout(() => setCopiedPwToken(null), 2000);
    });
  };

  // Button state. Green = viewers are getting live updates. Amber = a link
  // needs attention: it lapsed (viewers see the "expired" page, and edits no
  // longer reach them) or lapses within EXPIRY_WARN_MS. On an archived
  // incident, any link still open should be revoked.
  const { live, expired, expiringInMs } = health;
  const warn = readOnly ? openLinks.length > 0 : expired > 0 || expiringInMs !== null;
  const tone = warn ? 'warn' : live > 0 ? 'live' : 'idle';
  const buttonTitle = readOnly
    ? `${openLinks.length} link${openLinks.length === 1 ? '' : 's'} still open on this archived incident. Revoke them here.`
    : expired > 0
      ? `${expired} link${expired === 1 ? ' has' : 's have'} expired. Viewers see an "expired" page and get no updates. Open to renew.`
      : expiringInMs !== null
        ? `A link expires in ${fmtRemaining(expiringInMs)}. Open to renew.`
        : live > 0
          ? `${live} live link${live === 1 ? '' : 's'}. Viewers get every update.`
          : 'Create a password-protected link for stakeholders';

  return (
    // Below md the dropdown anchors to the header's action row instead (not
    // md:relative), so it can't run off the left edge of a narrow screen.
    <div ref={wrapRef} className="md:relative">
      <button
        ref={buttonRef}
        onClick={() => setOpen((v) => !v)}
        aria-expanded={open}
        title={buttonTitle}
        className={`flex items-center gap-1.5 whitespace-nowrap rounded border px-2.5 py-1.5 text-[11px] transition sm:px-3 ${
          tone === 'warn'
            ? 'border-amber-500/40 bg-amber-500/10 text-amber-300/85 hover:border-amber-500/60 hover:text-amber-200'
            : tone === 'live'
              ? 'border-green-500/30 bg-green-500/8 text-green-400/80 hover:border-green-500/50 hover:text-green-400'
              : 'border-white/12 text-white/50 hover:border-white/22 hover:text-white'
        }`}
      >
        {tone === 'live' && <span className="h-1.5 w-1.5 rounded-full bg-green-500 animate-pulse" />}
        {tone === 'warn' && <span className="h-1.5 w-1.5 rounded-full bg-amber-400" />}
        <span className="hidden sm:inline">Share Links</span>
        <span className="sm:hidden">Share</span>
        {readOnly ? (
          openLinks.length > 0 && (
            <span className="rounded bg-amber-500/20 px-1 text-[9px] text-amber-300">{openLinks.length} open</span>
          )
        ) : (
          <>
            {live > 0 && (
              <span className="rounded bg-green-500/20 px-1 text-[9px] text-green-400">{live}</span>
            )}
            {expired > 0 ? (
              <span className="rounded bg-amber-500/20 px-1 text-[9px] text-amber-300">{expired} expired · renew</span>
            ) : expiringInMs !== null && (
              <span className="rounded bg-amber-500/20 px-1 text-[9px] text-amber-300">expires {fmtRemaining(expiringInMs)}</span>
            )}
          </>
        )}
      </button>

      {open && (
        <div className="absolute right-0 top-full z-50 mt-1.5 w-96 max-w-[calc(100vw-2rem)] rounded-lg border border-white/15 bg-ink-900 shadow-2xl">
          <div className="border-b border-white/10 px-3.5 py-2.5 flex items-center justify-between">
            <span className="text-[11px] font-bold uppercase tracking-wider text-white/70">Share Links</span>
            <button onClick={() => setOpen(false)} aria-label="Close share links" className="text-white/40 hover:text-white/80 text-[12px]">✕</button>
          </div>

          <div className="max-h-72 overflow-y-auto">
            {shareLinks.length === 0 ? (
              <p className="px-3 py-4 text-center text-[12px] text-white/50">
                No links created yet — create one below
              </p>
            ) : (
              <div className="divide-y divide-white/10">
                {[...shareLinks].reverse().map((link) => {
                  const lapsed = isExpiredLink(link, now);
                  return (
                  <div key={link.token} className={`px-3.5 py-2.5 ${link.active ? '' : 'opacity-40'}`}>
                    <div className="flex items-center gap-1.5 mb-1">
                      <span className={`h-1.5 w-1.5 rounded-full shrink-0 ${!link.active ? 'bg-white/20' : lapsed ? 'bg-amber-400' : 'bg-green-500'}`} />
                      <span className="text-[11px] text-white/60">
                        {link.label && <span className="font-semibold text-white/80">{link.label} · </span>}
                        {!link.active ? 'Revoked' : lapsed ? <span className="text-amber-300/90">Expired</span> : 'Active'} · {new Date(link.createdAt).toLocaleString(undefined, { month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit' })}
                      </span>
                      {link.active && link.expiresAt && (
                        <span
                          className={`ml-auto flex items-center gap-1 text-[10px] ${new Date(link.expiresAt).getTime() - now < EXPIRY_WARN_MS ? 'text-amber-300/80' : 'text-white/35'}`}
                          title={`Expires ${new Date(link.expiresAt).toLocaleString()}`}
                        >
                          {fmtExpiry(link.expiresAt, now)}
                          {!readOnly && (
                            <button
                              onClick={() => handleRenew(link.token)}
                              className="rounded border border-white/15 px-1.5 py-0.5 text-[9px] text-white/50 transition hover:border-white/30 hover:text-white/80"
                              title={lapsed ? 'Reopen this link to its viewers for another 72 hours' : 'Extend by 72 hours'}
                            >
                              Renew
                            </button>
                          )}
                        </span>
                      )}
                    </div>
                    {access[link.token] && access[link.token].count > 0 && (
                      <div className="mb-1 text-[10px] text-white/35">
                        Opened {access[link.token].count}× by ~{access[link.token].viewers} viewer{access[link.token].viewers === 1 ? '' : 's'}
                        {access[link.token].lastAt && ` · last ${new Date(access[link.token].lastAt!).toLocaleString(undefined, { month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit' })}`}
                      </div>
                    )}
                    <div className="flex items-center gap-1.5">
                      <code className="min-w-0 flex-1 truncate rounded bg-white/10 px-1.5 py-1 text-[11px] text-white/70">
                        {link.url}
                      </code>
                      {link.active && (
                        <>
                          <button
                            onClick={() => handleCopy(link.url, link.token)}
                            className="shrink-0 rounded border border-white/15 px-2 py-1 text-[11px] text-white/65 transition hover:border-white/30 hover:text-white"
                          >
                            {copiedToken === link.token ? '✓ Copied' : 'Copy'}
                          </button>
                          <button
                            onClick={() => handleDeactivate(link.token)}
                            className="shrink-0 text-[11px] text-white/35 transition hover:text-red-400/80"
                            title="Revoke this link"
                          >
                            Revoke
                          </button>
                        </>
                      )}
                    </div>
                    {link.active && link.password && (
                      <div className="mt-1.5 flex items-center gap-1.5">
                        <span className="shrink-0 text-[10px] uppercase tracking-wider text-white/45">Password</span>
                        <button
                          onClick={() => handleCopyPassword(link.password!, link.token)}
                          title="Click to copy password"
                          className="flex items-center gap-1.5 rounded border border-amber-400/30 bg-amber-400/10 px-2 py-0.5 font-mono text-[12px] font-semibold tracking-[0.12em] text-amber-300 transition hover:border-amber-400/60 hover:bg-amber-400/20"
                        >
                          {link.password}
                          <span className="text-[10px] font-sans font-normal tracking-normal text-amber-300/70">
                            {copiedPwToken === link.token ? '✓ copied' : '⧉'}
                          </span>
                        </button>
                      </div>
                    )}
                  </div>
                  );
                })}
              </div>
            )}
          </div>

          <div className="border-t border-white/10 px-3.5 py-2.5">
            {!readOnly && (
              <div className="mb-1.5 flex items-center gap-1.5">
                <input
                  className="min-w-0 flex-1 rounded border border-white/10 bg-white/8 px-2 py-1.5 text-[11px] text-white/80 placeholder-white/30 outline-none focus:border-white/25"
                  placeholder="Audience label (optional) — e.g. Executives"
                  value={label}
                  maxLength={80}
                  onChange={(e) => setLabel(e.target.value)}
                />
                <button
                  onClick={handleCreate}
                  disabled={publishing}
                  className="shrink-0 rounded bg-accent/15 px-3 py-1.5 text-[12px] font-medium text-accent transition hover:bg-accent/25 disabled:opacity-40"
                >
                  {publishing ? 'Creating…' : '+ Create link'}
                </button>
              </div>
            )}
            {error ? (
              <p className="text-center text-[10px] text-red-400/80" role="alert">{error}</p>
            ) : (
              <p className="text-center text-[10px] text-white/40">
                {readOnly
                  ? 'Archived incident: open links serve the closed snapshot until revoked'
                  : 'Viewers need the link password · links expire after 72 h unless renewed'}
              </p>
            )}
          </div>
        </div>
      )}
    </div>
  );
}

// ── Save-status indicator ──────────────────────────────────────────────────────

function SyncIndicator() {
  const syncState = useCrisisStore((s) => s.syncState);
  if (syncState === 'idle') return null;

  const cfg = {
    saving: { dot: 'bg-amber-400', text: 'text-white/45', label: 'Saving…', pulse: true },
    saved:  { dot: 'bg-green-500', text: 'text-white/40', label: 'All changes saved', pulse: false },
    error:  { dot: 'bg-red-500',   text: 'text-red-400/80', label: 'Unsaved — will retry', pulse: true },
  }[syncState];

  return (
    <div className="flex items-center gap-1.5 text-[10px]" title={cfg.label} aria-live="polite">
      <span className={`h-1.5 w-1.5 rounded-full ${cfg.dot} ${cfg.pulse ? 'animate-pulse' : ''}`} />
      <span className={`hidden sm:inline ${cfg.text}`}>{cfg.label}</span>
    </div>
  );
}

// ── Live-map dock ─────────────────────────────────────────────────────────────

// The incident the dock last auto-framed. Module-level, not a ref: the dock
// unmounts for every draw session (drawing closes the workspace) and must not
// re-frame on the way back. The list view clears it, so the next open frames.
let framedIncidentId: string | null = null;

// The right-hand column of the crisis workspace. Its map window is
// deliberately transparent and pointer-events-none: the overlay root lets
// hits fall through there to the globe frame below (App.tsx pins the live
// viewer to this window's rect), so the map stays fully interactive inside
// the dock. The drawn-layer toolkit sits directly beneath the map it edits.
function MapDock({ isArchived }: { isArchived: boolean }) {
  const viewer   = useCesiumViewer();
  const inc      = useActiveIncident();
  const width    = useCrisisDockStore((s) => s.widthPx);
  const setWidth = useCrisisDockStore((s) => s.setWidthPx);
  const setRect  = useCrisisMapFrameStore((s) => s.setRect);
  const holeRef  = useRef<HTMLDivElement>(null);

  // Publish the map window's screen rect (and clear it on unmount) so the
  // globe's container can dock itself to exactly this box.
  useEffect(() => {
    const el = holeRef.current;
    if (!el) return;
    const publish = () => {
      const r = el.getBoundingClientRect();
      setRect({ left: r.left, top: r.top, width: r.width, height: r.height });
    };
    publish();
    const ro = new ResizeObserver(publish);
    ro.observe(el);
    window.addEventListener('resize', publish);
    return () => {
      ro.disconnect();
      window.removeEventListener('resize', publish);
      setRect(null);
    };
  }, [setRect]);

  // Left-edge drag: the dock is right-anchored, so its width is the distance
  // from the pointer to the right viewport edge.
  const startResize = (e: React.PointerEvent) => {
    e.preventDefault();
    const move = (ev: PointerEvent) => {
      const max = Math.min(720, Math.round(window.innerWidth * 0.5));
      setWidth(Math.min(Math.max(360, window.innerWidth - ev.clientX), max));
    };
    const up = () => {
      window.removeEventListener('pointermove', move);
      window.removeEventListener('pointerup', up);
    };
    window.addEventListener('pointermove', move);
    window.addEventListener('pointerup', up);
  };

  // The property's own locations count, not just drawn layers, so an
  // incident can be framed from the moment its property is set.
  const extent = inc ? incidentExtent(inc) : null;

  const zoomToIncident = () => {
    if (!viewer || viewer.isDestroyed() || !extent) return;
    const { west: w, south: s, east: e, north: n } = extent;
    // Pad the extent so a single point still frames as a sensible area.
    const padLon = Math.max(0.05, (e - w) * 0.2);
    const padLat = Math.max(0.05, (n - s) * 0.2);
    flyToBoundingBox(viewer, w - padLon, s - padLat, e + padLon, n + padLat);
  };

  // Frame the incident once each time it is opened from the list. Otherwise
  // the dock shows wherever the shared globe was last left, often another
  // continent. Later edits never move the operator's camera, and neither does
  // coming back from a draw session (the dock remounts then; see
  // framedIncidentId). The frames let the globe settle into the dock's rect.
  const hasExtent = extent !== null;
  useEffect(() => {
    if (!viewer || !inc || !hasExtent || framedIncidentId === inc.id) return;
    framedIncidentId = inc.id;
    requestAnimationFrame(() => requestAnimationFrame(zoomToIncident));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [viewer, inc?.id, hasExtent]);

  return (
    <aside
      className="pointer-events-none relative flex shrink-0 flex-col border-l border-white/10"
      style={{ width, minWidth: 360, maxWidth: '50vw' }}
    >
      {/* Drag-to-resize handle */}
      <div
        onPointerDown={startResize}
        onDoubleClick={() => setWidth(CRISIS_DOCK_DEFAULT_WIDTH)}
        title="Drag to resize · double-click to reset"
        className="group pointer-events-auto absolute inset-y-0 left-0 z-10 w-2 cursor-col-resize"
      >
        <div className="mx-auto h-full w-0.5 bg-transparent transition group-hover:bg-accent/40" />
      </div>

      {/* Map window header */}
      <div className="pointer-events-auto flex shrink-0 items-center gap-2 border-b border-white/10 bg-ink-900 px-3.5 py-2">
        <span className="h-1.5 w-1.5 shrink-0 rounded-full bg-accent-ok shadow-glow" />
        <span className="text-[10px] font-bold uppercase tracking-[0.14em] text-white/55">Live Map</span>
        <span className="truncate text-[9px] text-white/35">Drawn layers · live feeds</span>
        <button
          onClick={zoomToIncident}
          disabled={!extent}
          className="ml-auto shrink-0 rounded border border-white/12 px-2 py-1 text-[9px] text-white/45 transition hover:border-white/25 hover:text-white/70 disabled:opacity-30"
          title={extent ? "Frame the incident's property and drawn layers" : 'Set the property or draw a layer to frame the incident'}
        >
          Zoom to incident
        </button>
      </div>

      {/* Transparent map window — the live globe shows through and stays
          interactive (see GlobeFrame in App.tsx). */}
      <div ref={holeRef} className="pointer-events-none h-[46%] min-h-[240px] shrink-0 border-b border-white/10" />

      {/* Map tooling directly under the map it edits */}
      <div className="pointer-events-auto min-h-0 flex-1 overflow-y-auto bg-ink-950 px-4 py-4">
        <fieldset disabled={isArchived} className="m-0 min-w-0 border-0 p-0">
          <MapLayersSection />
        </fieldset>
      </div>
    </aside>
  );
}

// ── Incident detail (full-screen workspace with a docked live map) ────────────

// Progress for the Intake / Checklists tab labels, from the same resolved
// templates the tabs render. Not shown until the templates have loaded.
type TabCount = { done: number; total: number; noun: string };

function TabCountBadge({ count }: { count: TabCount }) {
  const complete = count.done >= count.total;
  return (
    <span
      className={`ml-1.5 rounded px-1 py-px text-[10px] tabular-nums ${complete ? 'bg-green-500/15 text-green-400/80' : 'bg-white/8 text-white/45'}`}
      title={`${count.done} of ${count.total} ${count.noun}`}
    >
      <span className="sr-only">, {count.done} of {count.total} {count.noun}</span>
      <span aria-hidden="true">{count.done}/{count.total}</span>
    </span>
  );
}

function IncidentDetail() {
  const close            = useCrisisStore((s) => s.close);
  const backToList       = useCrisisStore((s) => s.backToList);
  const removeIncident   = useCrisisStore((s) => s.removeIncident);
  const reopen           = useCrisisStore((s) => s.reopenIncident);
  const activeTab        = useCrisisStore((s) => s.activeTab);
  const setTab           = useCrisisStore((s) => s.setTab);
  const inc              = useActiveIncident();
  const user             = useAuthStore((s) => s.user);
  const [showReport, setShowReport] = useState(false);
  const [showStandDown, setShowStandDown] = useState(false);
  const [showDelete, setShowDelete] = useState(false);
  const isMobile = useIsMobile();
  const dockCollapsed = useCrisisDockStore((s) => s.collapsed);
  const setDockCollapsed = useCrisisDockStore((s) => s.setCollapsed);
  const showDock = !isMobile && !dockCollapsed;

  // Tab progress. Normalized type, as the tabs resolve it: a retired type id
  // must count like its successor does.
  const typeId = inc ? incidentTypeDef(inc.incidentType).id : null;
  const propertyId = inc?.locationGroupId ?? null;
  const checklist = useResolvedChecklist(typeId, propertyId);
  const intake = useResolvedIntake(typeId, propertyId);
  useEnsureTemplatesLoaded(checklist.status, checklist.reload);
  const checklistTpl = checklist.template;
  const intakeTpl = intake.template;
  const checklistState = inc?.checklists;
  const intakeAnswers = inc?.intake;
  const tabCounts = useMemo(() => {
    const counts: Partial<Record<CrisisTab, TabCount>> = {};
    if (checklistTpl) {
      const p = checklistProgress(checklistTpl, checklistState ?? {});
      if (p.total > 0) counts.checklists = { done: p.done, total: p.total, noun: 'checklist items done' };
    }
    if (intakeTpl) {
      const total = intakeTpl.groups.reduce((n, g) => n + g.questions.length, 0);
      if (total > 0) counts.intake = { done: answeredCount(intakeTpl, intakeAnswers ?? {}), total, noun: 'intake questions answered' };
    }
    return counts;
  }, [checklistTpl, checklistState, intakeTpl, intakeAnswers]);

  if (!inc) return null;
  const isArchived = !!inc.archivedAt;
  const canDelete  = !isArchived || user?.role === 'admin';
  const hasOpenLinks = (inc.shareLinks ?? []).some((l) => l.active);
  const { dot, badge, label: statusLabel } = incidentStatusDef(inc.incidentStatus);
  const td = incidentTypeDef(inc.incidentType);

  return (
    <>
    <div className="pointer-events-none fixed inset-0 z-[2000] flex flex-col">
      {/* Header spans the whole workspace. Surfaces are solid: this is a full
          takeover, and translucent inks let the HUD underneath ghost through.
          Below md it wraps rather than squeezes: the actions drop to a second
          row and the name keeps its width. From md up (where the map dock is,
          whose frame tracks this header's height) it stays one row. */}
      <header className="pointer-events-auto flex shrink-0 flex-wrap items-center gap-x-3 gap-y-2 border-b border-white/10 bg-ink-900 px-3 py-2.5 sm:px-5 sm:py-3 md:flex-nowrap">
          <button
            onClick={backToList}
            className="flex items-center gap-1 rounded border border-white/10 px-2.5 py-1.5 text-[11px] text-white/45 transition hover:border-white/22 hover:text-white"
            title="All incidents"
            aria-label="All incidents"
          >
            <svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
              <polyline points="15 18 9 12 15 6" />
            </svg>
            <span className="hidden sm:inline">Incidents</span>
          </button>

          {/* flex-1 + min-w-0 so long names/types truncate instead of pushing
              into (or under) the action buttons on the right; the basis is
              what makes the actions wrap before the name is squeezed out. The
              incident type lives in the eyebrow line — a chip here kept
              colliding with its neighbors at narrow widths. */}
          <div className="flex min-w-0 flex-1 basis-44 items-center gap-2.5">
            <div className="relative flex h-2.5 w-2.5 shrink-0">
              {inc.incidentStatus === 'active' && !isArchived && (
                <span className="absolute inline-flex h-full w-full animate-ping rounded-full opacity-70" style={{ background: dot }} />
              )}
              <span className="relative inline-flex h-2.5 w-2.5 rounded-full" style={{ background: isArchived ? '#4b5563' : dot }} />
            </div>
            <div className="min-w-0">
              <div className="truncate text-[9px] font-bold uppercase tracking-[0.18em] text-white/35">
                Crisis Response
                <span className="text-white/20"> · </span>
                <span style={{ color: td.color }} title={`Incident type: ${td.label}`}>{td.icon} {td.label}</span>
              </div>
              <div className="truncate text-[13px] font-semibold text-white/90">{inc.incidentName || 'Untitled Incident'}</div>
            </div>
            <span className={`shrink-0 rounded-full border px-2 py-0.5 text-[9px] font-bold uppercase tracking-widest ${badge}`}>
              {statusLabel}
            </span>
            {isArchived && (
              <span className="shrink-0 rounded-full border border-white/15 bg-white/6 px-2 py-0.5 text-[9px] font-bold uppercase tracking-widest text-white/40">
                Archived
              </span>
            )}
          </div>

          {/* relative: below md the Share Links dropdown anchors here. */}
          <div className="relative ml-auto flex items-center gap-2">
            <SyncIndicator />
            {(!isArchived || hasOpenLinks) && <ShareLinksPanel readOnly={isArchived} />}

            {/* Stand-down or reopen depending on archive state */}
            {isArchived ? (
              <>
                <button
                  onClick={() => setShowReport(true)}
                  className="flex items-center gap-1.5 whitespace-nowrap rounded border border-white/10 px-3 py-1.5 text-[11px] text-white/40 transition hover:border-white/22 hover:text-white/70"
                  title="After-action review and PDF report"
                >
                  <svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                    <path d="M14 2H6a2 2 0 00-2 2v16a2 2 0 002 2h12a2 2 0 002-2V8z" />
                    <polyline points="14 2 14 8 20 8" />
                    <line x1="8" y1="13" x2="16" y2="13" />
                    <line x1="8" y1="17" x2="13" y2="17" />
                  </svg>
                  <span className="sm:hidden">AAR</span>
                  <span className="hidden sm:inline">After-Action Review</span>
                </button>
                <button
                  onClick={() => {
                    if (confirm(`Reopen "${inc.incidentName || 'Untitled'}"? It will return to the active incident list.`)) {
                      reopen(inc.id);
                    }
                  }}
                  className="whitespace-nowrap rounded border border-accent/25 bg-accent/8 px-3 py-1.5 text-[11px] text-accent/70 transition hover:border-accent/45 hover:text-accent"
                >
                  Reopen<span className="hidden sm:inline"> Incident</span>
                </button>
              </>
            ) : (
              <button
                onClick={() => setShowStandDown(true)}
                className="whitespace-nowrap rounded border border-amber-500/25 bg-amber-500/8 px-3 py-1.5 text-[11px] text-amber-300/60 transition hover:border-amber-500/40 hover:text-amber-300/90"
              >
                Stand Down
              </button>
            )}

            {/* Phones delete from the incident list, where the card's Delete
                stays visible, so the header keeps room for the name. */}
            {canDelete && (
              <button
                onClick={() => setShowDelete(true)}
                className="hidden rounded border border-white/8 px-3 py-1.5 text-[11px] text-white/30 transition hover:border-red-500/30 hover:text-red-400/70 sm:inline-flex"
              >
                Delete
              </button>
            )}

            {!isMobile && (
              <button
                onClick={() => setDockCollapsed(!dockCollapsed)}
                className={`flex items-center gap-1.5 rounded border px-2.5 py-1.5 text-[11px] transition ${
                  dockCollapsed
                    ? 'border-white/12 text-white/50 hover:border-white/22 hover:text-white'
                    : 'border-accent/30 bg-accent/8 text-accent/80 hover:border-accent/50 hover:text-accent'
                }`}
                title={dockCollapsed ? 'Show the live-map dock' : 'Hide the map — full-width workspace (map layers move under the Situation Report)'}
                aria-pressed={!dockCollapsed}
              >
                <svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                  <polygon points="1 6 8 3 16 6 23 3 23 18 16 21 8 18 1 21 1 6" />
                  <line x1="8" y1="3" x2="8" y2="18" />
                  <line x1="16" y1="6" x2="16" y2="21" />
                </svg>
                Map
              </button>
            )}
            <button
              onClick={close}
              className="flex items-center gap-1.5 rounded border border-white/12 px-2.5 py-1.5 text-[11px] text-white/50 transition hover:border-white/22 hover:text-white sm:px-3"
              aria-label="Close"
              title="Close the crisis workspace"
            >
              <svg width="11" height="11" viewBox="0 0 24 24" fill="none">
                <path d="M6 6L18 18M6 18L18 6" stroke="currentColor" strokeWidth="2" strokeLinecap="round" />
              </svg>
              <span className="hidden sm:inline">Esc</span>
            </button>
          </div>
      </header>

      <div className="flex min-h-0 flex-1">
        {/* Primary workspace: tabs + tab content */}
        <div className="pointer-events-auto flex min-w-0 flex-1 flex-col bg-ink-950 pb-safe">
          {/* Tabs. Scroll sideways rather than clip on narrow screens. */}
          <nav className="flex shrink-0 gap-1 overflow-x-auto border-b border-white/8 bg-ink-900/40 px-3 py-2 sm:px-5" aria-label="Incident sections">
            {TABS.map((tab) => (
              <button
                key={tab.id}
                aria-current={activeTab === tab.id ? 'true' : undefined}
                onClick={() => setTab(tab.id)}
                className={`flex shrink-0 items-center whitespace-nowrap rounded-md px-3.5 py-1.5 text-[12px] font-medium transition ${
                  activeTab === tab.id ? 'bg-accent/15 text-accent' : 'text-white/40 hover:text-white/65'
                }`}
              >
                {tab.label}
                {tabCounts[tab.id] && <TabCountBadge count={tabCounts[tab.id]!} />}
              </button>
            ))}
            {/* /20, not /18: slash opacities outside Tailwind's scale don't
                generate, and the un-styled text renders bright instead of faint.
                Hidden on phones, where tab width is scarce. */}
            {['Resource Tracker', 'Comms Log'].map((label) => (
              <button key={label} disabled className="hidden shrink-0 cursor-not-allowed whitespace-nowrap rounded-md px-3.5 py-1.5 text-[12px] font-medium text-white/20 sm:block" title="Coming soon">
                {label}
              </button>
            ))}
          </nav>

          {/* Content */}
          <main className="min-h-0 flex-1 overflow-y-auto px-3 py-5 sm:px-5">
            {activeTab === 'situation-report' && <SituationReport />}
            {activeTab === 'intake' && <IntakeTab />}
            {activeTab === 'checklists' && <ChecklistsTab />}
            {activeTab === 'iap' && <IapTab />}
            {/* The drawn-layer toolkit normally sits in the map dock. Without
                the dock (phones, or the Map toggle off) it lives here instead,
                so layers can always be created, drawn, hidden and deleted.
                Only one copy is ever mounted. Same archived freeze as the dock's. */}
            {!showDock && activeTab === 'situation-report' && (
              <fieldset disabled={isArchived} className="m-0 mt-6 min-w-0 border-0 p-0">
                <MapLayersSection />
              </fieldset>
            )}
          </main>
        </div>

        {/* Live-map dock (desktop; the Map header button hides it) */}
        {showDock && <MapDock isArchived={isArchived} />}
      </div>
    </div>

    {showReport && (
      <CrisisReportModal incident={inc} onClose={() => setShowReport(false)} />
    )}
    {showStandDown && (
      <StandDownModal
        incident={inc}
        onClose={() => setShowStandDown(false)}
        // Stays on the now-archived incident, whose header hosts the review.
        onOpenReport={() => { setShowStandDown(false); setShowReport(true); }}
      />
    )}
    {showDelete && (
      <DeleteIncidentDialog
        incident={inc}
        requirePhrase={!isArchived}
        onClose={() => setShowDelete(false)}
        onConfirm={() => { setShowDelete(false); removeIncident(inc.id); }}
      />
    )}
    </>
  );
}

// ── List shell (full screen) ──────────────────────────────────────────────────

function IncidentListShell() {
  const close = useCrisisStore((s) => s.close);
  useEffect(() => { framedIncidentId = null; }, []);
  return (
    <div className="fixed inset-0 z-[2000] flex flex-col bg-ink-950">
      <header className="flex shrink-0 items-center gap-4 border-b border-white/10 bg-ink-900 px-4 py-3.5 sm:px-6">
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
          className="ml-auto flex items-center gap-1.5 rounded border border-white/12 px-2.5 py-1.5 text-[11px] text-white/50 transition hover:border-white/22 hover:text-white sm:px-3"
          aria-label="Close"
          title="Close the crisis workspace"
        >
          <svg width="11" height="11" viewBox="0 0 24 24" fill="none">
            <path d="M6 6L18 18M6 18L18 6" stroke="currentColor" strokeWidth="2" strokeLinecap="round" />
          </svg>
          <span className="hidden sm:inline">Esc</span>
        </button>
      </header>
      <main className="min-h-0 flex-1 overflow-y-auto px-4 py-6 sm:px-6">
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
  const activeIncidentId = useCrisisStore((s) => s.activeIncidentId);

  // Esc steps back one level at a time. It never tears the whole workspace
  // down from inside a field or popover (see escapeLayers.ts for the order).
  // Window BUBBLE phase on purpose: the modals' capture listeners, React
  // handlers that preventDefault(), and the admin page (which stops every key
  // at the document) all get the press first.
  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key !== 'Escape' || e.defaultPrevented || e.isComposing) return;
      if (dismissTopEscapeLayer()) return;
      const focused = document.activeElement;
      if (isTextEntry(focused)) {
        focused.blur();
        return;
      }
      const s = useCrisisStore.getState();
      if (s.activeIncidentId) s.backToList();
      else s.close();
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [open]);

  if (!open) return null;

  return createPortal(
    activeIncidentId ? <IncidentDetail /> : <IncidentListShell />,
    document.body
  );
}
