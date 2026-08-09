import * as Cesium from 'cesium';
import { useEffect, useRef } from 'react';
import { useCesiumViewer } from '../../cesium/CesiumContext';
import { useLayersStore } from '../../store/layersStore';
import { probeWindAt } from './windStore';
import { useWindProbeStore } from './windProbeStore';
import { ARROW_DATA_URI, flowAxis, formatSpeed, WIND_UNIT_LABEL } from './windProbe';
import { useWindUnit } from './windUnitStore';
import { attachPanelData } from '../../cesium/entityPanelLink';

// Pixel radius within which a right-click lands "on" an existing pin (toggles it
// off rather than adding a new one).
const PIN_HIT_PX = 22;
const ARROW_PX = 34;
const OUTLINE = Cesium.Color.fromCssColorString('#0a1722');
const LABEL_BG = Cesium.Color.fromCssColorString('#0b1622').withAlpha(0.78);

// Screen pixel → lon/lat on the globe ellipsoid. Returns null when pointed at
// space.
function pickLngLat(viewer: Cesium.Viewer, pos: Cesium.Cartesian2) {
  const cart = viewer.camera.pickEllipsoid(pos, viewer.scene.globe.ellipsoid);
  if (!cart) return null;
  const c = Cesium.Cartographic.fromCartesian(cart);
  return { lon: Cesium.Math.toDegrees(c.longitude), lat: Cesium.Math.toDegrees(c.latitude) };
}

