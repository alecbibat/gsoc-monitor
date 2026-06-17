import { create } from 'zustand';
import { persist } from 'zustand/middleware';

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

interface PerfState {
  qualityLevel: QualityLevel;
  setQualityLevel: (v: QualityLevel) => void;
}

export const usePerfStore = create<PerfState>()(
  persist(
    (set) => ({
      qualityLevel: 'quality',
      setQualityLevel: (qualityLevel) => set({ qualityLevel }),
    }),
    {
      name: 'gsoc-perf',
      version: 1,
      // v0 stored { performanceMode: boolean }; map it onto the new scale.
      migrate: (persisted, version) => {
        if (version < 1 && persisted && typeof persisted === 'object') {
          const old = persisted as { performanceMode?: boolean };
          return { qualityLevel: old.performanceMode ? 'max-performance' : 'quality' };
        }
        return persisted as PerfState;
      },
    }
  )
);
