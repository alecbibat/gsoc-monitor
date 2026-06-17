import * as Cesium from 'cesium';
import { useEffect, useRef, useState } from 'react';
import { BASEMAPS } from './basemaps';
import { getPanelData } from './entityPanelLink';
import { useLayersStore } from '../store/layersStore';
import { usePanelStore } from '../panels/panelStore';
import { usePickChooserStore, type PanelOpenData } from '../panels/pickChooserStore';
import { useMeasureStore } from '../measure/measureStore';
import { usePerfStore } from '../perf/perfStore';
import { HOME_VIEW } from './flyTo';

interface Props {
  children?: React.ReactNode;
  onReady?: (viewer: Cesium.Viewer | null) => void;
}

export function CesiumGlobe({ children, onReady }: Props) {
  const containerRef = useRef<HTMLDivElement>(null);
  const [viewer, setViewer] = useState<Cesium.Viewer | null>(null);
  const baseLayerRef = useRef<Cesium.ImageryLayer | null>(null);
  const basemap = useLayersStore((s) => s.basemap);
  const performanceMode = usePerfStore((s) => s.performanceMode);

  useEffect(() => {
    if (!containerRef.current) return;

    const v = new Cesium.Viewer(containerRef.current, {
      baseLayer: false,
      animation: false,
      timeline: false,
      baseLayerPicker: false,
      geocoder: false,
      homeButton: false,
      sceneModePicker: false,
      navigationHelpButton: false,
      fullscreenButton: false,
      infoBox: false,
      selectionIndicator: false,
      shadows: false,
      // alpha:true lets the WebGL canvas be transparent so our CSS star
      // field shows through wherever there's no globe or UI.
      contextOptions: { webgl: { alpha: true } },
    });

    v.scene.requestRenderMode = true;
    v.scene.maximumRenderTimeChange = 1;

    v.scene.globe.enableLighting = true;
    v.scene.globe.baseColor = Cesium.Color.fromCssColorString('#05070a');
    v.scene.globe.depthTestAgainstTerrain = false;
    v.scene.fog.enabled = true;
    v.scene.skyAtmosphere!.hueShift = -0.05;

    // Transparent background so the StarField canvas shows through.
    v.scene.backgroundColor = new Cesium.Color(0, 0, 0, 0);
    // Replace blurry default star-cube-map with nothing; stars come from StarField.
    if (v.scene.skyBox) v.scene.skyBox.show = false;

    v.camera.setView({
      destination: Cesium.Cartesian3.fromDegrees(HOME_VIEW.lon, HOME_VIEW.lat, HOME_VIEW.height),
    });

    v.screenSpaceEventHandler.setInputAction(
      (click: Cesium.ScreenSpaceEventHandler.PositionedEvent) => {
        // While the measure tool owns the cursor, don't open entity panels.
        if (useMeasureStore.getState().active) return;

        // drillPick (not pick) so overlapping features — e.g. several stacked
        // NWS alerts — all surface. Dedupe by panel id, keeping topmost order.
        const picked = v.scene.drillPick(click.position, 16);
        const seen = new Set<string>();
        const datas: PanelOpenData[] = [];
        for (const p of picked) {
          const d = getPanelData(p?.id);
          if (d && !seen.has(d.id)) {
            seen.add(d.id);
            datas.push(d);
          }
        }

        const chooser = usePickChooserStore.getState();
        if (datas.length === 0) {
          chooser.hide();
          return;
        }
        if (datas.length === 1) {
          chooser.hide();
          usePanelStore.getState().open(datas[0]);
          v.scene.requestRender();
          return;
        }
        // Several features under one click — let the user choose which to open.
        chooser.show(datas, click.position.x, click.position.y);
      },
      Cesium.ScreenSpaceEventType.LEFT_CLICK
    );

    setViewer(v);
    onReady?.(v);

    return () => {
      onReady?.(null);
      v.destroy();
      setViewer(null);
    };
  }, [onReady]);

  useEffect(() => {
    if (!viewer) return;
    const def = BASEMAPS[basemap];
    const newLayer = viewer.imageryLayers.addImageryProvider(def.build());
    // Apply optional colour adjustments (e.g. the dark-satellite look).
    if (def.adjust) {
      if (def.adjust.brightness != null) newLayer.brightness = def.adjust.brightness;
      if (def.adjust.contrast != null) newLayer.contrast = def.adjust.contrast;
      if (def.adjust.saturation != null) newLayer.saturation = def.adjust.saturation;
      if (def.adjust.gamma != null) newLayer.gamma = def.adjust.gamma;
    }
    viewer.imageryLayers.lowerToBottom(newLayer);
    if (baseLayerRef.current) {
      viewer.imageryLayers.remove(baseLayerRef.current, true);
    }
    baseLayerRef.current = newLayer;
    viewer.scene.requestRender();
  }, [viewer, basemap]);

  // Performance mode: drop render resolution, anti-aliasing, terrain detail and
  // atmosphere/lighting to lift FPS on thin clients; restore them when off.
  useEffect(() => {
    if (!viewer) return;
    const scene = viewer.scene;
    const globe = scene.globe;
    if (performanceMode) {
      // Render ~half the pixels — the single biggest win when fill-rate bound.
      viewer.resolutionScale = 0.65;
      scene.postProcessStages.fxaa.enabled = false;
      try {
        scene.msaaSamples = 1;
      } catch {
        /* MSAA unsupported — ignore */
      }
      globe.maximumScreenSpaceError = 4; // coarser terrain/imagery = fewer tiles
      globe.enableLighting = false;
      globe.showGroundAtmosphere = false;
      scene.fog.enabled = false;
      if (scene.skyAtmosphere) scene.skyAtmosphere.show = false;
    } else {
      viewer.resolutionScale = 1;
      scene.postProcessStages.fxaa.enabled = true;
      try {
        scene.msaaSamples = 4;
      } catch {
        /* ignore */
      }
      globe.maximumScreenSpaceError = 2;
      globe.enableLighting = true;
      globe.showGroundAtmosphere = true;
      scene.fog.enabled = true;
      if (scene.skyAtmosphere) scene.skyAtmosphere.show = true;
    }
    scene.requestRender();
  }, [viewer, performanceMode]);

  return (
    <div ref={containerRef} className="absolute inset-0">
      {children}
    </div>
  );
}
