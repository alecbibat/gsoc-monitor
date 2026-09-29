import type { FloodCat, FemaZoneFeature, FloodDischargeResponse, RiverCrest, RiverSeriesPoint, RiverThreshold } from '../types';
import type { RingDef, RiskLevel, RiskTarget, SectionResult, WildfireReportData } from './riskTypes';

// ── Property flood risk report: types ────────────────────────────────────────
// Same frame as the wildfire report (fixed rings, five levels, fail-honest
// sections, worst-section overall). Thresholds live in the Flood table of
// docs/RISK-REPORT-MATRIX.md — keep the two in sync.

/** WPC Excessive Rainfall Outlook category at a point: 0 = outside every risk area. */
export type EroCategory = 0 | 1 | 2 | 3 | 4;

export const ERO_META: Record<EroCategory, { label: string; short: string; prob: string; hex: string }> = {
  0: { label: 'No risk area', short: 'None', prob: '<5%', hex: '#4b5563' },
  1: { label: 'Marginal', short: 'MRGL', prob: '≥5%', hex: '#22c55e' },
  2: { label: 'Slight', short: 'SLGT', prob: '≥15%', hex: '#facc15' },
  3: { label: 'Moderate', short: 'MDT', prob: '≥40%', hex: '#ef4444' },
  4: { label: 'High', short: 'HIGH', prob: '≥70%', hex: '#d946ef' },
};

/** One ERO day at the property. */
export interface EroDay {
  /** 1–5 = WPC Day 1 … Day 5. */
  day: number;
  /** Property-local date the day's period starts on (display only; null when unknown). */
  date: string | null;
  category: EroCategory;
  /**
   * When the day's 12Z–12Z period starts (epoch ms), from the product when the
   * site is inside a risk area, else from WPC's issuance cycle. Overnight the
   * coming daytime is "Day 2" — this lets the rules weigh it like Day 1.
   */
  startMs?: number | null;
}

/** One ERO risk polygon (for the Day 1 regional map). */
export interface EroPolygon {
  category: Exclude<EroCategory, 0>;
  rings: number[][][];
}

/** A flood-family NWS alert whose area contains the property. */
export interface FloodAlertHit {
  event: string;
  severity?: string;
  expires?: string;
  headline?: string;
  /** Level this alert contributes (matrix rule). */
  level: RiskLevel;
  /** Extra framing: 'Flash Flood Emergency', 'Damage threat: Considerable', 'Observed'. */
  tags: string[];
  /** The NWS "* WHAT… * WHERE… * WHEN… * IMPACTS…" bullets, when the text has them. */
  bullets: { label: string; text: string }[];
  /**
   * Matched only by the property's county outline (NWS's own point lookup was
   * unavailable) — a zone-based product may not cover the site itself.
   */
  countyResolved?: boolean;
}

/** An NWPS forecast point near the property (from the bulk national list). */
export interface GaugeHit {
  lid: string;
  name: string;
  state: string;
  lat: number;
  lon: number;
  distanceMi: number;
  /** Observed flood category. */
  cat: FloodCat;
  /** NWS forecast category (null = no current forecast at this point). */
  fcat: FloodCat | null;
  stage: number | null;
  unit: string;
  isFlow: boolean;
  /**
   * Not reporting: NWPS marks the observation out of service or stale. `cat`
   * is then 'none' (no current reading) and only `fcat` says anything.
   */
  offline?: 'out_of_service' | 'stale';
  /** Last observation time for an offline gauge (ISO), when known. */
  obsTime?: string | null;
}

/** Per-gauge forecast detail for the report's hydrograph cards. */
export interface GaugeDetailView {
  lid: string;
  name: string;
  distanceMi: number;
  primaryName: string;
  unit: string;
  observed: { value: number | null; cat: FloodCat | null; time: string | null };
  crest: { value: number | null; cat: FloodCat | null; time: string | null };
  trend: 'rising' | 'falling' | 'steady' | null;
  thresholds: RiverThreshold[];
  observedSeries: RiverSeriesPoint[];
  forecastSeries: RiverSeriesPoint[];
  /** NWS flood-impact statements near the current/forecast stage. */
  impacts: { stage: number; statement: string }[];
  recordCrest: RiverCrest | null;
  forecastReliability: string | null;
  inServiceMsg: string | null;
  /** The point has stopped reporting: its "observed" values are its last reading, not now. */
  offline?: 'out_of_service' | 'stale';
  obsTime?: string | null;
}

