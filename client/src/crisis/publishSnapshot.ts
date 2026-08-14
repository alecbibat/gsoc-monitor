import { extractPublicState, type Incident } from './crisisStore';

/**
 * Push an incident's current public state to all of its active share links.
 *
 * Routine edits are published by useAutoPublish (IncidentSync), but that hook
 * only watches the incident that is OPEN in the editor. Two lifecycle
 * transitions happen exactly when the incident stops (or isn't) being open —
 * stand-down atomically navigates back to the list, and reopen can be clicked
 * from the archive card — so without an explicit publish the public share page
 * would keep showing the pre-transition status (e.g. a pinging ACTIVE badge on
 * a stood-down incident) until someone next opened the incident for editing.
 *
 * Fire-and-forget: share updates are best-effort by design, matching
 * useAutoPublish. Full stand-down orchestration (link revocation, frozen
 * snapshots) is roadmap F3/W4 territory — this only keeps the page truthful.
 */
export function publishShareSnapshots(inc: Incident): void {
  void publishShareSnapshotsAndWait(inc);
}

/**
 * Awaitable variant for orchestrated flows (stand-down publishes the final
 * snapshot and must not race the revocation that follows — a PATCH landing
 * after the link is revoked is rejected, leaving viewers on a stale state).
 * Resolves true when every active link accepted the snapshot.
 */
export async function publishShareSnapshotsAndWait(inc: Incident): Promise<boolean> {
  const tokens = (inc.shareLinks ?? []).filter((l) => l.active).map((l) => l.token);
  // Legacy fallback: shareToken set but shareLinks never populated.
  if (tokens.length === 0 && inc.shareToken) tokens.push(inc.shareToken);
  if (tokens.length === 0) return true;

  const body = JSON.stringify(extractPublicState(inc));
  const results = await Promise.allSettled(
    tokens.map((token) =>
      fetch(`/api/crisis/share/${token}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body,
      }).then((res) => {
        if (!res.ok) {
          console.warn(`[crisis] lifecycle publish failed (${res.status}) for share ${token}`);
          throw new Error(String(res.status));
        }
      })
    )
  );
  return results.every((r) => r.status === 'fulfilled');
}
