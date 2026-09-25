import { useEffect, useState } from 'react';
import { createPortal } from 'react-dom';
import { useCrisisStore, extractPublicState, type Incident, type ShareLink } from './crisisStore';
import { isExpiredLink } from './shareLinkStatus';

// ── Stand-down checklist (roadmap F3) ────────────────────────────────────────
// Stand-down is an orchestrated sequence, not a status write:
//   1. push the final (Closed) snapshot to every active share link, so
//      viewers see the conclusion instead of a stale ACTIVE page;
//   2. revoke all share links, expired ones included (Renew revives an
//      expired link, so it must not outlive the incident either);
//   3. release open ICS assignments, stamp closed-by/reason, log the event,
//      archive (all inside standDownIncident).
// Step 3 ALWAYS runs: a share request that fails or stalls on a poor link
// (ship satellite, lodge Wi-Fi) is reported, never allowed to leave the
// incident open or the operator stuck on "Working…". Links that could not be
// revoked get a Retry here, and stay revocable from the archived incident's
// Share Links panel. The after-action review opens straight from the finished
// state (and later from the archive card).

interface StepState {
  label: string;
  status: 'pending' | 'running' | 'done' | 'failed';
  detail?: string;
}

// Long enough for a slow satellite round trip, short enough that nobody
// reaches for the reload button.
const REQUEST_TIMEOUT_MS = 15_000;

// AbortSignal.timeout with a fallback for engines that predate it (pre-2022).
function timeoutSignal(ms: number): AbortSignal {
  if (typeof AbortSignal.timeout === 'function') return AbortSignal.timeout(ms);
  const c = new AbortController();
  setTimeout(() => c.abort(), ms);
  return c.signal;
}

type PublishResult = 'ok' | 'gone' | 'failed';

