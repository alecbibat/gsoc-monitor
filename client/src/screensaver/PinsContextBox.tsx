import * as Cesium from 'cesium';
import { useEffect, useRef, useState } from 'react';
import { useScreensaverStore } from './screensaverStore';
import { BASEMAPS } from '../cesium/basemaps';
import { useLayersStore } from '../store/layersStore';

const MAP_W = 240;
const MAP_H = 130;
// Regional altitude — shows ~1 300 km radius around the POI at 60° FoV.
const MINIMAP_ALT = 2_500_000;

export function PinsContextBox() {
  const containerRef = useRef<HTMLDivElement>(null);
  const [miniViewer, setMiniViewer] = useState<Cesium.Viewer | null>(null);
  const baseLayerRef = useRef<Cesium.ImageryLayer | null>(null);

  const basemap = useLayersStore((s) => s.basemap);
  const active = useScreensaverStore((s) => s.active);
  const mode = useScreensaverStore((s) => s.mode);
  const poi = useScreensaverStore((s) => s.currentPoi);

  const isPins = active && mode === 'pins';
  const visible = isPins && poi !== null;

  // Create/destroy the minimap Cesium viewer with pins mode.
  useEffect(() => {
    if (!isPins || !containerRef.current) return;

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
      contextOptions: { webgl: { alpha: true } },
    });

    if (v.scene.skyBox) v.scene.skyBox.show = false;
    if (v.scene.skyAtmosphere) v.scene.skyAtmosphere.show = false;
    v.scene.fog.enabled = false;
    v.scene.backgroundColor = new Cesium.Color(0, 0, 0, 0);
    v.scene.globe.baseColor = Cesium.Color.fromCssColorString('#05070a');
    v.scene.globe.enableLighting = false;
    v.scene.globe.showGroundAtmosphere = false;

    // Lock the minimap — no user camera interaction.
    const ctrl = v.scene.screenSpaceCameraController;
    ctrl.enableRotate = false;
    ctrl.enableZoom = false;
    ctrl.enableTilt = false;
    ctrl.enableLook = false;
    ctrl.enableTranslate = false;

    // Start centred on the Americas as a placeholder until the first POI arrives.
    v.camera.setView({
      destination: Cesium.Cartesian3.fromDegrees(-96, 38, MINIMAP_ALT),
      orientation: { heading: 0, pitch: -Cesium.Math.PI_OVER_TWO, roll: 0 },
    });

    setMiniViewer(v);

    return () => {
      v.destroy();
      setMiniViewer(null);
      baseLayerRef.current = null;
    };
  }, [isPins]);

  // Keep minimap basemap in sync with the main viewer.
  useEffect(() => {
    if (!miniViewer) return;
    const def = BASEMAPS[basemap];
    const newLayer = miniViewer.imageryLayers.addImageryProvider(def.build());
    if (def.adjust) {
      if (def.adjust.brightness != null) newLayer.brightness = def.adjust.brightness;
      if (def.adjust.contrast != null) newLayer.contrast = def.adjust.contrast;
      if (def.adjust.saturation != null) newLayer.saturation = def.adjust.saturation;
      if (def.adjust.gamma != null) newLayer.gamma = def.adjust.gamma;
    }
    miniViewer.imageryLayers.lowerToBottom(newLayer);
    if (baseLayerRef.current) miniViewer.imageryLayers.remove(baseLayerRef.current, true);
    baseLayerRef.current = newLayer;
  }, [miniViewer, basemap]);

  // Pan the minimap to the current POI. The crosshair SVG overlay is always
  // centred, so this is all we need to keep it aligned with the POI.
  useEffect(() => {
    if (!miniViewer || !poi) return;
    miniViewer.camera.setView({
      destination: Cesium.Cartesian3.fromDegrees(poi.lon, poi.lat, MINIMAP_ALT),
      orientation: { heading: 0, pitch: -Cesium.Math.PI_OVER_TWO, roll: 0 },
    });
  }, [miniViewer, poi]);

  return (
    <div
      className={`pointer-events-none absolute bottom-12 right-6 z-30 transition-all duration-500 ${
        visible ? 'opacity-100 translate-y-0' : 'opacity-0 translate-y-2'
      }`}
    >
      <div
        className="relative overflow-hidden rounded-xl border border-white/15 shadow-2xl"
        style={{ width: MAP_W, height: MAP_H }}
      >
        {/* Cesium minimap canvas */}
        <div ref={containerRef} className="absolute inset-0" />

        {/* Crosshair — always at canvas centre, which is always the POI. */}
        <div className="pointer-events-none absolute inset-0 flex items-center justify-center">
          <svg width="22" height="22" viewBox="0 0 22 22" fill="none">
            <circle cx="11" cy="11" r="3.5" stroke="#a78bfa" strokeWidth="1.5" />
            <line x1="11" y1="0" x2="11" y2="6.5" stroke="#a78bfa" strokeWidth="1" opacity="0.7" />
            <line x1="11" y1="15.5" x2="11" y2="22" stroke="#a78bfa" strokeWidth="1" opacity="0.7" />
            <line x1="0" y1="11" x2="6.5" y2="11" stroke="#a78bfa" strokeWidth="1" opacity="0.7" />
            <line x1="15.5" y1="11" x2="22" y2="11" stroke="#a78bfa" strokeWidth="1" opacity="0.7" />
          </svg>
        </div>

        {/* "CONTEXT" label — top-left corner */}
        <div className="pointer-events-none absolute left-2 top-1.5">
          <span className="text-[9px] font-semibold uppercase tracking-wider text-white/30">
            CONTEXT
          </span>
        </div>

        {/* Bottom gradient overlay with POI name + coordinates */}
        {poi && (
          <div className="pointer-events-none absolute inset-x-0 bottom-0 bg-gradient-to-t from-black/80 to-transparent px-2 pb-1.5 pt-4">
            <div className="truncate text-[10px] font-medium text-white/80">{poi.title}</div>
            <div className="text-[9px] font-mono text-white/40">
              {poi.lat >= 0
                ? `${poi.lat.toFixed(2)}°N`
                : `${Math.abs(poi.lat).toFixed(2)}°S`}{' '}
              {poi.lon >= 0
                ? `${poi.lon.toFixed(2)}°E`
                : `${Math.abs(poi.lon).toFixed(2)}°W`}
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
