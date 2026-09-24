import { useEffect } from 'react';
import { useCesiumViewer } from '../../cesium/CesiumContext';
import { useLayersStore } from '../../store/layersStore';
import { startLightning, type LightningVariant } from './lightningEngine';

// Lightning on the globe: one layer for live and historical strikes alike.
// Every strike is an X that is born white (with a descending bolt when the
// browser's own Blitzortung socket sees it in view), then steps through the
// shared age ramp and expires at 24 h. The last 24 h come from the server's
// always-on collector as a stable sample of the view, so the map is full the
// moment the layer loads. See lightningEngine.ts for how the two sources meet.
//
// variant 'share' is the crisis share page's embedded globe: smaller budgets.
export function LightningLayer({ variant = 'app' }: { variant?: LightningVariant }) {
  const viewer = useCesiumViewer();
  const active = useLayersStore((s) => s.active.lightning);

  useEffect(() => {
    if (!viewer || viewer.isDestroyed() || !active) return;
    // Everything the engine creates it also tears down (socket, polling,
    // timers, RAF, bolt entities, both billboard collections, the store's
    // runtime fields), so StrictMode's mount → unmount → mount is clean.
    return startLightning(viewer, variant);
  }, [viewer, active, variant]);

  return null;
}