// Per-link results rather than publishShareSnapshotsAndWait's single boolean:
// a 404 means the server no longer serves that link (it lapsed, or was
// revoked elsewhere), so its viewers are already on the closure page. That is
// not a failure. Only a link that is still live and missed the update is.
async function publishFinal(inc: Incident, tokens: string[]): Promise<PublishResult[]> {
  const body = JSON.stringify(extractPublicState(inc));
  return Promise.all(tokens.map(async (token): Promise<PublishResult> => {
    try {
      const res = await fetch(`/api/crisis/share/${token}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        credentials: 'include',
        body,
        signal: timeoutSignal(REQUEST_TIMEOUT_MS),
      });
      if (res.ok) return 'ok';
      if (res.status === 404) return 'gone';
      console.warn(`[crisis] stand-down publish failed (${res.status}) for share ${token}`);
      return 'failed';
    } catch (err) {
      console.warn(`[crisis] stand-down publish failed for share ${token}`, err);
      return 'failed';
    }
  }));
}

async function revokeOnServer(token: string): Promise<boolean> {
  try {
    const res = await fetch(`/api/crisis/share/${token}`, {
      method: 'DELETE',
      credentials: 'include',
      signal: timeoutSignal(REQUEST_TIMEOUT_MS),
    });
    // 404 = the server has no such row (already gone): nothing left to revoke,
    // same as the Share Links panel's Revoke.
    return res.ok || res.status === 404;
  } catch {
    return false;
  }
}

function linkName(link: ShareLink): string {
  if (link.label) return `"${link.label}"`;
  const created = new Date(link.createdAt).toLocaleString(undefined, {
    month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit',
  });
  return `the link created ${created}`;
}

function revokeStepResult(total: number, failed: ShareLink[]): Partial<StepState> {
  if (total === 0) return { status: 'done', detail: 'no active links' };
  if (failed.length === 0) return { status: 'done', detail: undefined };
  const names = failed.map(linkName).join(', ');
  return {
    status: 'failed',
    detail: `${names} could not be revoked. ${failed.length === 1 ? 'It keeps' : 'They keep'} serving the closed snapshot until revoked. Retry below, or revoke later from Share Links on the archived incident.`,
  };
}

export function StandDownModal({
  incident,
  onClose,
  onOpenReport,
}: {
  incident: Incident;
  onClose: () => void;
  /** Open the after-action review on the (now archived) incident. */
  onOpenReport?: () => void;
}) {
  const standDownIncident = useCrisisStore((s) => s.standDownIncident);
  const deactivateShareLink = useCrisisStore((s) => s.deactivateShareLink);
  const backToList = useCrisisStore((s) => s.backToList);

  // Every un-revoked link, expired or not (see the header).
  const activeLinks = (incident.shareLinks ?? []).filter((l) => l.active);
  const expiredCount = activeLinks.filter((l) => isExpiredLink(l)).length;
  const openAssignments = incident.assignments.filter((a) => !a.endedAt).length;

  const [reason, setReason] = useState('');
  const [busy, setBusy] = useState(false);
  const [steps, setSteps] = useState<StepState[] | null>(null);
  const [revokeTotal, setRevokeTotal] = useState(0);
  const [failedRevokes, setFailedRevokes] = useState<ShareLink[]>([]);

  useEffect(() => {
    // Swallow Esc even while busy so CrisisOverlay's window listener can't
    // unmount this modal mid-sequence; only dismiss when idle.
    const handler = (e: KeyboardEvent) => {
      if (e.key !== 'Escape') return;
      e.stopPropagation();
      if (!busy) onClose();
    };
    document.addEventListener('keydown', handler, true);
    return () => document.removeEventListener('keydown', handler, true);
  }, [busy, onClose]);

  const update = (i: number, patch: Partial<StepState>) =>
    setSteps((s) => s && s.map((st, idx) => (idx === i ? { ...st, ...patch } : st)));

  // Revoke in parallel (each request is bounded by its timeout) and flip the
  // successes locally on the incident's own id. The modal's `incident` prop is
  // a render-time snapshot, and a retry runs after the archive. Returns the
  // links still live.
  const revokeAll = async (links: ShareLink[]): Promise<ShareLink[]> => {
    const ok = await Promise.all(links.map((l) => revokeOnServer(l.token)));
    const failed: ShareLink[] = [];
    links.forEach((l, i) => {
      if (ok[i]) deactivateShareLink(l.token, incident.id);
      else failed.push(l);
    });
    return failed;
  };

  const run = async () => {
    if (busy) return;
    setBusy(true);
    const now = new Date().toISOString();
    const finalInc: Incident = { ...incident, incidentStatus: 'closed', archivedAt: now };
    const links = activeLinks;
    const publishTokens = links.map((l) => l.token);
    // Legacy fallback: shareToken set but shareLinks never populated.
    if ((incident.shareLinks ?? []).length === 0 && incident.shareToken) publishTokens.push(incident.shareToken);

    const n = publishTokens.length;
    setSteps([
      { label: `Publish final snapshot to ${n} share link${n === 1 ? '' : 's'}`, status: 'pending' },
      { label: `Revoke ${links.length} share link${links.length === 1 ? '' : 's'}`, status: 'pending' },
      { label: `Release ${openAssignments} open ICS assignment${openAssignments === 1 ? '' : 's'} · mark Closed · archive`, status: 'pending' },
    ]);
    setRevokeTotal(links.length);

    try {
      // 1. Final snapshot first: after revocation the share PATCH is rejected.
      update(0, { status: 'running' });
      if (n === 0) {
        update(0, { status: 'done', detail: 'no active links' });
      } else {
        const results = await publishFinal(finalInc, publishTokens);
        const failed = results.filter((r) => r === 'failed').length;
        const gone = results.filter((r) => r === 'gone').length;
        update(0, failed
          ? { status: 'failed', detail: `${failed} link${failed === 1 ? '' : 's'} did not take the update. Viewers may see the pre-closure state until the link is revoked.` }
          : { status: 'done', detail: gone ? `${gone} already closed to viewers (expired or revoked)` : undefined });
      }

      // 2. Revoke every active link. Failures are reported (with a retry) but
      // don't block the stand-down.
      update(1, { status: 'running' });
      const stillLive = await revokeAll(links);
      setFailedRevokes(stillLive);
      update(1, revokeStepResult(links.length, stillLive));
    } finally {
      // Anything interrupted above reads as failed, never as a spinner forever.
      setSteps((s) => s && s.map((st, i) => (
        i < 2 && (st.status === 'pending' || st.status === 'running') ? { ...st, status: 'failed', detail: 'interrupted' } : st
      )));
      // 3. Close out the incident itself, whatever happened to the links.
      update(2, { status: 'running' });
      standDownIncident(incident.id, reason);
      update(2, { status: 'done' });
      setBusy(false);
    }
  };

  const retryRevoke = async () => {
    if (busy || failedRevokes.length === 0) return;
    setBusy(true);
    update(1, { status: 'running', detail: undefined });
    try {
      const stillLive = await revokeAll(failedRevokes);
      setFailedRevokes(stillLive);
      update(1, revokeStepResult(revokeTotal, stillLive));
    } finally {
      setBusy(false);
    }
  };

  const finished = !busy && steps !== null && steps.every((s) => s.status === 'done' || s.status === 'failed');

  const modal = (
    <div className="fixed inset-0 z-[2700] flex items-center justify-center bg-black/60 p-4" onClick={() => { if (!busy) onClose(); }}>
      <div
        role="dialog"
        aria-modal="true"
        aria-label="Stand down incident"
        className="w-full max-w-md rounded-xl border border-amber-500/25 bg-ink-950 p-5 shadow-2xl"
        onClick={(e) => e.stopPropagation()}
      >
        <h3 className="text-[15px] font-semibold text-white/90">Stand Down Incident</h3>
        <p className="mt-1 text-[11px] text-white/45">
          {incident.incidentName || 'Untitled Incident'}: this concludes the incident. The archived
          record is frozen (reopen to edit). The After-Action Review is written afterwards, straight
          from here or from the incident's card in the Archive.
        </p>

        {steps === null ? (
          <>
            <ul className="mt-4 space-y-1.5 text-[11px] text-white/60">
              <li>· Publish the final <span className="text-green-400/90 font-semibold">Closed</span> state to {activeLinks.length} active share link{activeLinks.length === 1 ? '' : 's'}</li>
              <li>
                · Revoke {activeLinks.length === 0 ? 'share links (none active)' : `all ${activeLinks.length} share link${activeLinks.length === 1 ? '' : 's'}`}
                {expiredCount > 0 && <span className="text-white/40"> (including {expiredCount} expired, so a Renew can't revive {expiredCount === 1 ? 'it' : 'them'})</span>}
              </li>
              <li>· Release {openAssignments} open ICS assignment{openAssignments === 1 ? '' : 's'}</li>
              <li>· Stamp who stood it down, and why, into the log</li>
            </ul>
            <label className="mt-4 block text-[10px] font-semibold uppercase tracking-wider text-white/35">
              Stand-down reason <span className="font-normal normal-case text-white/25">(optional, goes in the log and report)</span>
            </label>
            <textarea
              className="mt-1.5 w-full resize-none rounded border border-white/10 bg-white/6 px-2.5 py-1.5 text-[12px] text-white/85 placeholder-white/25 outline-none focus:border-white/25"
              rows={2}
              placeholder="e.g. Fire 100% contained, all guests accounted for"
              value={reason}
              onChange={(e) => setReason(e.target.value)}
            />
            <div className="mt-4 flex justify-end gap-2">
              <button
                onClick={onClose}
                className="rounded border border-white/12 px-3 py-1.5 text-[11px] text-white/50 transition hover:border-white/22 hover:text-white"
              >
                Cancel
              </button>
              <button
                onClick={run}
                disabled={busy}
                className="rounded border border-amber-500/40 bg-amber-500/12 px-4 py-1.5 text-[11px] font-semibold text-amber-300 transition hover:border-amber-500/60 hover:bg-amber-500/20 disabled:opacity-40"
              >
                Stand Down
              </button>
            </div>
          </>
        ) : (
          <>
            <ul className="mt-4 space-y-2" aria-live="polite">
              {steps.map((s, i) => (
                <li key={i} className="flex items-start gap-2 text-[11px]">
                  <span className="mt-0.5">
                    {s.status === 'done' && <span className="text-green-400">✓</span>}
                    {s.status === 'failed' && <span className="text-red-400">✗</span>}
                    {s.status === 'running' && (
                      <span className="inline-block h-3 w-3 animate-spin rounded-full border-2 border-white/20 border-t-amber-300" />
                    )}
                    {s.status === 'pending' && <span className="text-white/25">·</span>}
                  </span>
                  <span className={s.status === 'pending' ? 'text-white/30' : 'text-white/70'}>
                    {s.label}
                    {s.detail && <span className="block text-[10px] text-white/35">{s.detail}</span>}
                  </span>
                </li>
              ))}
            </ul>
            <div className="mt-4 flex flex-wrap justify-end gap-2">
              {finished && failedRevokes.length > 0 && (
                <button
                  onClick={retryRevoke}
                  className="mr-auto rounded border border-red-500/35 bg-red-500/10 px-3 py-1.5 text-[11px] text-red-300/90 transition hover:border-red-500/55 hover:text-red-200"
                >
                  Retry revoke ({failedRevokes.length})
                </button>
              )}
              {finished && onOpenReport && (
                <button
                  onClick={onOpenReport}
                  className="rounded border border-accent/30 bg-accent/10 px-3 py-1.5 text-[11px] font-medium text-accent/85 transition hover:border-accent/50 hover:text-accent"
                >
                  Open After-Action Review
                </button>
              )}
              <button
                onClick={() => {
                  onClose();
                  // Back to the list so the archive section (and its After-
                  // Action Review button) is immediately visible.
                  backToList();
                }}
                disabled={!finished}
                className="rounded border border-white/12 px-4 py-1.5 text-[11px] text-white/60 transition hover:border-white/25 hover:text-white disabled:opacity-40"
              >
                {finished ? 'Done' : 'Working…'}
              </button>
            </div>
          </>
        )}
      </div>
    </div>
  );

  return createPortal(modal, document.body);
}
