import type { ReactNode } from 'react';
import type { WidgetId } from '../types';
import { PentagonPizzaWidget } from './pentagonPizza/PentagonPizzaWidget';
import { NewsWidget } from './news/NewsWidget';

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
];

export const WIDGET_BY_ID: Record<string, WidgetDef> = Object.fromEntries(
  WIDGETS.map((w) => [w.id, w])
);
