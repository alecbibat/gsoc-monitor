// ── Property risk report: types and fixed analysis frame ────────────────────
// (roadmap Track 3). The thresholds these types carry are defined in
// docs/RISK-REPORT-MATRIX.md — keep the two in sync.

export type RiskLevel = 'low' | 'guarded' | 'elevated' | 'high' | 'critical';

export const RISK_LEVELS: Record<RiskLevel, { label: string; color: string; rank: number }> = {
  low:      { label: 'Low',      color: '#22c55e', rank: 0 },
  guarded:  { label: 'Guarded',  color: '#a3e635', rank: 1 },
  elevated: { label: 'Elevated', color: '#eab308', rank: 2 },
  high:     { label: 'High',     color: '#f97316', rank: 3 },
  critical: { label: 'Critical', color: '#ef4444', rank: 4 },
};

export const maxLevel = (a: RiskLevel, b: RiskLevel): RiskLevel =>
  RISK_LEVELS[a].rank >= RISK_LEVELS[b].rank ? a : b;

/** Bump one step toward critical (used by FRP/acreage escalators). */
export const bumpLevel = (l: RiskLevel): RiskLevel => {
  const order: RiskLevel[] = ['low', 'guarded', 'elevated', 'high', 'critical'];
  return order[Math.min(order.indexOf(l) + 1, order.length - 1)];
};

// Fixed analysis rings — never zoom-driven, so a report is reproducible.
export interface RingDef {
  id: 'immediate' | 'local' | 'area' | 'regional';
  miles: number;
  label: string;
  meaning: string;
}

export const RISK_RINGS: RingDef[] = [
  { id: 'immediate', miles: 1,   label: '1 mi',   meaning: 'Evacuation / direct impact' },
  { id: 'local',     miles: 5,   label: '5 mi',   meaning: 'Mutual aid · staging · access' },
  { id: 'area',      miles: 25,  label: '25 mi',  meaning: 'Supply · staff commute' },
  { id: 'regional',  miles: 100, label: '100 mi', meaning: 'Logistics · alternate lodging' },
];

// ── Assembled report data ────────────────────────────────────────────────────

export interface RiskTarget {
  key: string;
  name: string;
  lat: number;
  lon: number;
  groupName?: string;
  groupIcon?: string;
}

export interface SectionResult {
  id: string;
  title: string;
  level: RiskLevel;
  drivers: string[];
  /** Set when the input feed is unavailable — shown honestly, never as Low. */
  unavailable?: string;
}

export interface HotspotHit {
  lat: number;
  lon: number;
  distanceMi: number;
  frp?: number;
  satellite?: string;
  ageHours?: number;
}

export interface NamedFireHit {
  name: string;
  distanceMi: number;
  acres?: number;
  containmentPct?: number;
}

export interface AlertHit {
  event: string;
  severity?: string;
  expires?: string;
}

export interface RingCount {
  ring: RingDef;
  hotspots: number;
  namedFires: number;
}

export interface WildfireReportData {
  target: RiskTarget;
  generatedAt: string;
  overall: { level: RiskLevel; drivers: string[] };
  sections: SectionResult[];
  ringCounts: RingCount[];
  hotspots: HotspotHit[];      // nearest first, capped
  namedFires: NamedFireHit[];  // nearest first, capped
  alerts: AlertHit[];          // fire-relevant alerts containing the site
  outlook: { today?: string; unavailable?: string };
  fuel: {
    score?: number;
    level?: string;
    topModels?: { code: string; name: string; pct: number }[];
    unavailable?: string;
  };
  wind: {
    nowMph?: number;
    gustMph?: number;
    dirDeg?: number;
    peak48Mph?: number;
    peakGust48Mph?: number;
    unavailable?: string;
  };
  sources: { name: string; detail: string }[];
  gaps: string[];
}
