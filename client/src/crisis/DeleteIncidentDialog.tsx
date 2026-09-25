import { useEffect, useId, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import type { Incident } from './crisisStore';
import { deleteConfirmPhrase, matchesDeletePhrase } from './incidentSummary';

// ── Delete confirmation ──────────────────────────────────────────────────────
// Deleting is permanent: the action log (the incident's legal record),
// assignments, checklists, intake and map layers go, and the server revokes
// its share links. There is no undo and no soft delete. Stand Down is how an
// incident normally ends. So deleting a LIVE incident needs its name typed back
// (or DELETE when it has none). A browser confirm() is one reflexive Enter away,
// and a stray tap on a phone could trigger it. Archived incidents are already
// admin-only (client and server), so they get a plain confirm step here.

export function DeleteIncidentDialog({
  incident,
  requirePhrase,
  onConfirm,
  onClose,
}: {
  incident: Incident;
  /** Ask for the name typed back (live incidents); false = a plain confirm (admin, archived). */
  requirePhrase: boolean;
  onConfirm: () => void;
  onClose: () => void;
}) {
  const [typed, setTyped] = useState('');
  const titleId = useId();
  const descId = useId();
  const cancelRef = useRef<HTMLButtonElement>(null);
  const phrase = deleteConfirmPhrase(incident);
  const ok = !requirePhrase || matchesDeletePhrase(typed, phrase);
  const name = incident.incidentName.trim() || 'Untitled Incident';
  const entries = incident.actionLog.filter((e) => !e.system).length;

  useEffect(() => {
    // Document capture + stopPropagation (as the other crisis modals do): one
    // Esc cancels this dialog only, not the workspace behind it.
    const handler = (e: KeyboardEvent) => {
      if (e.key !== 'Escape') return;
      e.stopPropagation();
      onClose();
    };
    document.addEventListener('keydown', handler, true);
    return () => document.removeEventListener('keydown', handler, true);
  }, [onClose]);

  // Focus goes back to whatever opened the dialog (the Delete button). Read
  // during the first render: by the time effects run, autoFocus has already
  // moved focus into the dialog.
  const [opener] = useState(() => (document.activeElement instanceof HTMLElement ? document.activeElement : null));
  useEffect(() => {
    if (!requirePhrase) cancelRef.current?.focus();
    return () => { if (opener?.isConnected) opener.focus(); };
  }, [opener, requirePhrase]);

  const submit = () => { if (ok) onConfirm(); };

  return createPortal(
    <div className="fixed inset-0 z-[2700] flex items-center justify-center bg-black/60 p-4" onClick={onClose}>
      <div
        role="alertdialog"
        aria-modal="true"
        aria-labelledby={titleId}
        aria-describedby={descId}
        className="w-full max-w-md rounded-xl border border-red-500/30 bg-ink-950 p-5 shadow-2xl"
        onClick={(e) => e.stopPropagation()}
      >
        <h3 id={titleId} className="text-[15px] font-semibold text-white/90">
          Delete {incident.archivedAt ? 'archived ' : ''}incident permanently?
        </h3>
        <div id={descId} className="mt-1.5 space-y-2 text-[11px] leading-relaxed text-white/55">
          <p>
            <span className="font-semibold text-white/80">{name}</span> is deleted for everyone, together with its
            action log ({entries} operator entr{entries === 1 ? 'y' : 'ies'}), org chart assignments, checklists,
            intake answers and map layers. Its share links stop working. <span className="text-red-300/90">This cannot be undone.</span>
          </p>
          {!incident.archivedAt && (
            <p className="text-white/45">
              To conclude an incident, use <span className="text-amber-300/80">Stand Down</span> instead. It keeps the
              record in the Archive for the after-action review.
            </p>
          )}
        </div>

        <form
          className="mt-4"
          onSubmit={(e) => { e.preventDefault(); submit(); }}
        >
          {requirePhrase && (
            <label className="block text-[10px] text-white/45">
              Type <span className="select-all rounded bg-white/10 px-1 font-mono text-white/80">{phrase}</span> to confirm
              <input
                autoFocus
                value={typed}
                onChange={(e) => setTyped(e.target.value)}
                autoComplete="off"
                autoCapitalize="off"
                autoCorrect="off"
                spellCheck={false}
                className="mt-1.5 block w-full rounded border border-white/12 bg-white/6 px-2.5 py-2 text-[13px] text-white/85 outline-none focus:border-red-400/50"
              />
            </label>
          )}
          <div className="mt-4 flex justify-end gap-2">
            <button
              ref={cancelRef}
              type="button"
              onClick={onClose}
              className="rounded border border-white/12 px-3 py-1.5 text-[11px] text-white/60 transition hover:border-white/22 hover:text-white"
            >
              Cancel
            </button>
            <button
              type="submit"
              disabled={!ok}
              className="rounded border border-red-500/45 bg-red-500/15 px-4 py-1.5 text-[11px] font-semibold text-red-300 transition hover:border-red-500/65 hover:bg-red-500/25 disabled:cursor-not-allowed disabled:opacity-35"
            >
              Delete permanently
            </button>
          </div>
        </form>
      </div>
    </div>,
    document.body
  );
}
