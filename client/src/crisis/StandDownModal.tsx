import { useEffect, useState } from 'react';
import { createPortal } from 'react-dom';
import { useCrisisStore, type Incident } from './crisisStore';
import { publishShareSnapshotsAndWait } from './publishSnapshot';

// ── Stand-down checklist (roadmap F3) ────────────────────────────────────────
// Stand-down is an orchestrated sequence, not a status write:
//   1. push the final (Closed) snapshot to every active share link, so
//      viewers see the conclusion instead of a stale ACTIVE page;
//   2. revoke all share links;
//   3. release open ICS assignments, stamp closed-by/reason, log the event,
//      archive (all inside standDownIncident);
// the archive card's PDF report is the AAR draft. Closure notifications to
// link viewers arrive with W4's access log.

interface StepState {
  label: string;
  status: 'pending' | 'running' | 'done' | 'failed';
  detail?: string;
}

export function StandDownModal({ incident, onClose }: { incident: Incident; onClose: () => void }) {
  const standDownIncident = useCrisisStore((s) => s.standDownIncident);
  const deactivateShareLink = useCrisisStore((s) => s.deactivateShareLink);

  const activeLinks = (incident.shareLinks ?? []).filter((l) => l.active);
  const openAssignments = incident.assignments.filter((a) => !a.endedAt).length;

  const [reason, setReason] = useState('');
  const [busy, setBusy] = useState(false);
  const [steps, setSteps] = useState<StepState[] | null>(null);

  useEffect(() => {
    const handler = (e: KeyboardEvent) => { if (e.key === 'Escape' && !busy) onClose(); };
    window.addEventListener('keydown', handler);
    return () => window.removeEventListener('keydown', handler);
  }, [busy, onClose]);

  const run = async () => {
    setBusy(true);
    const now = new Date().toISOString();
    const finalInc: Incident = { ...incident, incidentStatus: 'closed', archivedAt: now };

    const plan: StepState[] = [
      { label: `Publish final snapshot to ${activeLinks.length} share link${activeLinks.length === 1 ? '' : 's'}`, status: 'pending' },
      { label: `Revoke ${activeLinks.length} share link${activeLinks.length === 1 ? '' : 's'}`, status: 'pending' },
      { label: `Release ${openAssignments} open ICS assignment${openAssignments === 1 ? '' : 's'} · mark Closed · archive`, status: 'pending' },
    ];
    const update = (i: number, patch: Partial<StepState>) =>
      setSteps((s) => s!.map((st, idx) => (idx === i ? { ...st, ...patch } : st)));
    setSteps(plan);

    // 1. Final snapshot first — after revocation the share PATCH is rejected.
    update(0, { status: 'running' });
    if (activeLinks.length === 0) {
      update(0, { status: 'done', detail: 'no active links' });
    } else {
      const ok = await publishShareSnapshotsAndWait(finalInc);
      update(0, { status: ok ? 'done' : 'failed', detail: ok ? undefined : 'some viewers may see the pre-closure state' });
    }

    // 2. Revoke every active link. Failures are reported but don't block the
    // stand-down — a failed link keeps serving the final Closed snapshot.
    update(1, { status: 'running' });
    const failed: number[] = [];
    for (let i = 0; i < activeLinks.length; i++) {
      try {
        const res = await fetch(`/api/crisis/share/${activeLinks[i].token}`, { method: 'DELETE' });
        if (!res.ok) throw new Error(String(res.status));
        deactivateShareLink(activeLinks[i].token);
      } catch {
        failed.push(i + 1);
      }
    }
    update(1, {
      status: failed.length ? 'failed' : 'done',
      detail: activeLinks.length === 0 ? 'no active links'
        : failed.length ? `link ${failed.join(', ')} could not be revoked — it keeps serving the closed snapshot` : undefined,
    });

    // 3. Close out the incident itself.
    update(2, { status: 'running' });
    standDownIncident(incident.id, reason);
    update(2, { status: 'done' });

    setBusy(false);
  };

  const finished = steps !== null && steps.every((s) => s.status === 'done' || s.status === 'failed');

  const modal = (
    <div className="fixed inset-0 z-[2700] flex items-center justify-center bg-black/60 p-4" onClick={() => { if (!busy) onClose(); }}>
      <div
        className="w-full max-w-md rounded-xl border border-amber-500/25 bg-ink-950 p-5 shadow-2xl"
        onClick={(e) => e.stopPropagation()}
      >
        <h3 className="text-[15px] font-semibold text-white/90">Stand Down Incident</h3>
        <p className="mt-1 text-[11px] text-white/45">
          {incident.incidentName || 'Untitled Incident'} — this concludes the incident. The archived
          record is frozen (reopen to edit) and the PDF report becomes available in the Archive.
        </p>

        {steps === null ? (
          <>
            <ul className="mt-4 space-y-1.5 text-[11px] text-white/60">
              <li>· Publish the final <span className="text-green-400/90 font-semibold">Closed</span> state to {activeLinks.length} active share link{activeLinks.length === 1 ? '' : 's'}</li>
              <li>· Revoke {activeLinks.length === 0 ? 'share links (none active)' : `all ${activeLinks.length} share link${activeLinks.length === 1 ? '' : 's'}`}</li>
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
                className="rounded border border-amber-500/40 bg-amber-500/12 px-4 py-1.5 text-[11px] font-semibold text-amber-300 transition hover:border-amber-500/60 hover:bg-amber-500/20"
              >
                Stand Down
              </button>
            </div>
          </>
        ) : (
          <>
            <ul className="mt-4 space-y-2">
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
            <div className="mt-4 flex justify-end">
              <button
                onClick={onClose}
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
