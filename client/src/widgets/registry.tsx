import type { ReactNode } from 'react';
import type { WidgetId } from '../types';
import { PentagonPizzaWidget } from './pentagonPizza/PentagonPizzaWidget';

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
];

export const WIDGET_BY_ID: Record<string, WidgetDef> = Object.fromEntries(
  WIDGETS.map((w) => [w.id, w])
);
