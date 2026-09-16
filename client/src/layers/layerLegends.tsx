import type { ComponentType } from 'react';
import type { LayerId } from '../types';
import { RadarLegend } from './radar/RadarLegend';
import { PrecipLegend } from './precip/PrecipLegend';
import { LightningLegend } from './lightning/LightningLegend';
import { FireOutlookLegend } from './fireOutlook/FireOutlookLegend';
import { FuelLegend } from './fuel/FuelLegend';

// Layers whose map symbology needs a color key. Legends live on the map, not in
// the layer menu: the operator app floats them bottom-right (MapLegends) and
// the share page lists them under the globe (CrisisShareGlobe). Every legend
// here must be store-free/static so it renders on both surfaces.
export const LAYER_LEGENDS: Array<{ id: LayerId; title: string; Legend: ComponentType }> = [
  { id: 'radar', title: 'Precipitation Radar', Legend: RadarLegend },
  { id: 'precip', title: 'Precip Forecast (WPC)', Legend: PrecipLegend },
  { id: 'lightning', title: 'Lightning', Legend: LightningLegend },
  { id: 'fireOutlook', title: '7-Day Fire Potential', Legend: FireOutlookLegend },
  { id: 'fuel', title: 'Fuel Models (LANDFIRE)', Legend: FuelLegend },
];
