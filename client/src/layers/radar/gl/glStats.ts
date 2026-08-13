// Measurement harness for the Stage B go/no-go.
//
// The spike's acceptance criteria are numbers on real hardware — frame rate
// with two 4096-square textures resident, texture memory across keyframe swaps,
// survival of a context-loss cycle. None of them can be answered from a
// software rasterizer, so the spike ships its own instrumentation and the
// verdict is read off a real GPU rather than asserted.
//
// Exposed as `window.__radarGl()` when `?radargl=1` is on.

import type { WeatherPrimitiveStats } from './WeatherPrimitive';

export interface GlSpikeReport {
  enabled: boolean;
  gpu: string;
  /** Rolling frame rate measured from Cesium's postRender, over ~2s. */
  fps: number;
  fpsMin: number;
  fpsSamples: number;
  cameraHeightM: number;
  handoverGlAlpha: number;
  handoverTileAlpha: number;
  primitiveVisible: boolean;
  contextLossSurvived: boolean;
  primitive: WeatherPrimitiveStats | null;
  notes: string[];
}

const FPS_WINDOW_MS = 2000;

class GlStats {
  enabled = false;
  gpu = 'unknown';
  cameraHeightM = 0;
  handoverGlAlpha = 0;
  handoverTileAlpha = 1;
  primitiveVisible = false;
  contextLossSurvived = false;
  primitive: WeatherPrimitiveStats | null = null;
  private notes: string[] = [];

  private times: number[] = [];
  private fpsMin = Number.POSITIVE_INFINITY;

  note(message: string): void {
    if (!this.notes.includes(message)) this.notes.push(message);
  }

  tick(now: number): void {
    this.times.push(now);
    const cutoff = now - FPS_WINDOW_MS;
    while (this.times.length && this.times[0] < cutoff) this.times.shift();
    // Only trust the minimum once the window is genuinely full, otherwise the
    // first second of every session reports a fake low.
    if (this.times.length > 10) {
      const span = this.times[this.times.length - 1] - this.times[0];
      if (span > 0) this.fpsMin = Math.min(this.fpsMin, ((this.times.length - 1) / span) * 1000);
    }
  }

  get fps(): number {
    if (this.times.length < 2) return 0;
    const span = this.times[this.times.length - 1] - this.times[0];
    return span > 0 ? ((this.times.length - 1) / span) * 1000 : 0;
  }

  reset(): void {
    this.times = [];
    this.fpsMin = Number.POSITIVE_INFINITY;
  }

  report(): GlSpikeReport {
    return {
      enabled: this.enabled,
      gpu: this.gpu,
      fps: +this.fps.toFixed(1),
      fpsMin: Number.isFinite(this.fpsMin) ? +this.fpsMin.toFixed(1) : 0,
      fpsSamples: this.times.length,
      cameraHeightM: Math.round(this.cameraHeightM),
      handoverGlAlpha: +this.handoverGlAlpha.toFixed(3),
      handoverTileAlpha: +this.handoverTileAlpha.toFixed(3),
      primitiveVisible: this.primitiveVisible,
      contextLossSurvived: this.contextLossSurvived,
      primitive: this.primitive,
      notes: [...this.notes],
    };
  }
}

export const glStats = new GlStats();

// Installed once, so the console hook survives a viewer rebuild.
let installed = false;
export function installGlStatsHook(): void {
  if (installed) return;
  installed = true;
  (globalThis as unknown as Record<string, unknown>).__radarGl = () => glStats.report();
}
