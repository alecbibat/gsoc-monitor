import * as Cesium from 'cesium';
import { useEffect, useLayoutEffect, useRef, useState } from 'react';
import { useCesiumViewer } from '../../cesium/CesiumContext';
import { mapToolOwnsCursor } from '../../cesium/cursorOwner';
import { useLayersStore } from '../../store/layersStore';
import { useScreensaverStore } from '../../screensaver/screensaverStore';
import { useHoverStore } from '../../screensaver/hoverStore';
import { useRadarStore } from './radarStore';
import { radarControl, radarPlayhead } from './radarPlayhead';
import { intensityLabel } from './radarPalettes';
import { echoSwatch, readoutPlacement } from './radarHover';

const THROTTLE_MS = 80;

interface Reading {
  dbz: number;
  snow: boolean;
}

// "Heavy rain · 42 dBZ" beside the cursor while the radar layer is on: the
// reflectivity under the pointer on the frame mostly on screen, read back from
// the tile worker's decoded grids (radarControl.probe). Mouse and pen only —
// a touch is a pan. Must be mounted inside a CesiumGlobe; the tooltip is
// positioned in the globe's container, i.e. in canvas coordinates, which is
// right on both the operator app and the share page's embedded frame. z-20
// keeps it over the globe but under the HUD (legends, docks: z-30).
export function RadarHoverReadout() {
  const viewer = useCesiumViewer();
  const active = useLayersStore((s) => s.active.radar);
  const screensaverActive = useScreensaverStore((s) => s.active);
  const hoverEngaged = useHoverStore((s) => s.active || s.picking);
  const palette = useRadarStore((s) => s.palette);
  const [reading, setReading] = useState<Reading | null>(null);
  const boxRef = useRef<HTMLDivElement>(null);
  // Last cursor position (canvas px) and map size, for placing the box.
  const cursor = useRef<{ x: number; y: number; w: number; h: number } | null>(null);
  const enabled = !!viewer && active && !screensaverActive && !hoverEngaged;

  const place = () => {
    const box = boxRef.current;
    const c = cursor.current;
    if (!box || !c) return;
    const { left, top } = readoutPlacement(c.x, c.y, box.offsetWidth, box.offsetHeight, c.w, c.h);
    box.style.transform = `translate3d(${Math.round(left)}px, ${Math.round(top)}px, 0)`;
  };

  useEffect(() => {
    if (!enabled || !viewer || viewer.isDestroyed()) {
      setReading(null);
      return;
    }
    const v = viewer;
    const canvas = v.scene.canvas;
    const scratch = new Cesium.Cartesian2();
    let seq = 0; // bumped per probe and on hide: answers that arrive late are dropped
    let timer: ReturnType<typeof setTimeout> | null = null;
    let lastRun = 0;
    let lastIndex = radarPlayhead.get().index;

    const hide = () => {
      seq++;
      cursor.current = null;
      if (timer) clearTimeout(timer);
      timer = null;
      setReading(null);
    };

    const run = () => {
      timer = null;
      lastRun = performance.now();
      const c = cursor.current;
      if (!c || v.isDestroyed()) return;
      const my = ++seq;
      // A map tool (measure, fuel zone, crisis drawing) owns the cursor.
      if (mapToolOwnsCursor()) {
        setReading(null);
        return;
      }
      scratch.x = c.x;
      scratch.y = c.y;
      const cart = v.camera.pickEllipsoid(scratch, v.scene.globe.ellipsoid);
      if (!cart) {
        setReading(null);
        return;
      }
      const carto = Cesium.Cartographic.fromCartesian(cart);
      radarControl
        .probe(Cesium.Math.toDegrees(carto.longitude), Cesium.Math.toDegrees(carto.latitude))
        .then(
          (r) => {
            if (my === seq) setReading(r ? { dbz: r.dbz, snow: r.snow } : null);
          },
          () => {
            if (my === seq) setReading(null);
          }
        );
    };

    const schedule = () => {
      if (timer) return;
      const wait = THROTTLE_MS - (performance.now() - lastRun);
      if (wait <= 0) run();
      else timer = setTimeout(run, wait);
    };

    const onMove = (e: PointerEvent) => {
      if (e.pointerType === 'touch') return;
      // A button held down is a globe drag: no readout until it's released.
      if (e.buttons !== 0) {
        if (cursor.current) hide();
        return;
      }
      const rect = canvas.getBoundingClientRect();
      cursor.current = { x: e.clientX - rect.left, y: e.clientY - rect.top, w: rect.width, h: rect.height };
      place();
      schedule();
    };
    const onDown = () => hide();
    const onLeave = () => hide();
    // Zooming moves the ground under a still cursor.
    const onWheel = () => {
      if (cursor.current) schedule();
    };

    canvas.addEventListener('pointermove', onMove);
    canvas.addEventListener('pointerdown', onDown);
    canvas.addEventListener('pointerleave', onLeave);
    canvas.addEventListener('wheel', onWheel, { passive: true });
    // During playback the echo under a still cursor changes with the frame.
    const unsubscribe = radarPlayhead.subscribe((s) => {
      if (s.index === lastIndex) return;
      lastIndex = s.index;
      if (cursor.current) schedule();
    });

    return () => {
      canvas.removeEventListener('pointermove', onMove);
      canvas.removeEventListener('pointerdown', onDown);
      canvas.removeEventListener('pointerleave', onLeave);
      canvas.removeEventListener('wheel', onWheel);
      unsubscribe();
      hide();
    };
  }, [enabled, viewer]);

  const swatch = reading ? echoSwatch(palette, reading.dbz, reading.snow) : null;
  const shown = reading !== null && swatch !== null && swatch.visible;

  // New text changes the box's size: re-place it before it paints.
  useLayoutEffect(() => {
    if (shown) place();
  });

  if (!shown || !reading || !swatch) return null;
  return (
    <div
      ref={boxRef}
      aria-hidden="true"
      className="pointer-events-none absolute left-0 top-0 z-20 flex items-center gap-1.5 whitespace-nowrap rounded-lg border border-white/10 bg-ink-900/90 px-2 py-1 text-[11px] shadow-panel backdrop-blur-sm"
    >
      <span className="h-2.5 w-2.5 shrink-0 rounded-full ring-1 ring-white/25" style={{ background: swatch.css }} />
      <span className="font-medium text-white/85">{intensityLabel(reading.dbz, reading.snow)}</span>
      <span className="text-white/25">·</span>
      <span className="font-mono tabular-nums text-white/55">{Math.round(reading.dbz)} dBZ</span>
    </div>
  );
}
