// Stage C PR 6 diagnostic, behind `?radarwarp=1`.
//
// The warp math is verified against synthetic storms with known displacements.
// What that cannot tell us is whether the whole chain works on real tiles:
// fields cached for both frames of a live pair, flow measured over them, the
// stitch finding those fields in the worker the level hash picked, and the warp
// producing something that actually differs from a crossfade.
//
// So this measures the one number that proves it end to end: how far the warped
// image departs from the dissolve of the same pair. Zero means the flow is not
// reaching the warp — which looks identical to "the weather is not moving", and
// is the failure this exists to catch. Published at `window.__radarWarp()`.
//
// Nothing renders. Nothing changes unless the flag is set. The render wiring is
// PR 7's job, where `t` becomes continuous.

import { useEffect } from 'react';
import { useCesiumViewer } from '../../../cesium/CesiumContext';
import { useLayersStore } from '../../../store/layersStore';
import { planWarmRegion, regionKey } from '../gl/composite';
import { buildTimeline, nowIndex, useRadarStore } from '../radarStore';
import { RADAR_MAX_LEVEL } from '../RainViewerImagery';
import { warpRegion } from '../worker/pool';
import { getFlow } from './flowCache';

const PROBE_MS = 2000;

// Sampled across the interval rather than only at the midpoint: t=0 and t=1
// must reproduce the source frames exactly, and the interior is where motion
// shows. Divergence from the dissolve should peak in the middle and vanish at
// the ends — a flat profile means `t` is not reaching the warp.
const SAMPLES = [0, 0.25, 0.5, 0.75, 1];

export function radarWarpProbeEnabled(): boolean {
  try {
    return new URLSearchParams(window.location.search).get('radarwarp') === '1';
  } catch {
    return false;
  }
}

interface WarpReport {
  region: string | null;
  pair: string | null;
  coverage: number;
  /** Worker milliseconds per warped frame, averaged over the samples. */
  meanMs: number;
  peakMs: number;
  /**
   * How far the warp departs from the dissolve of the same pair, per sampled t,
   * averaged over the pixels either one covers. Non-zero in the interior is the
   * proof that motion is reaching the render.
   */
  divergence: Array<{ t: number; mean: number; peak: number }>;
  flowMeanU: number;
  flowMeanV: number;
  note: string;
}

let last: WarpReport = {
  region: null,
  pair: null,
  coverage: 0,
  meanMs: 0,
  peakMs: 0,
  divergence: [],
  flowMeanU: 0,
  flowMeanV: 0,
  note: 'no warp computed yet',
};

// How far the warp departs from the dissolve, in the alpha channel.
//
// Averaged over WEATHER, not over the image. A view is mostly empty sky where
// both renders are transparent and identical, so dividing by the full pixel
// count reports a number that shrinks as you zoom out and says nothing about
// whether the storms moved. The denominator here is the pixels either render
// covers, which makes the value comparable across zoom levels and regions.
//
// Alpha alone is enough: the palette is a function of the blended field, so any
// change in where the echo sits moves alpha too, and reading one channel keeps
// this cheap enough to run on every sample.
function alphaDelta(a: ImageBitmap, b: ImageBitmap): { mean: number; peak: number } {
  const w = Math.min(a.width, b.width);
  const h = Math.min(a.height, b.height);
  if (w === 0 || h === 0) return { mean: 0, peak: 0 };
  const canvas = new OffscreenCanvas(w, h);
  const ctx = canvas.getContext('2d', { willReadFrequently: true });
  if (!ctx) return { mean: 0, peak: 0 };
  ctx.clearRect(0, 0, w, h);
  ctx.drawImage(a, 0, 0);
  const pa = ctx.getImageData(0, 0, w, h).data;
  ctx.clearRect(0, 0, w, h);
  ctx.drawImage(b, 0, 0);
  const pb = ctx.getImageData(0, 0, w, h).data;
  let sum = 0;
  let covered = 0;
  let peak = 0;
  for (let i = 3; i < pa.length; i += 4) {
    if (pa[i] === 0 && pb[i] === 0) continue;
    covered++;
    const d = Math.abs(pa[i] - pb[i]);
    if (d > peak) peak = d;
    sum += d;
  }
  return { mean: covered ? +(sum / covered).toFixed(2) : 0, peak };
}

