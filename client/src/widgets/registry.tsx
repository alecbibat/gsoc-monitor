import type { ReactNode } from 'react';
import type { WidgetId } from '../types';
import { PentagonPizzaWidget } from './pentagonPizza/PentagonPizzaWidget';
import { NewsWidget } from './news/NewsWidget';
import { FearGreedWidget } from './fearGreed/FearGreedWidget';
import { DefconWidget } from './defcon/DefconWidget';
import { ProximityWidget } from './proximity/ProximityWidget';

export interface WidgetDef {
  id: WidgetId;
  title: string;
  subtitle?: string;
  label: string; // launcher button text
  glyph: string; // small icon for the launcher button
  accentClass: string;
  render: () => ReactNode;
}

export const WIDGETS: WidgetDef[] = [
  {
    id: 'proximity',
    title: 'Property Watch',
    subtitle: 'Hazards near your locations',
    label: 'Watch',
    glyph: '🛡',
    accentClass: 'border-accent-ok/40',
    render: () => <ProximityWidget />,
  },
  {
    id: 'pentagon-pizza',
    title: 'Pentagon Pizza',
    subtitle: 'DOUGHCON monitor',
    label: 'Pizza',
    glyph: '🍕',
    accentClass: 'border-accent-warn/40',
    render: () => <PentagonPizzaWidget />,
  },
  {
    id: 'news-feed',
    title: 'Breaking News',
    subtitle: 'GDELT · live feed',
    label: 'News',
    glyph: '📡',
    accentClass: 'border-sky-500/40',
    render: () => <NewsWidget />,
  },
  {
    id: 'fear-greed',
    title: 'BTC Fear & Greed',
    subtitle: 'Crypto market sentiment',
    label: 'F&G',
    glyph: '₿',
    accentClass: 'border-yellow-400/40',
    render: () => <FearGreedWidget />,
  },
  {
    id: 'defcon',
    title: 'DEFCON Status',
    subtitle: 'Novelty threat gauge',
    label: 'DEFCON',
    glyph: '⚠',
    accentClass: 'border-red-500/40',
    render: () => <DefconWidget />,
  },
];

export const WIDGET_BY_ID: Record<string, WidgetDef> = Object.fromEntries(
  WIDGETS.map((w) => [w.id, w])
);
