import type { ReactNode } from 'react';
import type { WidgetId } from '../types';
import { NewsWidget } from './news/NewsWidget';
import { ProximityWidget } from './proximity/ProximityWidget';
import { IntelWidget } from './intel/IntelWidget';
import { WIDGET_META, type WidgetMeta } from './widgetMeta';

export interface WidgetDef extends WidgetMeta {
  render: () => ReactNode;
}

// Keyed by WidgetId so a new id without a renderer fails the typecheck.
const RENDER: Record<WidgetId, () => ReactNode> = {
  proximity: () => <ProximityWidget />,
  'news-feed': () => <NewsWidget />,
  'intel-feed': () => <IntelWidget />,
};

export const WIDGETS: WidgetDef[] = WIDGET_META.map((m) => ({ ...m, render: RENDER[m.id] }));

export const WIDGET_BY_ID: Record<string, WidgetDef> = Object.fromEntries(
  WIDGETS.map((w) => [w.id, w])
);