export function WarpProbe() {
  const viewer = useCesiumViewer();
  const active = useLayersStore((s) => s.active.radar);
  const host = useRadarStore((s) => s.host);

  useEffect(() => {
    if (!viewer || viewer.isDestroyed() || !active || !host) return;
    (globalThis as unknown as Record<string, unknown>).__radarWarp = () => last;

    let disposed = false;
    let busy = false;
    const timer = window.setInterval(() => {
      if (disposed || busy || viewer.isDestroyed()) return;
      const s = useRadarStore.getState();
      const timeline = buildTimeline(s);
      if (timeline.length < 2) return;
      // Clamped to the OBSERVED range, not to the timeline's end. Since PR 8 the
      // timeline carries forecast frames whose paths are sentinels with no tiles
      // behind them; feeding one to planWarmRegion finds nothing warm and this
      // reports a permanent "no region decoded" whenever the playhead sits past
      // "now".
      const lastPair = nowIndex(timeline) - 1;
      if (lastPair < 0) return;
      const i = Math.min(Math.max(0, s.currentIndex), lastPair);
      const a = timeline[i].frame.path;
      const b = timeline[i + 1].frame.path;
      const region = planWarmRegion(RADAR_MAX_LEVEL, [a, b]);
      if (!region) {
        last = { ...last, note: 'no region decoded for this pair yet' };
        return;
      }

      busy = true;
      void (async () => {
        const flow = await getFlow(region, a, b);
        if (disposed || viewer.isDestroyed()) return;
        if (!flow) {
          last = {
            ...last,
            region: regionKey(region),
            pair: `${a} > ${b}`,
            note: 'no flow for this pair — the warp would be a plain dissolve',
          };
          return;
        }

        // Flow is measured on a downsampled plane; the warp runs at the
        // region's full pixel size.
        const flowScale = region.widthPx / flow.planeWidth;
        const palette = useRadarStore.getState().palette;
        const divergence: Array<{ t: number; mean: number; peak: number }> = [];
        let totalMs = 0;
        let peakMs = 0;
        let coverage = 0;

        for (const t of SAMPLES) {
          if (disposed || viewer.isDestroyed()) return;
          const [warped, dissolved] = await Promise.all([
            warpRegion(a, b, region.level, region.x0, region.y0, region.nx, region.ny, t,
              palette,
              {
                cols: flow.cols,
                rows: flow.rows,
                u: flow.u,
                v: flow.v,
                confidence: flow.confidence,
                key: flow.key,
              },
              flowScale),
            warpRegion(a, b, region.level, region.x0, region.y0, region.nx, region.ny, t,
              palette, null, flowScale),
          ]);
          divergence.push({ t, ...alphaDelta(warped.bitmap, dissolved.bitmap) });
          totalMs += warped.ms;
          peakMs = Math.max(peakMs, warped.ms);
          coverage = warped.coverage;
          // Region bitmaps are large; release them rather than waiting for GC.
          warped.bitmap.close();
          dissolved.bitmap.close();
        }

        const su = flow.u.reduce((acc, u, c) => acc + u * flow.confidence[c], 0);
        const sv = flow.v.reduce((acc, v, c) => acc + v * flow.confidence[c], 0);
        const sw = flow.confidence.reduce((acc, w) => acc + w, 0) || 1;
        const interior = divergence.filter((d) => d.t > 0 && d.t < 1);
        // A few alpha levels averaged across every weather pixel is a real,
        // visible relocation of the echo; identical renders score exactly 0.
        const moved = interior.some((d) => d.mean > 2);
        last = {
          region: regionKey(region),
          pair: `${a} > ${b}`,
          coverage: +coverage.toFixed(3),
          meanMs: Math.round(totalMs / SAMPLES.length),
          peakMs,
          divergence,
          flowMeanU: +(su / sw).toFixed(2),
          flowMeanV: +(sv / sw).toFixed(2),
          note: moved
            ? `warp departs from the dissolve — motion is reaching the render`
            : 'warp matches the dissolve: flow present but not moving anything',
        };
      })()
        .catch((err) => {
          last = { ...last, note: `warp failed: ${String(err).slice(0, 140)}` };
        })
        .finally(() => {
          busy = false;
        });
    }, PROBE_MS);

    return () => {
      disposed = true;
      window.clearInterval(timer);
    };
  }, [viewer, active, host]);

  return null;
}