// Drives the wind point-probe: a live arrow + readout that follows the cursor,
// and right-click to drop persistent wind pins. Only active while the wind layer
// is on.
export function WindProbeController() {
  const viewer = useCesiumViewer();
  const active = useLayersStore((s) => s.active.wind);
  const probeEnabled = useWindProbeStore((s) => s.probeEnabled);
  const pins = useWindProbeStore((s) => s.pins);
  const unit = useWindUnit((s) => s.unit);

  const dsRef = useRef<Cesium.CustomDataSource | null>(null);
  const hoverRef = useRef<Cesium.Entity | null>(null);
  const pinEntsRef = useRef<Cesium.Entity[]>([]);

  // Set up the data source, the hover arrow, and the pointer handlers.
  useEffect(() => {
    if (!viewer || !active || !probeEnabled) return;
    const v = viewer;

    const ds = new Cesium.CustomDataSource('wind-probe');
    dsRef.current = ds;
    v.dataSources.add(ds);

    const hover = ds.entities.add({
      position: Cesium.Cartesian3.fromDegrees(0, 0),
      show: false,
      billboard: {
        image: ARROW_DATA_URI,
        width: ARROW_PX,
        height: ARROW_PX,
        alignedAxis: Cesium.Cartesian3.UNIT_Z,
        disableDepthTestDistance: Number.POSITIVE_INFINITY,
      },
    });
    hoverRef.current = hover;

    const probe = useWindProbeStore.getState;
    const handler = new Cesium.ScreenSpaceEventHandler(v.scene.canvas);
    const winScratch = new Cesium.Cartesian2();

    // Hover: sample the wind under the cursor and update the live arrow + HUD.
    handler.setInputAction((e: Cesium.ScreenSpaceEventHandler.MotionEvent) => {
      const p = pickLngLat(v, e.endPosition);
      const reading = p ? probeWindAt(p.lon, p.lat) : null;
      if (reading) {
        hover.position = new Cesium.ConstantPositionProperty(
          Cesium.Cartesian3.fromDegrees(reading.lon, reading.lat)
        );
        hover.billboard!.alignedAxis = new Cesium.ConstantProperty(
          flowAxis(reading.lon, reading.lat, reading.toDeg)
        );
        hover.show = true;
        probe().setHover(reading);
      } else {
        hover.show = false;
        probe().setHover(null);
      }
      v.scene.requestRender();
    }, Cesium.ScreenSpaceEventType.MOUSE_MOVE);

    // Right-click: toggle a persistent pin at this point.
    handler.setInputAction((e: Cesium.ScreenSpaceEventHandler.PositionedEvent) => {
      const p = pickLngLat(v, e.position);
      if (!p) return;
      const reading = probeWindAt(p.lon, p.lat);
      if (!reading) return;

      // Clicked on top of an existing pin → remove it instead of stacking.
      for (const pin of probe().pins) {
        const win = Cesium.SceneTransforms.worldToWindowCoordinates(
          v.scene,
          Cesium.Cartesian3.fromDegrees(pin.lon, pin.lat),
          winScratch
        );
        if (win && Cesium.Cartesian2.distance(win, e.position) < PIN_HIT_PX) {
          probe().removePin(pin.id);
          v.scene.requestRender();
          return;
        }
      }
      probe().addPin(reading);
      v.scene.requestRender();
    }, Cesium.ScreenSpaceEventType.RIGHT_CLICK);

    // Stop the OS context menu from popping on right-click; hide the hover arrow
    // when the cursor leaves the canvas.
    const onContext = (ev: MouseEvent) => ev.preventDefault();
    const onLeave = () => {
      hover.show = false;
      probe().setHover(null);
      v.scene.requestRender();
    };
    v.scene.canvas.addEventListener('contextmenu', onContext);
    v.scene.canvas.addEventListener('pointerleave', onLeave);

    return () => {
      handler.destroy();
      v.scene.canvas.removeEventListener('contextmenu', onContext);
      v.scene.canvas.removeEventListener('pointerleave', onLeave);
      v.dataSources.remove(ds, true);
      dsRef.current = null;
      hoverRef.current = null;
      pinEntsRef.current = [];
      useWindProbeStore.getState().setHover(null);
      v.scene.requestRender();
    };
  }, [viewer, active, probeEnabled]);

  // Reconcile pin entities whenever the pin set changes.
  useEffect(() => {
    const ds = dsRef.current;
    if (!viewer || !ds || !active || !probeEnabled) return;

    pinEntsRef.current.forEach((ent) => ds.entities.remove(ent));
    pinEntsRef.current = [];

    pins.forEach((pin) => {
      const ent = ds.entities.add({
        // Surface anchor + default depth test — dropped pins hide behind the
        // globe when rotated to the far side (unlike the cursor-tracking hover
        // arrow above, these persist after the camera moves).
        position: Cesium.Cartesian3.fromDegrees(pin.lon, pin.lat, 0),
        billboard: {
          image: ARROW_DATA_URI,
          width: ARROW_PX,
          height: ARROW_PX,
          alignedAxis: flowAxis(pin.lon, pin.lat, pin.toDeg),
        },
        label: {
          text: `${pin.cardinal} · ${formatSpeed(pin.speedMps, unit)} ${WIND_UNIT_LABEL[unit]}`,
          font: '600 12px ui-sans-serif, system-ui, sans-serif',
          fillColor: Cesium.Color.WHITE,
          outlineColor: OUTLINE,
          outlineWidth: 3,
          style: Cesium.LabelStyle.FILL_AND_OUTLINE,
          verticalOrigin: Cesium.VerticalOrigin.TOP,
          pixelOffset: new Cesium.Cartesian2(0, ARROW_PX / 2 + 4),
          showBackground: true,
          backgroundColor: LABEL_BG,
          backgroundPadding: new Cesium.Cartesian2(7, 4),
        },
      });
      // Left-click a pin → open its wind-forecast panel (the global click
      // handler reads this off whatever entity gets picked).
      attachPanelData(ent, {
        id: `wind-forecast-${pin.id}`,
        kind: 'wind-forecast',
        title: 'Wind forecast',
        subtitle: `${Math.abs(pin.lat).toFixed(3)}°${pin.lat >= 0 ? 'N' : 'S'}, ${Math.abs(
          pin.lon
        ).toFixed(3)}°${pin.lon >= 0 ? 'E' : 'W'}`,
        payload: {
          lon: pin.lon,
          lat: pin.lat,
          cardinal: pin.cardinal,
          fromDeg: pin.fromDeg,
          toDeg: pin.toDeg,
          speedMps: pin.speedMps,
          speedMph: pin.speedMph,
        },
      });
      pinEntsRef.current.push(ent);
    });

    viewer.scene.requestRender();
  }, [viewer, active, probeEnabled, pins, unit]);

  return null;
}
