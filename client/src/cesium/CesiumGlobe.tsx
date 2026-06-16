import * as Cesium from 'cesium';
import { useEffect, useRef, useState } from 'react';
import { BASEMAPS } from './basemaps';
import { getPanelData } from './entityPanelLink';
import { useLayersStore } from '../store/layersStore';
import { usePanelStore } from '../panels/panelStore';

interface Props {
  children?: React.ReactNode;
  onReady?: (viewer: Cesium.Viewer | null) => void;
}

export function CesiumGlobe({ children, onReady }: Props) {
  const containerRef = useRef<HTMLDivElement>(null);
  const [viewer, setViewer] = useState<Cesium.Viewer | null>(null);
  const baseLayerRef = useRef<Cesium.ImageryLayer | null>(null);
  const basemap = useLayersStore((s) => s.basemap);

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
      destination: Cesium.Cartesian3.fromDegrees(-95, 38, 14_000_000),
    });

    v.screenSpaceEventHandler.setInputAction(
      (click: Cesium.ScreenSpaceEventHandler.PositionedEvent) => {
        const picked = v.scene.pick(click.position);
        const panelData = getPanelData(picked?.id);
        if (panelData) {
          usePanelStore.getState().open(panelData);
          v.scene.requestRender();
        }
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
    const newLayer = viewer.imageryLayers.addImageryProvider(BASEMAPS[basemap].build());
    viewer.imageryLayers.lowerToBottom(newLayer);
    if (baseLayerRef.current) {
      viewer.imageryLayers.remove(baseLayerRef.current, true);
    }
    baseLayerRef.current = newLayer;
    viewer.scene.requestRender();
  }, [viewer, basemap]);

  return (
    <div ref={containerRef} className="absolute inset-0">
      {children}
    </div>
  );
}
