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
  /**
   * Count framing shown beside/instead of the level chip when the section is
   * really answering "how many / none" (e.g. alerts: "None active").
   */
  countLabel?: string;
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
  lat: number;
  lon: number;
  distanceMi: number;
  acres?: number;
  containmentPct?: number;
  /** WFIGS record last-modified (epoch ms) — staleness context. */
  updatedAt?: number;
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

/** One day of the site PSA's outlook, display-ready (color from outlookStyle). */
export interface OutlookDayCell {
  date: string | null;
  label: string;
  hex: string;
  /** Significant fire potential flag (Critical / Ignition). */
  sig: boolean;
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
  outlook: {
    today?: string;
    unavailable?: string;
    /** Today-forward day cells for the site PSA — aligned with maps.outlookDays. */
    days?: OutlookDayCell[];
  };
  smoke: {
    /** HMS analysis date (ISO) the plumes came from. */
    analysisDate?: string;
    /** GIBS mosaic date rendered under the smoke map. */
    imageryDate?: string;
    plumeCount?: number;
    densityAtSite?: 'Light' | 'Medium' | 'Heavy' | null;
    unavailable?: string;
  };
  lightning: {
    strikes25mi?: number;
    strikes100mi?: number;
    /** Server-side history coverage in minutes — may be < the 24 h window. */
    coverageMin?: number;
    unavailable?: string;
  };
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

  // ── Visual layer ───────────────────────────────────────────────────────────
  /** Data-URL map snapshots; null = that snapshot failed to render. */
  maps: {
    exposure: string | null;   // rings + hotspots + named fires
    alerts: string | null;     // alert polygons at the site (null when no alerts)
    fuel: string | null;       // LANDFIRE fuel raster, 3 mi ring
    qpf24: string | null;      // WPC precip accumulation windows
    qpf48: string | null;
    qpf72: string | null;
    /** Regional outlook maps aligned with outlook.days ([0] = today, larger). */
    outlookDays: (string | null)[];
    smoke: string | null;      // GIBS true-color satellite + HMS smoke plumes
    lightning: string | null;  // age-tinted strikes, past 24 h
  };
  /** 48 h hourly wind window for the chart (mph, "from" bearings). */
  windHourly: { times: string[]; speedMph: number[]; gustMph: number[]; dirDeg: number[] } | null;
  /** 10-day daily forecast (display-ready units) for the forecast strip. */
  forecastDaily: {
    days: {
      date: string;
      code: number;
      tMaxF: number;
      tMinF: number;
      precipIn: number;
      precipProbPct: number;
      windMaxMph: number;
      gustMaxMph: number;
    }[];
  } | { unavailable: string };
}
