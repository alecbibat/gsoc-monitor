import { create } from 'zustand';
import type { PanelKind } from '../types';

export interface PanelData {
  id: string;
  kind: PanelKind;
  title: string;
  subtitle?: string;
  payload: Record<string, unknown>;
  x: number;
  y: number;
  width: number;
  height: number;
  z: number;
}

interface PanelsState {
  panels: PanelData[];
  topZ: number;
  open: (panel: Omit<PanelData, 'x' | 'y' | 'width' | 'height' | 'z'>) => void;
  close: (id: string) => void;
  closeAll: () => void;
  bringToFront: (id: string) => void;
  updateRect: (id: string, rect: Partial<Pick<PanelData, 'x' | 'y' | 'width' | 'height'>>) => void;
}

const DEFAULT_WIDTH = 360;
const DEFAULT_HEIGHT = 420;
const CASCADE_OFFSET = 32;

export const usePanelStore = create<PanelsState>((set, get) => ({
  panels: [],
  topZ: 10,
  open: (panel) => {
    const existing = get().panels.find((p) => p.id === panel.id);
    const nextZ = get().topZ + 1;
    if (existing) {
      set({
        panels: get().panels.map((p) => (p.id === panel.id ? { ...p, ...panel, z: nextZ } : p)),
        topZ: nextZ,
      });
      return;
    }

    const dockedCount = get().panels.length;
    const margin = 24;
    const x =
      typeof window !== 'undefined'
        ? window.innerWidth - DEFAULT_WIDTH - margin - (dockedCount % 4) * CASCADE_OFFSET
        : 600;
    const y = margin + 64 + (dockedCount % 4) * CASCADE_OFFSET;

    set({
      panels: [
        ...get().panels,
        { ...panel, x, y, width: DEFAULT_WIDTH, height: DEFAULT_HEIGHT, z: nextZ },
      ],
      topZ: nextZ,
    });
  },
  close: (id) => set({ panels: get().panels.filter((p) => p.id !== id) }),
  closeAll: () => set({ panels: [] }),
  bringToFront: (id) => {
    const nextZ = get().topZ + 1;
    set({
      panels: get().panels.map((p) => (p.id === id ? { ...p, z: nextZ } : p)),
      topZ: nextZ,
    });
  },
  updateRect: (id, rect) =>
    set({
      panels: get().panels.map((p) => (p.id === id ? { ...p, ...rect } : p)),
    }),
}));
