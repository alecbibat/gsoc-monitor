import * as Cesium from 'cesium';
import { useEffect, useRef, useState } from 'react';
import { useCesiumViewer } from '../cesium/CesiumContext';
import { useScreensaverStore } from './screensaverStore';
import { api } from '../api/client';
import { useWebcamsData } from '../layers/webcams/webcamsStore';
import { RefreshingImage } from '../layers/webcams/RefreshingImage';
import type { Webcam } from '../types';

// During the national-parks screensaver, surface the webcams that fall inside
// the current camera view as small live windows, each tethered to its real
// location on the globe by a leader line that tracks the camera in real time.

const MAX_WINDOWS = 2;
const RESELECT_MS = 3200; // how often we re-pick which cams to feature
const LINE_COLOR = '#38bdf8';

// EllipsoidalOccluder ships in Cesium at runtime but is missing from the bundled
// type defs, so reach it through a narrow typed handle.
interface Occluder {
  isPointVisible(occludee: Cesium.Cartesian3): boolean;
}
const EllipsoidalOccluder = (
  Cesium as unknown as {
    EllipsoidalOccluder: new (ellipsoid: Cesium.Ellipsoid, cameraPosition: Cesium.Cartesian3) => Occluder;
  }
).EllipsoidalOccluder;

function sameIds(a: Webcam[], b: Webcam[]): boolean {
  if (a.length !== b.length) return false;
  const ids = new Set(a.map((c) => c.id));
  return b.every((c) => ids.has(c.id));
}

