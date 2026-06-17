import * as Cesium from 'cesium';
import { useEffect, useRef } from 'react';
import { useCesiumViewer } from '../../cesium/CesiumContext';
import { useLayersStore } from '../../store/layersStore';
import { useEarthStatus } from './earthStore';

// Set VITE_GOOGLE_MAPS_KEY in your .env (locally) and in Heroku Config Vars.
// In the Heroku dashboard the variable must be set BEFORE the build step, as
// Vite bakes VITE_* values into the bundle at build time.
// Required GCP APIs: "Map Tiles API" with 3D Tiles access enabled.
const GOOGLE_KEY = (import.meta as unknown as { env: Record<string, string> }).env
  .VITE_GOOGLE_MAPS_KEY as string | undefined;

export function GoogleEarthLayer() {
  const viewer = useCesiumViewer();
  const active = useLayersStore((s) => s.active.earth3d);
  const tilesetRef = useRef<Cesium.Cesium3DTileset | null>(null);

  useEffect(() => {
    const setStatus = useEarthStatus.getState().setStatus;

    if (!viewer || !active) {
      if (tilesetRef.current) {
        viewer?.scene.primitives.remove(tilesetRef.current);
        tilesetRef.current = null;
      }
      setStatus({ ready: false });
      return;
    }

    if (!GOOGLE_KEY) {
      setStatus({ error: 'Set VITE_GOOGLE_MAPS_KEY to enable', ready: false });
      return;
    }

    let mounted = true;
    setStatus({ loading: true, error: null });

    Cesium.Cesium3DTileset.fromUrl(
      `https://tile.googleapis.com/v1/3dtiles/root.json?key=${GOOGLE_KEY}`,
      {
        showCreditsOnScreen: true,
        // Very high SSE = heavily coarse tiles = ~96% fewer requests vs the
        // default of 16. Buildings are blocky but still recognisably 3D.
        // The OSM Buildings layer is the primary free 3D source; Google tiles
        // are an optional manual toggle — use sparingly to avoid API charges.
        maximumScreenSpaceError: 512,
        preloadWhenHidden: false,
        dynamicScreenSpaceError: true,
      }
    )
      .then((tileset) => {
        if (!mounted) {
          tileset.destroy();
          return;
        }
        tilesetRef.current = tileset;
        viewer.scene.primitives.add(tileset);
        setStatus({ loading: false, error: null, ready: true });
        viewer.scene.requestRender();
      })
      .catch((err: unknown) => {
        if (!mounted) return;
        const msg = err instanceof Error ? err.message : String(err);
        setStatus({ loading: false, error: `3D tiles: ${msg}`, ready: false });
      });

    return () => {
      mounted = false;
      setStatus({ ready: false });
      if (tilesetRef.current && !tilesetRef.current.isDestroyed()) {
        viewer.scene.primitives.remove(tilesetRef.current);
        tilesetRef.current = null;
      }
    };
  }, [viewer, active]);

  return null;
}
