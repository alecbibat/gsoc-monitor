import type { WidgetId } from '../types';

// Launcher-facing widget metadata, kept free of component imports so the
// eagerly-loaded WidgetLauncher doesn't drag every widget into the entry chunk.
// The renderers live in registry.tsx, which only the lazy PanelContent imports.
export interface WidgetMeta {
  id: WidgetId;
  title: string;
  subtitle?: string;
  label: string; // launcher button text
  glyph: string; // small icon for the launcher button
  accentClass: string;
}

export const WIDGET_META: WidgetMeta[] = [
  {
    id: 'proximity',
    title: 'Property Watch',
    subtitle: 'Hazards near your locations',
    label: 'Watch',
    glyph: '🛡',
    accentClass: 'border-accent-ok/40',
  },
  {
    id: 'news-feed',
    title: 'Breaking News',
    subtitle: 'GDELT · live feed',
    label: 'News',
    glyph: '📡',
    accentClass: 'border-sky-500/40',
  },
  {
    id: 'intel-feed',
    title: 'Intel Feed',
    subtitle: 'Scanner · crime · news · social',
    label: 'Intel',
    glyph: '🛰',
    accentClass: 'border-cyan-500/40',
  },
];
