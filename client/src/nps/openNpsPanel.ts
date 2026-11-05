import { usePanelStore } from '../panels/panelStore';
import { WIDGET_META } from '../widgets/widgetMeta';
import { useNpsStore } from './npsStore';

const META = WIDGET_META.find((w) => w.id === 'nps');

/**
 * Open the National Parks panel — the same window its launcher button opens —
 * optionally scrolled to one park's alert or news release.
 */
export function openNpsPanel(parkCode?: string, itemId?: string | null): void {
  if (parkCode) useNpsStore.getState().focusItem(parkCode, itemId ?? null);
  usePanelStore.getState().open({
    id: 'widget-nps',
    kind: 'nps',
    title: META?.title ?? 'National Parks',
    subtitle: META?.subtitle,
    payload: {},
    // A tool opened on purpose, like the launcher's: it survives globe clicks.
    locked: true,
  });
}
