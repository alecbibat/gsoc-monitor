import { create } from 'zustand';
import { persist } from 'zustand/middleware';

// Performance mode trades visual fidelity (resolution, anti-aliasing, terrain
// detail, atmosphere/lighting) for frame rate — aimed at thin clients and
// integrated GPUs. Persisted so the choice survives reloads.
interface PerfState {
  performanceMode: boolean;
  setPerformanceMode: (v: boolean) => void;
  toggle: () => void;
}

export const usePerfStore = create<PerfState>()(
  persist(
    (set) => ({
      performanceMode: false,
      setPerformanceMode: (performanceMode) => set({ performanceMode }),
      toggle: () => set((s) => ({ performanceMode: !s.performanceMode })),
    }),
    { name: 'gsoc-perf' }
  )
);
