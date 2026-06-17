import type * as Cesium from 'cesium';
import { create } from 'zustand';

// Info surfaced when the cursor is over a forecast-track point.
export interface ForecastHoverInfo {
  name: string;
  tau: number | null; // forecast hour (0 = current)
  validLabel: string | null; // human-readable valid date/time
  windKt: number | null;
  gustKt: number | null;
  classLabel: string; // e.g. "Category 3 Hurricane"
  category: number | null; // Saffir–Simpson 1–5, or null
  color: string;
}

interface HoverState {
  info: ForecastHoverInfo | null;
  x: number;
  y: number;
  show: (info: ForecastHoverInfo, x: number, y: number) => void;
  hide: () => void;
}

export const useHurricaneHover = create<HoverState>((set) => ({
  info: null,
  x: 0,
  y: 0,
  show: (info, x, y) => set({ info, x, y }),
  // No-op when already hidden so we don't churn renders on every mouse move.
  hide: () => set((s) => (s.info ? { info: null } : s)),
}));

// Forecast metadata is stamped directly onto the Cesium entity (mirroring the
// entityPanelLink pattern) so the single mouse-move handler can read it back off
// whatever point got picked.
interface EntityWithForecast extends Cesium.Entity {
  hurricaneForecast?: ForecastHoverInfo;
}

export function attachForecast(entity: Cesium.Entity, info: ForecastHoverInfo) {
  (entity as EntityWithForecast).hurricaneForecast = info;
}

export function getForecast(entity: Cesium.Entity | undefined): ForecastHoverInfo | undefined {
  return (entity as EntityWithForecast | undefined)?.hurricaneForecast;
}
