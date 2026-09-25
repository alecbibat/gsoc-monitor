import { useEffect, useMemo, useRef, useState } from 'react';
import { useActiveIncident, type Incident } from '../crisisStore';
import { useAuthStore } from '../../auth/authStore';
import { preferredChecklistRole } from '../checklistTemplate';
import { toggleChecklistItem } from '../checklistSync';
import { ChecklistBoard } from '../ChecklistBoard';
import { incidentTypeDef } from '../taxonomy';
import { checklistScopes } from '../templates/model';
import { useResolvedChecklist } from '../templates/templatesStore';
import { ScopeSummary } from '../templates/ScopeChips';
import {
  EditTemplatesButton, MissingPropertyHint, TemplatesLoadState, useEnsureTemplatesLoaded,
} from '../templates/editorTabChrome';

// ── Checklists tab (editor) ──────────────────────────────────────────────────
// The operator-side ICS role checklists, resolved for this incident's type and
// property from the admin-edited templates (General → Type → Property → Type +
// Property). Every toggle records who and when (server-stamped) and shows up
// live on the share page's Checklists tab — and share-link viewers' toggles
// land here the same way.

// The role this browser last worked — the fallback when the viewer holds no
// role on the incident's org chart. Storage can throw (private mode, blocked
// site data); the board then simply opens on its first role.
const ROLE_KEY = 'gsoc-checklist-role';

function readRememberedRole(): string | null {
  try { return localStorage.getItem(ROLE_KEY); } catch { return null; }
}

function rememberRole(roleId: string): void {
  try { localStorage.setItem(ROLE_KEY, roleId); } catch { /* storage unavailable */ }
}

/** The last toggle that failed for good (already rolled back by checklistSync). */
interface ToggleFailure {
  itemId: string;
  checked: boolean;
  message: string;
  retryable: boolean;
}

export function ChecklistsTab() {
  const inc = useActiveIncident();
  const user = useAuthStore((s) => s.user);
  // Normalized: a retired type id must resolve like its successor does.
  const typeId = inc ? incidentTypeDef(inc.incidentType).id : null;
  const propertyId = inc?.locationGroupId ?? null;
  const { template, retiredFor, status, error, reload } = useResolvedChecklist(typeId, propertyId);
  useEnsureTemplatesLoaded(status, reload);

  const checklists = inc?.checklists;
  const retired = useMemo(() => retiredFor(checklists ?? {}), [retiredFor, checklists]);
  const scopes = useMemo(() => (template ? checklistScopes(template) : []), [template]);
  const preferredRoleId = useMemo(
    () => (template
      ? preferredChecklistRole(template, {
          assignments: inc?.assignments,
          userName: user?.name,
          userEmail: user?.email,
          remembered: readRememberedRole(),
        })
      : undefined),
    [template, inc?.assignments, user?.name, user?.email]
  );

  // Toggle failures show here, not on the global sync indicator: its "will
  // retry" is kept by the blob/log engines, while a toggle failure is final
  // once reported (the flip is already rolled back). Cleared by the next
  // successful toggle and on switching incidents; a result that lands after
  // the switch belongs to the other incident and is dropped.
  const [chkError, setChkError] = useState<ToggleFailure | null>(null);
  const incId = inc?.id;
  const incIdRef = useRef(incId);
  incIdRef.current = incId;
  useEffect(() => { setChkError(null); }, [incId]);

  const toggle = (target: Incident, itemId: string, checked: boolean) => {
    void toggleChecklistItem(target, itemId, checked).then((r) => {
      if (incIdRef.current !== target.id) return;
      if (r.ok) setChkError(null);
      else if (!r.superseded) setChkError({ itemId, checked, message: r.message, retryable: r.retryable });
    });
  };

  if (!inc) return null;
  const frozen = !!inc.archivedAt;
  const itemText = (itemId: string): string => {
    for (const role of template?.roles ?? []) {
      for (const phase of role.phases) {
        const item = phase.items.find((i) => i.id === itemId);
        if (item) return item.text;
      }
    }
    return itemId;
  };

  return (
    <div className="mx-auto max-w-3xl">
      <div className="mb-3 flex flex-wrap items-start gap-x-3 gap-y-2">
        <div className="min-w-0 flex-1">
          <div className="flex flex-wrap items-baseline gap-x-3 gap-y-0.5">
            <h3 className="text-[13px] font-bold uppercase tracking-[0.14em] text-white/65">ICS Role Checklists</h3>
            <span className="text-[11px] text-white/40">
              {frozen
                ? 'Archived incident — the checklist record is frozen'
                : 'Check items off as they are completed — each toggle is timestamped and visible on the share link'}
            </span>
          </div>
          <ScopeSummary scopes={scopes} className="mt-1.5" />
          {!propertyId && !frozen && template && <MissingPropertyHint what="items" />}
        </div>
        <EditTemplatesButton section="checklists" incidentType={typeId} propertyId={propertyId} />
      </div>
      <TemplatesLoadState what="checklists" status={status} error={error} hasTemplate={!!template} reload={reload} />
      {chkError && (
        <div
          role="alert"
          className="mb-3 flex items-start gap-3 rounded border border-red-400/25 bg-red-400/8 px-3 py-2 text-[11px] text-red-300/90"
        >
          <p className="min-w-0 flex-1">
            Couldn’t save “{itemText(chkError.itemId)}” — {chkError.message}
          </p>
          {chkError.retryable && !frozen && (
            <button
              type="button"
              onClick={() => toggle(inc, chkError.itemId, chkError.checked)}
              className="shrink-0 rounded border border-red-300/30 px-2 py-0.5 text-[10px] text-red-200/90 transition hover:border-red-300/60"
            >
              Retry
            </button>
          )}
        </div>
      )}
      {template && (
        <ChecklistBoard
          // Remount per incident so the board re-opens on the viewer's role there.
          key={inc.id}
          template={template}
          state={checklists ?? {}}
          onToggle={(itemId, checked) => toggle(inc, itemId, checked)}
          disabled={frozen}
          preferredRoleId={preferredRoleId}
          onRoleChange={rememberRole}
          retired={retired}
          footnote={user && !frozen ? `Your checks are recorded as ${user.name}` : undefined}
        />
      )}
    </div>
  );
}
