import { useActiveIncident } from '../crisisStore';
import { checklistTemplateFor } from '../checklistTemplate';
import { toggleChecklistItem } from '../checklistSync';
import { ChecklistBoard } from '../ChecklistBoard';

// ── Checklists tab (editor) ──────────────────────────────────────────────────
// The operator-side ICS role checklists. Every toggle records who and when
// (server-stamped) and shows up live on the share page's Checklists tab —
// and share-link viewers' toggles land here the same way.

export function ChecklistsTab() {
  const inc = useActiveIncident();
  if (!inc) return null;

  const template = checklistTemplateFor(inc.incidentType);
  const frozen = !!inc.archivedAt;

  return (
    <div className="mx-auto max-w-3xl">
      <div className="mb-3 flex flex-wrap items-baseline gap-x-3 gap-y-0.5">
        <h3 className="text-[13px] font-bold uppercase tracking-[0.14em] text-white/65">ICS Role Checklists</h3>
        <span className="text-[11px] text-white/40">
          {frozen
            ? 'Archived incident — the checklist record is frozen'
            : 'Check items off as they are completed — each toggle is timestamped and visible on the share link'}
        </span>
      </div>
      <ChecklistBoard
        template={template}
        state={inc.checklists ?? {}}
        onToggle={(itemId, checked) => toggleChecklistItem(inc, itemId, checked)}
        disabled={frozen}
      />
    </div>
  );
}
