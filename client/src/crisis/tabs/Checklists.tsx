import { useMemo } from 'react';
import { useActiveIncident } from '../crisisStore';
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

  if (!inc) return null;
  const frozen = !!inc.archivedAt;

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
      {template && (
        <ChecklistBoard
          // Remount per incident so the board re-opens on the viewer's role there.
          key={inc.id}
          template={template}
          state={checklists ?? {}}
          onToggle={(itemId, checked) => toggleChecklistItem(inc, itemId, checked)}
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
