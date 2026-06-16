import type * as Cesium from 'cesium';
import type { PanelData } from '../panels/panelStore';

/**
 * Cesium only allows one handler per ScreenSpaceEventType, so layers can't each
 * register their own LEFT_CLICK callback without clobbering one another.
 * Instead, every layer stamps the panel it wants opened directly onto the
 * entity it creates, and a single global click handler (in CesiumGlobe) reads
 * it back off whatever entity got picked.
 */
type PanelOpenData = Omit<PanelData, 'x' | 'y' | 'width' | 'height' | 'z' | 'dockedTo'>;

interface EntityWithPanelLink extends Cesium.Entity {
  gsocPanel?: PanelOpenData;
}

export function attachPanelData(entity: Cesium.Entity, data: PanelOpenData) {
  (entity as EntityWithPanelLink).gsocPanel = data;
}

export function getPanelData(entity: Cesium.Entity | undefined): PanelOpenData | undefined {
  return (entity as EntityWithPanelLink | undefined)?.gsocPanel;
}
