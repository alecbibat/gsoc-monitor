// Multi-hazard fusion: one 0–100 threat score per property group, computed
// from the same signals the dashboard cards show. The score is deliberately
// simple and explainable — each contributing hazard adds a weighted amount and
// a human-readable reason, so the briefing can say WHY a property ranks high
// rather than presenting an opaque number.

import type { GroupStatus } from './dashboardData';
import { severityRank } from '../layers/alerts/alertsData';

export interface ThreatAssessment {
  score: number; // 0–100
  reasons: string[]; // top contributors, largest first
}

interface Contribution {
  points: number;
  reason: string;
}

export function assessThreat(s: GroupStatus): ThreatAssessment {
  const parts: Contribution[] = [];

  // NWS alerts — worst severity dominates; extra simultaneous alerts add a little.
  if (s.alerts.length > 0) {
    const worst = s.alerts.reduce((m, a) => Math.max(m, severityRank(a.severity)), 0);
    const base = worst >= 4 ? 45 : worst >= 3 ? 35 : worst >= 2 ? 18 : 8;
    const extra = Math.min(12, (s.alerts.length - 1) * 4);
    parts.push({
      points: base + extra,
      reason:
        s.alerts.length === 1
          ? `${s.alerts[0].event} in effect`
          : `${s.alerts.length} active alerts (worst: ${s.alerts[0].event})`,
    });
  }

  // Wildfire proximity — the strongest physical-hazard signal.
  if (s.nearestFireMi != null) {
    const mi = s.nearestFireMi;
    const points = mi < 10 ? 30 : mi < 25 ? 22 : mi < 50 ? 12 : 6;
    parts.push({ points, reason: `Fire activity ${mi.toFixed(0)} mi away` });
  }

  // Earthquakes — matter when strong and close.
  if (s.nearestQuake) {
    const { mi, mag } = s.nearestQuake;
    const points = mag >= 5 && mi < 50 ? 15 : mag >= 4 ? 8 : 4;
    parts.push({ points, reason: `M${mag.toFixed(1)} earthquake ${mi.toFixed(0)} mi away` });
  }

  // Power outage nearby — infrastructure stress around the property.
  if (s.outage) {
    const points =
      (s.outage.mi < 25 ? 10 : 5) + (s.outage.customers != null && s.outage.customers > 1000 ? 5 : 0);
    parts.push({
      points,
      reason: `${s.outage.utility} outage ${s.outage.mi.toFixed(0)} mi away${
        s.outage.customers ? ` (${s.outage.customers.toLocaleString()} customers)` : ''
      }`,
    });
  }

  // Air quality.
  if (s.aqi) {
    if (s.aqi.value > 150) parts.push({ points: 8, reason: `AQI ${s.aqi.value} (${s.aqi.category})` });
    else if (s.aqi.value > 100) parts.push({ points: 4, reason: `AQI ${s.aqi.value}` });
  }

  // Weather stress — heavy forecast rain or strong current wind.
  if (s.precip7d != null && s.precip7d >= 1.5) {
    parts.push({
      points: s.precip7d >= 3 ? 6 : 3,
      reason: `${s.precip7d.toFixed(1)}" rain forecast over 7 days`,
    });
  }
  if (s.weather && s.weather.windKt >= 25) {
    parts.push({
      points: s.weather.windKt >= 35 ? 6 : 3,
      reason: `${s.weather.windKt} kt winds`,
    });
  }

  parts.sort((a, b) => b.points - a.points);
  const score = Math.min(100, Math.round(parts.reduce((sum, p) => sum + p.points, 0)));
  return { score, reasons: parts.slice(0, 3).map((p) => p.reason) };
}

// Badge color ramp for the score chip.
export function threatColor(score: number): string {
  if (score >= 60) return '#ff3b30';
  if (score >= 35) return '#ff8c1a';
  if (score >= 15) return '#eab308';
  return '#34d399';
}
