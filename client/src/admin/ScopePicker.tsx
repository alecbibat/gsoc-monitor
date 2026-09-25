import { useId } from 'react';
import { INCIDENT_CATEGORIES, INCIDENT_TYPES, incidentTypesInCategory } from '../crisis/taxonomy';
import { TEMPLATE_PROPERTIES } from '../crisis/templates/scopeLabels';
import type { TemplateScope } from '../crisis/templates/model';

// ── Scope picker ─────────────────────────────────────────────────────────────
// Incident type × property, either of which may be "any". Used to start a new
// template scope, to pick what the editors' previews resolve for, and by the
// IAP library (IapSection) to say which incidents a document serves.

export interface ScopePickerProps {
  value: TemplateScope;
  onChange: (s: TemplateScope) => void;
  typeLabel?: string;
  propertyLabel?: string;
  disabled?: boolean;
  /** Text of the "any type" option (default "All incident types"). */
  anyTypeText?: string;
  /** Text of the "any property" option (default "All properties"). */
  anyPropertyText?: string;
}

const selectCls =
  'w-full rounded border border-white/10 bg-ink-900 px-2.5 py-1.5 text-[12px] text-white/80 outline-none transition hover:border-white/20 focus:border-accent/40 disabled:opacity-40';

export function ScopePicker({
  value, onChange, typeLabel = 'Incident type', propertyLabel = 'Property', disabled = false,
  anyTypeText = 'All incident types', anyPropertyText = 'All properties',
}: ScopePickerProps) {
  const typeId = useId();
  const propId = useId();
  // A scope saved under an id this build no longer lists still has to show
  // (and round-trip) rather than silently displaying "All …".
  const unknownType = value.incidentType !== null && !INCIDENT_TYPES.some((t) => t.id === value.incidentType)
    ? value.incidentType : null;
  const unknownProperty = value.propertyId !== null && !TEMPLATE_PROPERTIES.some((p) => p.id === value.propertyId)
    ? value.propertyId : null;

  return (
    <div className="grid gap-2 sm:grid-cols-2">
      <div className="min-w-0">
        <label htmlFor={typeId} className="mb-1 block text-[9px] font-bold uppercase tracking-[0.14em] text-white/35">
          {typeLabel}
        </label>
        <select
          id={typeId}
          value={value.incidentType ?? ''}
          disabled={disabled}
          onChange={(e) => onChange({ ...value, incidentType: e.target.value || null })}
          className={selectCls}
        >
          <option value="">{anyTypeText}</option>
          {INCIDENT_CATEGORIES.map((c) => {
            const types = incidentTypesInCategory(c.id);
            if (types.length === 0) return null;
            return (
              <optgroup key={c.id} label={c.label}>
                {types.map((t) => <option key={t.id} value={t.id}>{t.icon} {t.label}</option>)}
              </optgroup>
            );
          })}
          {unknownType && <option value={unknownType}>{unknownType} (no longer listed)</option>}
        </select>
      </div>
      <div className="min-w-0">
        <label htmlFor={propId} className="mb-1 block text-[9px] font-bold uppercase tracking-[0.14em] text-white/35">
          {propertyLabel}
        </label>
        <select
          id={propId}
          value={value.propertyId ?? ''}
          disabled={disabled}
          onChange={(e) => onChange({ ...value, propertyId: e.target.value || null })}
          className={selectCls}
        >
          <option value="">{anyPropertyText}</option>
          {TEMPLATE_PROPERTIES.map((p) => <option key={p.id} value={p.id}>{p.icon} {p.name}</option>)}
          {unknownProperty && <option value={unknownProperty}>{unknownProperty} (no longer listed)</option>}
        </select>
      </div>
    </div>
  );
}
