import { create } from 'zustand';
import { persist } from 'zustand/middleware';
import { getGpuInfo, type GpuInfo } from './gpuInfo';

// Render quality scale: trades visual fidelity (resolution, anti-aliasing,
// terrain detail, atmosphere/lighting) for frame rate. Ordered best → fastest;
// the slider index maps straight into QUALITY_LEVELS. Persisted so the choice
// survives reloads (migrated from the old boolean performanceMode).
export type QualityLevel = 'quality' | 'balanced' | 'performance' | 'max-performance';

export const QUALITY_LEVELS: QualityLevel[] = [
  'quality',
  'balanced',
  'performance',
  'max-performance',
];

export interface QualitySettings {
  resolutionScale: number;
  fxaa: boolean;
  msaa: number;
  maximumScreenSpaceError: number;
  lighting: boolean;
  atmosphere: boolean;
  fog: boolean;
}

// What each level actually applies to the Cesium scene.
export const QUALITY_SETTINGS: Record<QualityLevel, QualitySettings> = {
  quality: {
    resolutionScale: 1,
    fxaa: true,
    msaa: 4,
    maximumScreenSpaceError: 2,
    lighting: true,
    atmosphere: true,
    fog: true,
  },
  balanced: {
    resolutionScale: 1,
    fxaa: true,
    msaa: 2,
    maximumScreenSpaceError: 2.5,
    lighting: true,
    atmosphere: true,
    fog: true,
  },
  performance: {
    resolutionScale: 0.85,
    fxaa: true,
    msaa: 1,
    maximumScreenSpaceError: 3,
    lighting: false,
    atmosphere: true,
    fog: true,
  },
  'max-performance': {
    resolutionScale: 0.65,
    fxaa: false,
    msaa: 1,
    maximumScreenSpaceError: 4,
    lighting: false,
    atmosphere: false,
    fog: false,
  },
};

// Short label + one-line description for the slider UI.
export const QUALITY_META: Record<QualityLevel, { label: string; desc: string }> = {
  quality: { label: 'Quality', desc: 'Full resolution, MSAA, lighting & atmosphere' },
  balanced: { label: 'Balanced', desc: 'Full resolution, lighter anti-aliasing' },
  performance: { label: 'Performance', desc: 'Reduced resolution, lighting off' },
  'max-performance': {
    label: 'Max Performance',
    desc: '⅔ resolution, no AA/atmosphere · highest FPS',
  },
};

// Map a detected GPU to a sensible starting tier. Software / "slow-context"
// clients get the lightest renderer (they're the ones that black-screen);
// low/virtual GPUs drop lighting and resolution; mid keeps full resolution with
// lighter AA; only genuinely capable GPUs start at full Quality.
export function recommendQuality(info: GpuInfo): QualityLevel {
  if (info.software || info.majorPerformanceCaveat) return 'max-performance';
  if (info.tier === 'low') return 'performance';
  if (info.tier === 'medium') return 'balanced';
  return 'quality';
}

interface PerfState {
  qualityLevel: QualityLevel;
  // True once the user has moved the slider themselves. Until then we're free to
  // auto-pick a tier from the detected GPU on each load.
  userSelected: boolean;
  setQualityLevel: (v: QualityLevel) => void;
  // Apply the GPU-recommended tier unless the user has made an explicit choice.
  // Safe to call repeatedly; it's a no-op once userSelected is true.
  autoTune: () => void;
}

export const usePerfStore = create<PerfState>()(
  persist(
    (set, get) => ({
      qualityLevel: 'quality',
      userSelected: false,
      setQualityLevel: (qualityLevel) => set({ qualityLevel, userSelected: true }),
      autoTune: () => {
        if (get().userSelected) return;
        const rec = recommendQuality(getGpuInfo());
        if (rec !== get().qualityLevel) set({ qualityLevel: rec });
      },
    }),
    {
      name: 'gsoc-perf',
      version: 2,
      // v0 stored { performanceMode: boolean }; v1 stored { qualityLevel } with
      // no userSelected flag. In both cases, treat a non-default tier as a
      // deliberate choice (lock it) and the default 'quality' as untouched (so
      // auto-tuning can still rescue a weak client that never moved the slider).
      migrate: (persisted, version) => {
        const p = (persisted ?? {}) as Record<string, unknown>;
        if (version < 1) {
          const q: QualityLevel = p.performanceMode ? 'max-performance' : 'quality';
          return { qualityLevel: q, userSelected: q !== 'quality' } as PerfState;
        }
        if (version < 2) {
          const q = (p.qualityLevel as QualityLevel) ?? 'quality';
          return { qualityLevel: q, userSelected: q !== 'quality' } as PerfState;
        }
        return p as unknown as PerfState;
      },
    }
  )
);
