import type { ComponentType } from 'react';
import type { LayerId } from '../types';
import { RadarLegend, RadarLegendCompact } from './radar/RadarLegend';
import { RadarPlayer } from './radar/RadarPlayer';
import { PrecipLegend, PrecipLegendCompact } from './precip/PrecipLegend';
import { LightningLegend, LightningLegendCompact } from './lightning/LightningLegend';
import { FireOutlookLegend, FireOutlookLegendCompact } from './fireOutlook/FireOutlookLegend';
import { FuelLegend, FuelLegendCompact } from './fuel/FuelLegend';
import { TimeZonesLegend, TimeZonesLegendCompact } from './timezones/TimeZonesLegend';
import { NgfsLegend, NgfsLegendCompact } from './ngfs/NgfsLegend';
import { WarnLegend, WarnLegendCompact } from './warn/WarnLegend';
import { RoadClosuresLegend, RoadClosuresLegendCompact } from './roads/RoadClosuresLegend';

export interface LayerLegend {
  id: LayerId;
  title: string;
  /** What the compact key's labels measure (a unit, "strike age"), shown small beside the title. */
  hint?: string;
  /** The full key: notes, full wording. */
  Legend: ComponentType;
  /** The same key in one line (see legendKeys.tsx). */
  Compact: ComponentType;
  /**
   * Live controls shown under the key on both surfaces (the radar loop's
   * player). Unlike the keys these read the layer's store, so they render
   * wherever that layer runs.
   */
  Controls?: ComponentType;
}

// Layers whose map symbology needs a color key. Legends live on the map, not in
// the layer menu: the operator app shows them in one panel bottom-right
// (MapLegends) — a row per active layer with its compact key, expandable to
// the full one — and the share page lists the full keys under the globe
// (CrisisShareGlobe). Every key (Legend, Compact) must be store-free/static
// so it renders on both surfaces; Controls are the one store-bound part.
export const LAYER_LEGENDS: LayerLegend[] = [
  { id: 'warn', title: 'Wireless Emergency Alerts', Legend: WarnLegend, Compact: WarnLegendCompact },
  { id: 'roads', title: 'Road Closures (Parks)', Legend: RoadClosuresLegend, Compact: RoadClosuresLegendCompact },
  { id: 'radar', title: 'Precipitation Radar', Legend: RadarLegend, Compact: RadarLegendCompact, Controls: RadarPlayer },
  { id: 'precip', title: 'Precip Forecast (WPC)', hint: 'inches', Legend: PrecipLegend, Compact: PrecipLegendCompact },
  { id: 'lightning', title: 'Lightning', hint: 'strike age', Legend: LightningLegend, Compact: LightningLegendCompact },
  { id: 'ngfs', title: 'NGFS Heat Detections', hint: 'last detected', Legend: NgfsLegend, Compact: NgfsLegendCompact },
  { id: 'fireOutlook', title: '7-Day Fire Potential', Legend: FireOutlookLegend, Compact: FireOutlookLegendCompact },
  { id: 'fuel', title: 'Fuel Models (LANDFIRE)', hint: 'groups', Legend: FuelLegend, Compact: FuelLegendCompact },
  { id: 'timezones', title: 'Time Zones', Legend: TimeZonesLegend, Compact: TimeZonesLegendCompact },
];
