import * as Cesium from 'cesium';
import { useEffect, useLayoutEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { useCesiumViewer } from '../../cesium/CesiumContext';
import { mapToolOwnsCursor } from '../../cesium/cursorOwner';
import { useLayersStore } from '../../store/layersStore';
import { useScreensaverStore } from '../../screensaver/screensaverStore';
import { useHoverStore } from '../../screensaver/hoverStore';
import { useHurricaneHover } from '../hurricanes/hurricaneHoverStore';
import { useRadarStore } from './radarStore';
import { radarControl, radarPlayhead } from './radarPlayhead';
import { boxesOverlap, hurricaneTooltipZone, radarReadout, readoutPlacement, type Box } from './radarHover';

const THROTTLE_MS = 80;

interface Reading {
  dbz: number;
  snow: boolean;
}

// Whether the box (viewport px) would cover something other than the globe's
// canvas: the HUD — timeline dock, legend cards, sidebar. Hit-testing skips
// pointer-events: none layers (this box, the hurricane tooltip, the docks'
// own full-width wrappers), so only things the user can point at count.
function coversHud(b: Box, canvas: HTMLCanvasElement): boolean {
  const points = [
    [b.left + 1, b.top + 1],
    [b.right - 1, b.top + 1],
    [b.left + 1, b.bottom - 1],
    [b.right - 1, b.bottom - 1],
    [(b.left + b.right) / 2, (b.top + b.bottom) / 2],
  ];
  for (const [x, y] of points) {
    const hit = document.elementFromPoint(x, y);
    if (hit && hit !== canvas) return true;
  }
  return false;
}

// "Heavy rain · 42 dBZ" beside the cursor while the radar layer is on: the
// reflectivity under the pointer on the frame mostly on screen, read back from
// the tile worker's decoded grids (radarControl.probe). Mouse and pen only —
// a touch is a pan. Must be mounted inside a CesiumGlobe. The box is portalled
// to <body> and fixed in viewport px, so the z-30 HUD (scrubber dock, legend
// cards) can't cover it and transformed ancestors (the share page's frame, the
// docked crisis map) don't offset it; it stays inside the globe's canvas and
// off the HUD and the hurricane tooltip where there's room. z-[60]: over the
// HUD and sidebar (z-50), under the full-screen overlays (z-[1000] and up).
export function RadarHoverReadout() {
  const viewer = useCesiumViewer();
  const active = useLayersStore((s) => s.active.radar);
  const screensaverActive = useScreensaverStore((s) => s.active);
  const hoverEngaged = useHoverStore((s) => s.active || s.picking);
  const palette = useRadarStore((s) => s.palette);
  const snowPref = useRadarStore((s) => s.snow);
  const [reading, setReading] = useState<Reading | null>(null);
  const boxRef = useRef<HTMLDivElement>(null);
  // Last cursor position and where the canvas it's over was (viewport px).
  const cursor = useRef<{ x: number; y: number; canvas: HTMLCanvasElement; left: number; top: number } | null>(null);
  const enabled = !!viewer && active && !screensaverActive && !hoverEngaged;

  const place = () => {
    const box = boxRef.current;
    const c = cursor.current;
    if (!box || !c) return;
    const r = c.canvas.getBoundingClientRect();
    const vw = window.innerWidth;
    const vh = window.innerHeight;
    const area = {
      left: Math.max(0, r.left),
      top: Math.max(0, r.top),
      right: Math.min(vw, r.right),
      bottom: Math.min(vh, r.bottom),
    };
    const h = useHurricaneHover.getState();
    const zone = h.info ? hurricaneTooltipZone(h.x, h.y, vw, vh) : null;
    const blocked = (b: Box) => (zone !== null && boxesOverlap(b, zone)) || coversHud(b, c.canvas);
    const { left, top } = readoutPlacement(c.x, c.y, box.offsetWidth, box.offsetHeight, area, blocked);
    box.style.transform = `translate3d(${Math.round(left)}px, ${Math.round(top)}px, 0)`;
  };

  useEffect(() => {
    if (!enabled || !viewer || viewer.isDestroyed()) {
      setReading(null);
      return;
    }
    const v = viewer;
    const scene = v.scene;
    const canvas = scene.canvas;
    const winPos = new Cesium.Cartesian2();
    const ray = new Cesium.Ray();
    const ground = new Cesium.Cartesian3();
    const carto = new Cesium.Cartographic();
    const probedView = new Cesium.Matrix4(); // camera view the last probe was picked from
    let seq = 0; // bumped per probe and on hide: answers that arrive late are dropped
    let timer: ReturnType<typeof setTimeout> | null = null;
    let lastRun = 0;
    let lastIndex = radarPlayhead.get().index;

    // Same reading as before: keep the object so React skips the re-render.
    const show = (r: Reading | null) =>
      setReading((prev) => (prev && r && prev.dbz === r.dbz && prev.snow === r.snow ? prev : r));

    const hide = () => {
      seq++;
      cursor.current = null;
      if (timer) clearTimeout(timer);
      timer = null;
      setReading(null);
    };

    // The ground under a canvas point: the terrain surface Cesium drew there —
    // the radar is draped on it, so hills and mountains don't shift the
    // reading — else the ellipsoid (terrain tiles not in yet, globe hidden).
    const groundAt = (x: number, y: number): Cesium.Cartographic | undefined => {
      winPos.x = x;
      winPos.y = y;
      const r = v.camera.getPickRay(winPos, ray);
      const cart =
        (r && scene.globe.pick(r, scene, ground)) ?? v.camera.pickEllipsoid(winPos, scene.globe.ellipsoid, ground);
      return cart && Cesium.Cartographic.fromCartesian(cart, scene.globe.ellipsoid, carto);
    };

    const run = () => {
      timer = null;
      lastRun = performance.now();
      const c = cursor.current;
      if (!c || v.isDestroyed()) return;
      const my = ++seq;
      // A map tool (measure, fuel zone, crisis drawing) owns the cursor.
      if (mapToolOwnsCursor()) {
        show(null);
        return;
      }
      Cesium.Matrix4.clone(v.camera.viewMatrix, probedView);
      const rect = canvas.getBoundingClientRect();
      const at = groundAt(c.x - rect.left, c.y - rect.top);
      if (!at) {
        show(null);
        return;
      }
      radarControl.probe(Cesium.Math.toDegrees(at.longitude), Cesium.Math.toDegrees(at.latitude)).then(
        (r) => {
          if (my === seq) show(r ? { dbz: r.dbz, snow: r.snow } : null);
        },
        () => {
          if (my === seq) show(null);
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
      cursor.current = { x: e.clientX, y: e.clientY, canvas, left: rect.left, top: rect.top };
      place();
      schedule();
    };
    const onDown = () => hide();
    const onLeave = () => hide();
    // Scrolling the page (the share view's scroll container) moves the map
    // under a still cursor without a pointer event; the next move brings the
    // readout back. Any other scroller (a list, the ticker) leaves it be.
    const onScroll = () => {
      const c = cursor.current;
      if (!c) return;
      const rect = canvas.getBoundingClientRect();
      if (rect.left !== c.left || rect.top !== c.top) hide();
    };
    // The camera moving under a still cursor (wheel zoom, inertia, keyboard,
    // fly-tos) changes the ground under it: re-probe after a frame drawn from
    // a new view. Cheap enough per frame — a matrix compare.
    const onRender = () => {
      if (cursor.current && !Cesium.Matrix4.equals(v.camera.viewMatrix, probedView)) schedule();
    };

    canvas.addEventListener('pointermove', onMove);
    canvas.addEventListener('pointerdown', onDown);
    canvas.addEventListener('pointerleave', onLeave);
    canvas.addEventListener('pointercancel', onLeave);
    document.addEventListener('scroll', onScroll, { capture: true, passive: true });
    const removeRender = scene.postRender.addEventListener(onRender);
    // During playback the echo under a still cursor changes with the frame.
    const unsubscribePlayhead = radarPlayhead.subscribe((s) => {
      if (s.index === lastIndex) return;
      lastIndex = s.index;
      if (cursor.current) schedule();
    });
    // The hurricane tooltip coming or going moves the box to a free corner.
    const unsubscribeHurricane = useHurricaneHover.subscribe(() => place());

    return () => {
      canvas.removeEventListener('pointermove', onMove);
      canvas.removeEventListener('pointerdown', onDown);
      canvas.removeEventListener('pointerleave', onLeave);
      canvas.removeEventListener('pointercancel', onLeave);
      document.removeEventListener('scroll', onScroll, { capture: true });
      removeRender();
      unsubscribePlayhead();
      unsubscribeHurricane();
      hide();
    };
  }, [enabled, viewer]);

  // Colour and wording follow the current palette and snow setting, so
  // changing either restyles the reading already on screen.
  const readout = reading ? radarReadout(palette, reading, snowPref) : null;

  // New text changes the box's size: re-place it before it paints.
  useLayoutEffect(() => {
    if (readout) place();
  });

  if (!readout || typeof document === 'undefined') return null;
  return createPortal(
    <div
      ref={boxRef}
      aria-hidden="true"
      className="pointer-events-none fixed left-0 top-0 z-[60] flex items-center gap-1.5 whitespace-nowrap rounded-lg border border-white/10 bg-ink-900/90 px-2 py-1 text-[11px] shadow-panel backdrop-blur-sm"
    >
      <span className="h-2.5 w-2.5 shrink-0 rounded-full ring-1 ring-white/25" style={{ background: readout.css }} />
      <span className="font-medium text-white/85">{readout.label}</span>
      <span className="text-white/25">·</span>
      <span className="font-mono tabular-nums text-white/55">{readout.dbz} dBZ</span>
    </div>,
    document.body
  );
}
