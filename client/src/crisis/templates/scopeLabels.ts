// Display names for template scopes — "General", "🔥 Wildfire", "🏔 Grand
// Canyon", "🔥 Wildfire · 🏔 Grand Canyon". Store-free and share-safe: the
// share page already carries the taxonomy, LOCATION_GROUPS and the fleet ids.

import { incidentTypeDef, INCIDENT_TYPES } from '../taxonomy';
import { LOCATION_GROUPS } from '../../layers/locations/locations';
import { SHIP_GROUP_COLOR, SHIP_GROUP_ICON, SHIP_GROUP_ID, SHIP_GROUP_NAME } from '../incidentShips';
import { scopeRank, type TemplateScope } from './model';

export interface TemplateProperty {
  id: string;
  name: string;
  icon: string;
  color: string;
}

/** Every property a scope can name: the fixed groups, then the fleet. */
export const TEMPLATE_PROPERTIES: TemplateProperty[] = [
  ...LOCATION_GROUPS.map((g) => ({ id: g.id, name: g.name, icon: g.icon, color: g.color })),
  { id: SHIP_GROUP_ID, name: SHIP_GROUP_NAME, icon: SHIP_GROUP_ICON, color: SHIP_GROUP_COLOR },
];

const PROPERTY_BY_ID = new Map(TEMPLATE_PROPERTIES.map((p) => [p.id, p]));

export function propertyDef(id: string | null | undefined): TemplateProperty | null {
  return id ? PROPERTY_BY_ID.get(id) ?? null : null;
}

/** "Wildfire" — or the raw id for a type this build no longer knows. */
export function scopeTypeLabel(typeId: string, withIcon = true): string {
  const known = INCIDENT_TYPES.some((t) => t.id === typeId);
  if (!known) return typeId;
  const t = incidentTypeDef(typeId);
  return withIcon ? `${t.icon} ${t.label}` : t.label;
}

export function scopePropertyLabel(propertyId: string, withIcon = true): string {
  const p = propertyDef(propertyId);
  if (!p) return propertyId;
  return withIcon ? `${p.icon} ${p.name}` : p.name;
}

/** Full scope name: "General (all incidents)", "🔥 Wildfire", "🔥 Wildfire · 🏔 Grand Canyon". */
export function scopeLabel(s: TemplateScope, withIcon = true): string {
  const parts: string[] = [];
  if (s.incidentType) parts.push(scopeTypeLabel(s.incidentType, withIcon));
  if (s.propertyId) parts.push(scopePropertyLabel(s.propertyId, withIcon));
  return parts.length ? parts.join(' · ') : 'General (all incidents)';
}

/** One-line explanation of who sees a scope's content. */
export function scopeAudience(s: TemplateScope): string {
  switch (scopeRank(s)) {
    case 0: return 'Every incident, whatever its type or property';
    case 1: return `Every ${scopeTypeLabel(s.incidentType!, false)} incident, at any property`;
    case 2: return `Every incident at ${scopePropertyLabel(s.propertyId!, false)}, whatever its type`;
    default: return `Only ${scopeTypeLabel(s.incidentType!, false)} incidents at ${scopePropertyLabel(s.propertyId!, false)}`;
  }
}

/** Compact name for chips and summaries: "General", "🔥 Wildfire", "🔥 Wildfire · 🏔 Grand Canyon". */
export function scopeChipLabel(s: TemplateScope, withIcon = true): string {
  return scopeRank(s) === 0 ? 'General' : scopeLabel(s, withIcon);
}
