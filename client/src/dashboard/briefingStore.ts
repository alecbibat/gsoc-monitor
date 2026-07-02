import { create } from 'zustand';
import { api } from '../api/client';
import { useDashboardStore } from './dashboardStore';
import { assessThreat } from './threatScore';
import type { BriefingResponse } from '../types';

// AI duty-officer briefing state. The briefing is derived from the dashboard's
// current scan: we fuse it into a compact signals payload, POST it to
// /api/briefing (Claude when the server has a key, deterministic digest
// otherwise), and cache the narrative here. Refreshes are throttled — the
// situation changes on scan cadence, not per render.

const REFRESH_MS = 9 * 60_000;

interface BriefingState {
  headline: string | null;
  narrative: string | null;
  source: 'ai' | 'rules' | null;
  model: string | null;
  updated: number;
  loading: boolean;
  error: string | null;
  refresh: (force?: boolean) => Promise<void>;
}

// Compact, model-friendly snapshot of the current situation.
function buildSignals() {
  const { groups, feed } = useDashboardStore.getState();
  const scored = groups
    .map((g) => ({ g, t: assessThreat(g) }))
    .sort((a, b) => b.t.score - a.t.score);
  return {
    generatedAt: new Date().toISOString(),
    groups: scored.map(({ g, t }) => ({
      name: g.group.name,
      level: g.level,
      score: t.score,
      reasons: t.reasons,
      alerts: g.alerts.slice(0, 3).map((a) => a.event),
      nearestFireMi: g.nearestFireMi != null ? Math.round(g.nearestFireMi) : null,
      outage: g.outage
        ? { utility: g.outage.utility, mi: Math.round(g.outage.mi), customers: g.outage.customers }
        : null,
      weather: g.weather,
      precip7dIn: g.precip7d != null ? Math.round(g.precip7d * 100) / 100 : null,
      aqi: g.aqi?.value ?? null,
    })),
    recentEvents: feed
      .slice(0, 12)
      .map(
        (e) =>
          `[${e.type}] ${e.title} — ${e.groupName}` +
          (e.distanceMi != null ? ` (${e.distanceMi.toFixed(0)} mi)` : '')
      ),
  };
}

let inFlight: Promise<void> | null = null;

export const useBriefingStore = create<BriefingState>((set, get) => ({
  headline: null,
  narrative: null,
  source: null,
  model: null,
  updated: 0,
  loading: false,
  error: null,
  refresh: (force = false) => {
    const { updated } = get();
    if (!force && Date.now() - updated < REFRESH_MS) return Promise.resolve();
    if (inFlight) return inFlight;
    if (useDashboardStore.getState().groups.length === 0) return Promise.resolve();

    set({ loading: true });
    const p = api
      .briefing(buildSignals())
      .then((r: BriefingResponse) => {
        set({
          headline: r.headline,
          narrative: r.narrative,
          source: r.source,
          model: r.model ?? null,
          updated: r.updated,
          loading: false,
          error: null,
        });
      })
      .catch((err: unknown) => {
        set({ loading: false, error: err instanceof Error ? err.message : 'unreachable' });
      })
      .finally(() => {
        inFlight = null;
      });
    inFlight = p;
    return p;
  },
}));
