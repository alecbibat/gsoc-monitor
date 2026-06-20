import type { ReactNode } from 'react';
import type { WidgetId } from '../types';
import { NewsWidget } from './news/NewsWidget';
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
    id: 'news-feed',
    title: 'Breaking News',
    subtitle: 'GDELT · live feed',
    label: 'News',
    glyph: '📡',
    accentClass: 'border-sky-500/40',
    render: () => <NewsWidget />,
  },
];

export const WIDGET_BY_ID: Record<string, WidgetDef> = Object.fromEntries(
  WIDGETS.map((w) => [w.id, w])
);
