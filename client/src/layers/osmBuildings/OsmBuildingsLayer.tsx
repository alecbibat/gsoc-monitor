import * as Cesium from 'cesium';
import { useEffect, useRef } from 'react';
import { useCesiumViewer } from '../../cesium/CesiumContext';
import { useLayersStore } from '../../store/layersStore';
import { useOsmStatus } from './osmStore';

// Free, non-metered 3D from Cesium ion: global OpenStreetMap Buildings (real
// footprints + heights) on top of Cesium World Terrain. Unlike Google's
// photorealistic tiles, these stream from ion's free Community tier rather than
// a per-request billed API, so they're safe to leave on for a monitoring view.
export function OsmBuildingsLayer() {
  const viewer = useCesiumViewer();
  const active = useLayersStore((s) => s.active.osmBuildings);
  const tilesetRef = useRef<Cesium.Cesium3DTileset | null>(null);

  useEffect(() => {
    const setStatus = useOsmStatus.getState().setStatus;

    if (!viewer || !active) {
      if (tilesetRef.current) {
        viewer?.scene.primitives.remove(tilesetRef.current);
        tilesetRef.current = null;
      }
      // Restore the flat ellipsoid so other layers behave as before.
      if (viewer) viewer.terrainProvider = new Cesium.EllipsoidTerrainProvider();
      setStatus({ ready: false, loading: false });
      return;
    }

    let mounted = true;
    setStatus({ loading: true, error: null });

    // World terrain so buildings sit on real elevation and the national-park
    // pins (Grand Canyon, Yellowstone, Glacier) actually read as 3D.
    Cesium.createWorldTerrainAsync()
      .then((tp) => {
        if (mounted) viewer.terrainProvider = tp;
      })
      .catch(() => {
        /* Terrain is a nice-to-have; buildings still load without it. */
      });

    Cesium.createOsmBuildingsAsync()
      .then((tileset) => {
        if (!mounted) {
          tileset.destroy();
          return;
        }
        // Height-based colour gradient: short buildings are dark blue-grey;
        // skyscrapers trend toward a brighter steel blue so they read as tall
        // in the dark monitoring palette without needing real textures.
        tileset.style = new Cesium.Cesium3DTileStyle({
          color: {
            conditions: [
              ["${feature['cesium#estimatedHeight']} >= 200", "color('#6fa8d0', 0.97)"],
              ["${feature['cesium#estimatedHeight']} >= 100", "color('#5580a8', 0.95)"],
              ["${feature['cesium#estimatedHeight']} >= 50",  "color('#456890', 0.92)"],
              ["${feature['cesium#estimatedHeight']} >= 25",  "color('#3a5878', 0.89)"],
              ["${feature['cesium#estimatedHeight']} >= 10",  "color('#304a64', 0.86)"],
              ["true",                                         "color('#263d52', 0.82)"],
            ],
          },
        });
        // Cap GPU memory. Cesium defaults to cacheBytes 512MB + overflow 512MB
        // (~1GB), which the pins screensaver's continuous close-up orbits over
        // dense cities can exhaust on a constrained GPU — losing the WebGL
        // context and blacking out the globe. Bounding it to ~320MB keeps the
        // buildings detailed while leaving the context healthy.
        tileset.cacheBytes = 192 * 1024 * 1024;
        tileset.maximumCacheOverflowBytes = 128 * 1024 * 1024;
        // Coarsen tiles near the horizon during the screensaver's oblique
        // ground-level orbits — far fewer tiles loaded, less memory churn.
        tileset.dynamicScreenSpaceError = true;
        tilesetRef.current = tileset;
        viewer.scene.primitives.add(tileset);
        setStatus({ loading: false, ready: true, error: null });
        viewer.scene.requestRender();
      })
      .catch((err: unknown) => {
        if (!mounted) return;
        const msg = err instanceof Error ? err.message : String(err);
        setStatus({ loading: false, ready: false, error: `3D buildings: ${msg}` });
      });

    return () => {
      mounted = false;
      setStatus({ ready: false });
      if (tilesetRef.current && !tilesetRef.current.isDestroyed()) {
        viewer.scene.primitives.remove(tilesetRef.current);
        tilesetRef.current = null;
      }
      viewer.terrainProvider = new Cesium.EllipsoidTerrainProvider();
    };
  }, [viewer, active]);

  return null;
}
