import { useMeasureStore } from '../measure/measureStore';
import { useFuelZoneStore } from '../fuelzone/fuelZoneStore';
import { useHoverStore } from '../screensaver/hoverStore';
import { useCrisisStore } from '../crisis/crisisStore';

/**
 * True while a map tool owns left-clicks on the globe: the measure tool, the
 * fuel-zone tool, hover mode waiting for an orbit center, or a crisis layer
 * being drawn. Every click-to-identify handler (the globe's entity panels, the
 * rivers layer, the crisis-layer popup, the share page's layer inspector) must
 * bail out while this holds — otherwise a click meant as a vertex also opens a
 * panel, or the multi-feature pick chooser, whose full-screen click catcher
 * then swallows the NEXT vertex. A new cursor-owning tool goes here, once.
 *
 * (crisisStore is already in the main bundle via App and in the share chunk
 * via CrisisMapLayer; activeDrawLayerId is never set on the share page.)
 */
export function mapToolOwnsCursor(): boolean {
  return (
    useMeasureStore.getState().active ||
    useFuelZoneStore.getState().active ||
    useHoverStore.getState().picking ||
    useCrisisStore.getState().activeDrawLayerId !== null
  );
}
