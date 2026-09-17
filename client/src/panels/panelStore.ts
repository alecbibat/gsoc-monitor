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
  // Panels are "one at a time" by default: opening a new one closes every
  // panel that isn't locked. The lock button in the header flips this so a
  // window survives further clicks on the map.
  locked: boolean;
}

// What a caller hands to `open` — every layer stamps this onto its entities
// (see cesium/entityPanelLink). Position, size and z-order are assigned by the
// store. `locked` is optional: leave it off for a transient popup, pass true
// for a deliberately launched tool (the sidebar widgets) that should stay put.
export type PanelOpenData = Omit<
  PanelData,
  'x' | 'y' | 'width' | 'height' | 'z' | 'dockedTo' | 'locked'
> & { locked?: boolean };

interface PanelsState {
  panels: PanelData[];
  topZ: number;
  open: (panel: PanelOpenData) => void;
  close: (id: string) => void;
  closeAll: () => void;
  bringToFront: (id: string) => void;
  setLocked: (id: string, locked: boolean) => void;
  toggleLock: (id: string) => void;
  updateRect: (id: string, rect: Partial<Pick<PanelData, 'x' | 'y' | 'width' | 'height'>>) => void;
  dock: (id: string, zone: DockZone) => void;
  undock: (id: string, x?: number, y?: number) => void;
}

const DEFAULT_WIDTH = 360;
const DEFAULT_HEIGHT = 420;
const CASCADE_OFFSET = 32;

// Per-kind overrides so content-heavy panels open tall enough to avoid
// unnecessary scrolling on most screens.
const KIND_HEIGHTS: Partial<Record<PanelKind, number>> = {
  ships: 630,
  'wind-forecast': 560,
  rivers: 620,
};

// Cascade slots step down-left from the top-right corner. Take the first
// slot no surviving panel is sitting in, so a fresh popup never lands on top
// of a locked one; fall back to counting when all are taken. "Sitting in"
// means within one cascade step — a panel docked top-right or nudged by hand
// is a few pixels off the exact slot but still covers it.
function cascadeSlot(n: number): { x: number; y: number } {
  const margin = 24;
  const x =
    typeof window !== 'undefined'
      ? window.innerWidth - DEFAULT_WIDTH - margin - (n % 4) * CASCADE_OFFSET
      : 600;
  const y = margin + 64 + (n % 4) * CASCADE_OFFSET;
  return { x, y };
}

function cascadePos(kept: PanelData[]): { x: number; y: number } {
  for (let n = 0; n < 4; n++) {
    const slot = cascadeSlot(n);
    const taken = kept.some(
      (p) => Math.abs(p.x - slot.x) < CASCADE_OFFSET && Math.abs(p.y - slot.y) < CASCADE_OFFSET
    );
    if (!taken) return slot;
  }
  return cascadeSlot(kept.length);
}

export const usePanelStore = create<PanelsState>((set, get) => ({
  panels: [],
  topZ: 10,
  open: (panel) => {
    const { panels, topZ } = get();
    const existing = panels.find((p) => p.id === panel.id);
    const nextZ = topZ + 1;
    if (existing) {
      // Re-opening (clicking the same feature again) refreshes the data and
      // brings the window forward. It never closes anything, and it never
      // overrides the lock the user set on it.
      const { locked: _ignored, ...fresh } = panel;
      set({
        panels: panels.map((p) => (p.id === panel.id ? { ...p, ...fresh, z: nextZ } : p)),
        topZ: nextZ,
      });
      return;
    }

    const locked = panel.locked ?? false;
    // One popup at a time: a new transient panel replaces every other unlocked
    // one. Locked panels stay. A panel that opens locked (a sidebar widget)
    // is a tool, not a popup, so opening it closes nothing.
    const kept = locked ? panels : panels.filter((p) => p.locked);

    const rawH = KIND_HEIGHTS[panel.kind] ?? DEFAULT_HEIGHT;
    const maxH = typeof window !== 'undefined' ? window.innerHeight - 100 : DEFAULT_HEIGHT;
    const height = Math.min(rawH, maxH);
    const { x, y } = cascadePos(kept);

    set({
      panels: [
        ...kept,
        { ...panel, x, y, width: DEFAULT_WIDTH, height, z: nextZ, dockedTo: null, locked },
      ],
      topZ: nextZ,
    });
  },
  close: (id) => set({ panels: get().panels.filter((p) => p.id !== id) }),
  closeAll: () => set({ panels: [] }),
  bringToFront: (id) => {
    // Every mousedown inside a panel lands here — skip the array rebuild (and
    // the re-render of every open panel) when the target is already frontmost.
    const { panels, topZ } = get();
    const target = panels.find((p) => p.id === id);
    if (!target || target.z === topZ) return;
    const nextZ = topZ + 1;
    set({
      panels: panels.map((p) => (p.id === id ? { ...p, z: nextZ } : p)),
      topZ: nextZ,
    });
  },
  setLocked: (id, locked) =>
    set({ panels: get().panels.map((p) => (p.id === id ? { ...p, locked } : p)) }),
  toggleLock: (id) =>
    set({ panels: get().panels.map((p) => (p.id === id ? { ...p, locked: !p.locked } : p)) }),
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
