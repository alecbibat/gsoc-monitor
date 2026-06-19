// One-time WebGL GPU probe. Two jobs:
//   1. Auto-pick a render-quality tier on weak / software-rendered clients
//      (see recommendQuality in perfStore) so a thin client isn't trying to run
//      the full-fat renderer it can't sustain.
//   2. Explain *why* the globe black-screens. A black globe is a lost WebGL
//      context: the driver gives up mid-frame and the browser tears the canvas
//      down. Thin clients commonly fall back to a CPU rasterizer (SwiftShader /
//      llvmpipe) or a virtualized GPU (Citrix / VMware / RDP), where the heavy
//      renderer overruns the driver watchdog (TDR) and loses the context.
//
// The probe runs once, on a throwaway canvas, and the result is cached.

export type GpuTier = 'low' | 'medium' | 'high';

export interface GpuInfo {
  renderer: string; // UNMASKED_RENDERER_WEBGL, best-effort (may be 'hidden')
  vendor: string; // UNMASKED_VENDOR_WEBGL, best-effort
  software: boolean; // CPU rasterizer — no real GPU acceleration
  virtualized: boolean; // remote / virtual GPU (Citrix, VMware, RDP, virgl)
  majorPerformanceCaveat: boolean; // browser itself flags this context as slow
  maxTextureSize: number; // rough capability signal
  webgl2: boolean;
  tier: GpuTier;
}

let cached: GpuInfo | null = null;

// SwiftShader (Chrome's software GL), llvmpipe/softpipe (Mesa), WARP (Windows),
// "Microsoft Basic Render" — all mean there is no usable GPU.
const SOFTWARE_RE = /swiftshader|llvmpipe|softpipe|software|basic render|microsoft basic|mesa offscreen|warp/i;
// Markers of a remote/virtual display where WebGL is emulated or fragile.
const VIRTUAL_RE = /vmware|virtualbox|virgl|paravirtual|gdi generic|citrix|microsoft remote/i;
// Reasonably capable discrete / Apple-silicon GPUs.
const STRONG_RE = /nvidia|geforce|quadro|rtx|radeon (rx|pro)|apple m\d|apple gpu|arc a\d/i;

export function getGpuInfo(): GpuInfo {
  if (!cached) cached = probe();
  return cached;
}

// A short human-readable summary for logs / the diagnostics readout.
export function describeGpu(info: GpuInfo): string {
  const bits: string[] = [];
  if (info.software) bits.push('software rendering');
  else if (info.virtualized) bits.push('virtual GPU');
  if (info.majorPerformanceCaveat && !info.software) bits.push('slow-context');
  const tag = bits.length ? ` (${bits.join(', ')})` : '';
  return `${info.renderer || 'unknown GPU'}${tag}`;
}

function probe(): GpuInfo {
  const fallback: GpuInfo = {
    renderer: 'unknown',
    vendor: 'unknown',
    software: false,
    virtualized: false,
    majorPerformanceCaveat: false,
    maxTextureSize: 0,
    webgl2: false,
    tier: 'medium',
  };

  try {
    const canvas = document.createElement('canvas');
    const gl =
      (canvas.getContext('webgl2') as WebGL2RenderingContext | null) ||
      (canvas.getContext('webgl') as WebGLRenderingContext | null);

    if (!gl) {
      // No WebGL at all — the weakest possible client.
      return { ...fallback, software: true, tier: 'low' };
    }

    const webgl2 =
      typeof WebGL2RenderingContext !== 'undefined' && gl instanceof WebGL2RenderingContext;
    const dbg = gl.getExtension('WEBGL_debug_renderer_info');
    const renderer = dbg ? String(gl.getParameter(dbg.UNMASKED_RENDERER_WEBGL) || '') : '';
    const vendor = dbg ? String(gl.getParameter(dbg.UNMASKED_VENDOR_WEBGL) || '') : '';
    const maxTextureSize = (gl.getParameter(gl.MAX_TEXTURE_SIZE) as number) || 0;

    // Ask for a context the browser would *refuse* if it were slow. If that
    // refusal happens while a normal context succeeds, we're on a software /
    // heavily-degraded path even when the renderer string is masked.
    let majorPerformanceCaveat = false;
    try {
      const c2 = document.createElement('canvas');
      const strict =
        c2.getContext('webgl', { failIfMajorPerformanceCaveat: true }) ||
        c2.getContext('webgl2', { failIfMajorPerformanceCaveat: true });
      majorPerformanceCaveat = !strict;
      loseCtx(strict as WebGLRenderingContext | null);
    } catch {
      majorPerformanceCaveat = false;
    }

    const software = SOFTWARE_RE.test(renderer) || SOFTWARE_RE.test(vendor);
    const virtualized = VIRTUAL_RE.test(renderer) || VIRTUAL_RE.test(vendor);

    let tier: GpuTier;
    if (software || majorPerformanceCaveat || maxTextureSize <= 4096) {
      tier = 'low';
    } else if (STRONG_RE.test(renderer) && maxTextureSize >= 16384 && !virtualized) {
      tier = 'high';
    } else {
      tier = virtualized ? 'low' : 'medium';
    }

    loseCtx(gl);
    return {
      renderer: renderer || (dbg ? 'unknown' : 'hidden'),
      vendor: vendor || (dbg ? 'unknown' : 'hidden'),
      software,
      virtualized,
      majorPerformanceCaveat,
      maxTextureSize,
      webgl2,
      tier,
    };
  } catch {
    return fallback;
  }
}

function loseCtx(gl: WebGLRenderingContext | WebGL2RenderingContext | null) {
  try {
    gl?.getExtension('WEBGL_lose_context')?.loseContext();
  } catch {
    /* nothing to release */
  }
}
