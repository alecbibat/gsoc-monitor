import type { ComponentType } from 'react';
import type { LayerId } from '../types';
import { RadarLegend, RadarLegendCompact } from './radar/RadarLegend';
import { PrecipLegend, PrecipLegendCompact } from './precip/PrecipLegend';
import { LightningLegend, LightningLegendCompact } from './lightning/LightningLegend';
import { FireOutlookLegend, FireOutlookLegendCompact } from './fireOutlook/FireOutlookLegend';
import { FuelLegend, FuelLegendCompact } from './fuel/FuelLegend';
import { TimeZonesLegend, TimeZonesLegendCompact } from './timezones/TimeZonesLegend';
import { NgfsLegend, NgfsLegendCompact } from './ngfs/NgfsLegend';
import { WarnLegend, WarnLegendCompact } from './warn/WarnLegend';

export interface LayerLegend {
  id: LayerId;
  title: string;
  /** What the compact key's labels measure (a unit, "strike age"), shown small beside the title. */
  hint?: string;
  /** The full key: notes, full wording. */
  Legend: ComponentType;
  /** The same key in one line (see legendKeys.tsx). */
  Compact: ComponentType;
}

// Layers whose map symbology needs a color key. Legends live on the map, not in
// the layer menu: the operator app shows them in one panel bottom-right
// (MapLegends) — a row per active layer with its compact key, expandable to
// the full one — and the share page lists the full keys under the globe
// (CrisisShareGlobe). Every legend here must be store-free/static so it
// renders on both surfaces.
export const LAYER_LEGENDS: LayerLegend[] = [
  { id: 'warn', title: 'Wireless Emergency Alerts', Legend: WarnLegend, Compact: WarnLegendCompact },
  { id: 'radar', title: 'Precipitation Radar', Legend: RadarLegend, Compact: RadarLegendCompact },
  { id: 'precip', title: 'Precip Forecast (WPC)', hint: 'inches', Legend: PrecipLegend, Compact: PrecipLegendCompact },
  { id: 'lightning', title: 'Lightning', hint: 'strike age', Legend: LightningLegend, Compact: LightningLegendCompact },
  { id: 'ngfs', title: 'NGFS Heat Detections', hint: 'last detected', Legend: NgfsLegend, Compact: NgfsLegendCompact },
  { id: 'fireOutlook', title: '7-Day Fire Potential', Legend: FireOutlookLegend, Compact: FireOutlookLegendCompact },
  { id: 'fuel', title: 'Fuel Models (LANDFIRE)', hint: 'groups', Legend: FuelLegend, Compact: FuelLegendCompact },
  { id: 'timezones', title: 'Time Zones', Legend: TimeZonesLegend, Compact: TimeZonesLegendCompact },
];