export function WebcamScreensaverCallouts() {
  const viewer = useCesiumViewer();
  const active = useScreensaverStore((s) => s.active);
  const mode = useScreensaverStore((s) => s.mode);
  const parksActive = active && mode === 'national-parks';

  const webcams = useWebcamsData((s) => s.webcams);
  const [featured, setFeatured] = useState<Webcam[]>([]);

  const lineRefs = useRef<Map<string, SVGLineElement>>(new Map());
  const dotRefs = useRef<Map<string, SVGCircleElement>>(new Map());
  const winRefs = useRef<Map<string, HTMLDivElement>>(new Map());
  const rafRef = useRef(0);

  // Make sure we have a webcam list to work from even if the layer is off.
  useEffect(() => {
    if (!parksActive) return;
    if (useWebcamsData.getState().webcams.length > 0) return;
    let cancelled = false;
    (async () => {
      try {
        const data = await api.webcams();
        if (!cancelled) useWebcamsData.getState().setWebcams(data.webcams);
      } catch {
        /* ignore — the screensaver simply shows no callouts */
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [parksActive]);

  // Periodically choose which in-view cams to feature (closest to screen centre,
  // not occluded by the globe). Only swap the set when it actually changes so the
  // iframes don't reload on every pass.
  useEffect(() => {
    if (!parksActive || !viewer || webcams.length === 0) {
      setFeatured([]);
      return;
    }
    const v = viewer;
    const pick = () => {
      const scene = v.scene;
      const occ = new EllipsoidalOccluder(scene.globe.ellipsoid, v.camera.positionWC);
      const W = scene.canvas.clientWidth;
      const H = scene.canvas.clientHeight;
      const scored: Array<{ cam: Webcam; d: number }> = [];
      for (const cam of webcams) {
        const carto = Cesium.Cartesian3.fromDegrees(cam.lon, cam.lat);
        if (!occ.isPointVisible(carto)) continue;
        const win = Cesium.SceneTransforms.worldToWindowCoordinates(scene, carto);
        if (!win || win.x < 0 || win.x > W || win.y < 0 || win.y > H) continue;
        scored.push({ cam, d: Math.hypot(win.x - W / 2, win.y - H / 2) });
      }
      scored.sort((a, b) => a.d - b.d);
      const top = scored.slice(0, MAX_WINDOWS).map((s) => s.cam);
      setFeatured((prev) => (sameIds(prev, top) ? prev : top));
    };
    pick();
    const id = setInterval(pick, RESELECT_MS);
    return () => clearInterval(id);
  }, [parksActive, viewer, webcams]);

  // Per-frame: glue each leader line's far end to its globe point and hide it
  // when the point rotates behind the horizon.
  useEffect(() => {
    if (!parksActive || !viewer || featured.length === 0) return;
    const v = viewer;
    const carts = new Map(featured.map((c) => [c.id, Cesium.Cartesian3.fromDegrees(c.lon, c.lat)]));

    const tick = () => {
      const scene = v.scene;
      const occ = new EllipsoidalOccluder(scene.globe.ellipsoid, v.camera.positionWC);
      for (const cam of featured) {
        const line = lineRefs.current.get(cam.id);
        const dot = dotRefs.current.get(cam.id);
        const win = winRefs.current.get(cam.id);
        const carto = carts.get(cam.id);
        if (!line || !dot || !win || !carto) continue;

        const pt = Cesium.SceneTransforms.worldToWindowCoordinates(scene, carto);
        const visible = !!pt && occ.isPointVisible(carto);
        if (visible && pt) {
          const r = win.getBoundingClientRect();
          line.setAttribute('x1', String(r.left));
          line.setAttribute('y1', String(r.top + r.height / 2));
          line.setAttribute('x2', String(pt.x));
          line.setAttribute('y2', String(pt.y));
          dot.setAttribute('cx', String(pt.x));
          dot.setAttribute('cy', String(pt.y));
          line.style.opacity = '0.8';
          dot.style.opacity = '1';
        } else {
          line.style.opacity = '0';
          dot.style.opacity = '0';
        }
      }
      rafRef.current = requestAnimationFrame(tick);
    };
    rafRef.current = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(rafRef.current);
  }, [parksActive, viewer, featured]);

  if (!parksActive || featured.length === 0) return null;

  return (
    <>
      <svg className="pointer-events-none fixed inset-0 z-[55] h-full w-full">
        {featured.map((cam) => (
          <g key={cam.id}>
            <line
              ref={(el) => {
                if (el) lineRefs.current.set(cam.id, el);
                else lineRefs.current.delete(cam.id);
              }}
              stroke={LINE_COLOR}
              strokeWidth={1.5}
              strokeDasharray="4 5"
              style={{ opacity: 0 }}
            />
            <circle
              ref={(el) => {
                if (el) dotRefs.current.set(cam.id, el);
                else dotRefs.current.delete(cam.id);
              }}
              r={4}
              fill={LINE_COLOR}
              stroke="#05222b"
              strokeWidth={1.5}
              style={{ opacity: 0 }}
            />
          </g>
        ))}
      </svg>

      <div className="pointer-events-none fixed right-6 top-24 z-[56] flex flex-col gap-3">
        {featured.map((cam) => (
          <div
            key={cam.id}
            ref={(el) => {
              if (el) winRefs.current.set(cam.id, el);
              else winRefs.current.delete(cam.id);
            }}
            className="w-[240px] overflow-hidden rounded-lg border border-sky-400/30 bg-ink-900/90 shadow-panel backdrop-blur-md"
          >
            <div className="relative w-full bg-black/40" style={{ aspectRatio: '16 / 9' }}>
              <RefreshingImage
                url={cam.imageUrl}
                alt={cam.title}
                className="absolute inset-0 h-full w-full object-cover"
              />
            </div>
            <div className="flex items-center gap-1.5 px-2.5 py-1.5">
              <span aria-hidden className="text-[12px]">📷</span>
              <div className="min-w-0">
                <div className="truncate text-[12px] font-semibold text-white/90">{cam.title}</div>
                <div className="truncate text-[10px] text-white/45">
                  {cam.distanceMi} mi from {cam.nearestPin}
                </div>
              </div>
            </div>
          </div>
        ))}
      </div>
    </>
  );
}
