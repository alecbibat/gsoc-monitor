import { create } from 'zustand';
import type { PanelKind } from '../types';

export type DockZone = 'tr' | 'br' | 'tl' | 'bl';

export const ZONES: DockZone[] = ['tr', 'br', 'tl', 'bl'];

export const ZONE_LABELS: Record<DockZone, string> = {
  tr: 'Dock top-right',
  br: 'Dock bottom-right',
  tl: 'Dock top-left',
  bl: 'Dock bottom-left',
};

const SIDEBAR_W = 288;
const TOPBAR_H = 80;
const EDGE_MARGIN = 20;

export function dockPos(zone: DockZone, w: number, h: number): { x: number; y: number } {
  const W = typeof window !== 'undefined' ? window.innerWidth : 1200;
  const H = typeof window !== 'undefined' ? window.innerHeight : 800;
  switch (zone) {
    case 'tr': return { x: W - w - EDGE_MARGIN, y: TOPBAR_H + EDGE_MARGIN };
    case 'br': return { x: W - w - EDGE_MARGIN, y: H - h - EDGE_MARGIN };
    case 'tl': return { x: SIDEBAR_W + EDGE_MARGIN, y: TOPBAR_H + EDGE_MARGIN };
    case 'bl': return { x: SIDEBAR_W + EDGE_MARGIN, y: H - h - EDGE_MARGIN };
  }
}

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
  dockedTo: DockZone | null;
}

interface PanelsState {
  panels: PanelData[];
  topZ: number;
  open: (panel: Omit<PanelData, 'x' | 'y' | 'width' | 'height' | 'z' | 'dockedTo'>) => void;
  close: (id: string) => void;
  closeAll: () => void;
  bringToFront: (id: string) => void;
  updateRect: (id: string, rect: Partial<Pick<PanelData, 'x' | 'y' | 'width' | 'height'>>) => void;
  dock: (id: string, zone: DockZone) => void;
  undock: (id: string, x?: number, y?: number) => void;
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
        { ...panel, x, y, width: DEFAULT_WIDTH, height: DEFAULT_HEIGHT, z: nextZ, dockedTo: null },
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
  dock: (id, zone) => {
    set({
      panels: get().panels.map((p) => {
        if (p.id !== id) return p;
        return { ...p, ...dockPos(zone, p.width, p.height), dockedTo: zone };
      }),
    });
  },
  undock: (id, x?, y?) => {
    set({
      panels: get().panels.map((p) =>
        p.id === id
          ? { ...p, dockedTo: null, ...(x !== undefined && y !== undefined ? { x, y } : {}) }
          : p
      ),
    });
  },
}));
