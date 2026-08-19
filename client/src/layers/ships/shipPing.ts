import * as Cesium from 'cesium';
import {
  SHIP_MARKER, pingAlpha, pingScale, prefersReducedMotion, shipPingUri,
} from './shipMarkers';

// Render pacing for the ping. The globe runs in requestRenderMode, so an
// animated CallbackProperty only advances when something asks for a frame —
// the pump below asks while at least one marker is on screen. A ring takes
// seconds to expand, so ~22fps is indistinguishable from full rate and costs
// a third of the frames.
const PING_FRAME_MS = 45;

/**
 * The three expanding rings under one ship marker, as billboard options.
 *
 * Scale and colour are CallbackProperties reading a shared clock (see
 * shipMarkers), so every ship in the fleet pulses in step — and a marker that
 * is only redrawn on a new AIS fix still animates between fixes.
 */
export function pingBillboard(
  color: string,
  ring: number,
  alpha: number
): Cesium.BillboardGraphics.ConstructorOptions {
  return {
    image: shipPingUri(color),
    width: SHIP_MARKER.ping.sizePx,
    height: SHIP_MARKER.ping.sizePx,
    scale: new Cesium.CallbackProperty(() => pingScale(ring), false),
    color: new Cesium.CallbackProperty(
      () => Cesium.Color.WHITE.withAlpha(pingAlpha(ring, alpha)),
      false
    ),
    scaleByDistance: SHIP_MARKER.scaleByDistance,
    // Default depth test so far-side rings stay hidden behind the globe.
  };
}

export interface PingPump {
  /** Tell the pump where the markers are; it idles when none are in view. */
  setPositions: (positions: Array<{ lon: number; lat: number }>) => void;
  /** Start (or restart) the frame loop if it should be running. */
  ensure: () => void;
  /** Stop the loop and drop the camera listener. */
  dispose: () => void;
}

/**
 * Frame pump for the ship ping rings.
 *
 * The rings read their own scale/alpha off the clock; this loop only asks
 * Cesium for frames, and idles the moment no marker is on screen — so a fleet
 * parked on the far side of the globe costs nothing. Viewers who ask for less
 * motion get frozen rings and no frames at all.
 */
export function createPingPump(viewer: Cesium.Viewer): PingPump {
  let raf: number | null = null;
  let lastFrame = 0;
  let positions: Array<{ lon: number; lat: number }> = [];
  let viewRect: Cesium.Rectangle | null = viewer.camera.computeViewRectangle() ?? null;
  let disposed = false;
  const scratchCarto = new Cesium.Cartographic();

  const anyInView = (): boolean => {
    if (!positions.length) return false;
    if (!viewRect) return true; // can't tell — keep animating
    return positions.some(({ lon, lat }) => {
      Cesium.Cartographic.fromDegrees(lon, lat, 0, scratchCarto);
      return Cesium.Rectangle.contains(viewRect!, scratchCarto);
    });
  };

  const frame = () => {
    if (disposed || !anyInView()) {
      raf = null;
      return;
    }
    const now = performance.now();
    if (now - lastFrame >= PING_FRAME_MS) {
      lastFrame = now;
      viewer.scene.requestRender();
    }
    raf = requestAnimationFrame(frame);
  };

  const ensure = () => {
    if (disposed) return;
    if (prefersReducedMotion()) return; // rings are frozen — no frames needed
    if (raf == null && anyInView()) raf = requestAnimationFrame(frame);
  };

  const offCamera = viewer.camera.changed.addEventListener(() => {
    viewRect = viewer.camera.computeViewRectangle() ?? null;
    ensure();
  });

  return {
    setPositions: (next) => { positions = next; },
    ensure,
    dispose: () => {
      disposed = true;
      offCamera();
      if (raf != null) cancelAnimationFrame(raf);
      raf = null;
    },
  };
}
