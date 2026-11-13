import { create } from 'zustand';
import { persist } from 'zustand/middleware';
import type { ServiceLevel, ServiceStatus } from '../types';

// Which provider status pages the top-bar chip shows. Persisted per browser,
// like the alert-popup switches. `null` means "the defaults", so a browser
// that never chose keeps following this list if it changes.
export const DEFAULT_SERVICES = [
  'm365',
  'azure',
  'aws',
  'gworkspace',
  'cloudflare',
  'zoom',
  'smartsheet',
  'shopify',
];

interface ServiceStatusState {
  selected: string[] | null;
  toggle: (id: string) => void;
  reset: () => void;
}

export const useServiceStatusStore = create<ServiceStatusState>()(
  persist(
    (set) => ({
      selected: null,
      toggle: (id) =>
        set((s) => {
          const cur = s.selected ?? DEFAULT_SERVICES;
          return { selected: cur.includes(id) ? cur.filter((x) => x !== id) : [...cur, id] };
        }),
      reset: () => set({ selected: null }),
    }),
    { name: 'gsoc-service-status', version: 1 }
  )
);

const RANK: Record<ServiceLevel, number> = { ok: 0, unknown: 1, minor: 2, major: 3 };

export interface ChipSummary {
  /** Chosen services in catalog order (ids the server no longer lists are dropped). */
  shown: ServiceStatus[];
  /** Chosen services with an incident, worst first. */
  issues: ServiceStatus[];
  level: ServiceLevel;
  /** Top line of the chip. */
  headline: string;
  /** Small label under it. */
  label: string;
}

/** What the collapsed chip says about the chosen services. */
export function summarizeChip(services: ServiceStatus[], selected: readonly string[]): ChipSummary {
  const shown = services.filter((s) => selected.includes(s.id));
  const issues = shown
    .filter((s) => s.level === 'minor' || s.level === 'major')
    .sort((a, b) => RANK[b.level] - RANK[a.level]);
  if (shown.length === 0) return { shown, issues, level: 'unknown', headline: '—', label: 'services' };
  if (issues.length > 0) {
    const more = issues.length > 1 ? ` +${issues.length - 1}` : '';
    return {
      shown,
      issues,
      level: issues[0].level,
      headline: `${issues[0].name}${more}`,
      label: issues[0].level === 'major' ? 'outage' : 'degraded',
    };
  }
  // No incident among them, but a page we could not read is not "up".
  const unknown = shown.filter((s) => s.level === 'unknown').length;
  return {
    shown,
    issues,
    level: unknown === shown.length ? 'unknown' : 'ok',
    headline: `${shown.length - unknown}/${shown.length}`,
    label: 'services up',
  };
}
