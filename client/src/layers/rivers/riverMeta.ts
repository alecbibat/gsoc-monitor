import type { FloodCat } from '../../types';

// Flood-tier visual + semantic metadata, shared by the layer (point colors),
// the sidebar (filter chips) and the detail panel (badges, threshold lines).
export interface CatMeta {
  label: string;
  short: string;
  color: string; // hex, used for SVG/CSS and converted to Cesium.Color
  size: number; // base point pixel size
  sev: number; // severity rank (0 = non-flood)
}

export const CAT: Record<FloodCat, CatMeta> = {
  major: { label: 'Major Flood', short: 'Major', color: '#b026ff', size: 14, sev: 4 },
  moderate: { label: 'Moderate Flood', short: 'Moderate', color: '#ff3535', size: 12, sev: 3 },
  minor: { label: 'Minor Flood', short: 'Minor', color: '#ff8c1a', size: 11, sev: 2 },
  action: { label: 'Near Flood (Action)', short: 'Action', color: '#ffd23f', size: 10, sev: 1 },
  normal: { label: 'Normal', short: 'Normal', color: '#36c5f0', size: 6, sev: 0 },
  low: { label: 'Low Water', short: 'Low', color: '#c79a6b', size: 6, sev: 0 },
  none: { label: 'No flood thresholds', short: 'Monitored', color: '#8090a6', size: 5, sev: 0 },
};

export function catLabel(c: FloodCat): string {
  return CAT[c]?.label ?? c;
}
export function catColor(c: FloodCat): string {
  return CAT[c]?.color ?? '#8090a6';
}
export function catSev(c: FloodCat | null | undefined): number {
  return c ? CAT[c]?.sev ?? 0 : 0;
}

export type RiverFilter = 'all' | 'action' | 'minor' | 'moderate' | 'major';

// Minimum observed severity a gauge must reach to show under each filter.
export const FILTER_MIN_SEV: Record<RiverFilter, number> = {
  all: 0,
  action: 1,
  minor: 2,
  moderate: 3,
  major: 4,
};

export const RIVER_FILTERS: { value: RiverFilter; label: string }[] = [
  { value: 'all', label: 'All' },
  { value: 'action', label: 'Action+' },
  { value: 'minor', label: 'Minor+' },
  { value: 'moderate', label: 'Mod+' },
  { value: 'major', label: 'Major' },
];