export interface FloodRingCount {
  ring: RingDef;
  /** NWPS forecast points inside the ring. */
  gauges: number;
  /** Observed at action stage (near flood). */
  action: number;
  /** Observed minor flood or worse. */
  flooding: number;
  /** NWS forecast minor flood or worse — dark gauges included (a forecast needs no live reading). */
  forecastFlooding: number;
  /** Forecast points in the ring that have stopped reporting (not in `gauges`). */
  offline: number;
}

/** FEMA zone at the property, display-ready. */
export interface FemaSiteZone extends FemaZoneFeature {
  /** Plain-English zone meaning ("1%-annual-chance floodplain (Zone AE)"). */
  label: string;
  floodway: boolean;
  /** V/VE: coastal high-hazard area (wave action). */
  coastal: boolean;
  bfeFt: number | null;
  depthFt: number | null;
  datum: string | null;
}

export interface FloodReportData {
  hazard: 'flood';
  target: RiskTarget;
  generatedAt: string;
  /** The property's local calendar date when the report was assembled. */
  localToday: string;
  overall: { level: RiskLevel; drivers: string[] };
  sections: SectionResult[];
  ringCounts: FloodRingCount[];
  alerts: FloodAlertHit[];
  /** Nearest first, within 100 mi, capped for display. */
  gauges: GaugeHit[];
  gaugeDetails: GaugeDetailView[];
  ero: { days?: EroDay[]; unavailable?: string };
  /**
   * Rain still to come at the property. 'wpc' = WPC QPF (same product as the
   * rainfall map); 'hourly' = the Open-Meteo hourly point forecast summed from
   * the current hour (outside WPC's lower-48 domain, or WPC down); 'daily' =
   * whole calendar days from tomorrow (last resort). Never includes rain that
   * has already fallen — that is `antecedent`.
   */
  rain: {
    in24?: number;
    in48?: number;
    in72?: number;
    in120?: number;
    source?: 'wpc' | 'hourly' | 'daily';
    unavailable?: string;
  };
  /** Modelled rainfall already fallen (Open-Meteo past days) — how wet the ground is. */
  antecedent: {
    past24In?: number;
    past72In?: number;
    past7dIn?: number;
    /** The 7 complete past days + today, oldest first. */
    days?: { date: string; precipIn: number }[];
    unavailable?: string;
  };
  /** Next 48 h hourly rain at the property (local time), for the timing chart. */
  hourlyRain: { times: string[]; precipIn: number[]; probPct: Array<number | null> } | null;
  fema: {
    atSite?: FemaSiteZone | null;
    nearestSfhaMi?: number | null;
    unavailable?: string;
  };
  burnScars: {
    /** This year's fire perimeters (≥100 acres) within 10 mi. */
    within10?: number;
    nearestMi?: number;
    nearestName?: string;
    unavailable?: string;
  };
  /** GloFAS discharge window for the chart (null = feed down or outside the model). */
  discharge: FloodDischargeResponse | null;
  forecastDaily: WildfireReportData['forecastDaily'];
  sources: { name: string; detail: string }[];
  gaps: string[];
  /** Data-URL map snapshots; null = that snapshot failed or does not apply. */
  maps: {
    exposure: string | null; // rings + gauges + flood-alert areas + burn scars
    alerts: string | null;   // alert polygons over the property (null when none)
    fema: string | null;     // NFHL flood zones around the property
    ero: string | null;      // Day 1 excessive-rainfall risk areas, regional
    qpf: string | null;      // WPC 72 h accumulation, regional
  };
}
