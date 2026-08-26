import { create } from 'zustand';
import { persist } from 'zustand/middleware';

// Small UI-chrome store: the mobile sidebar drawer state.
interface UiState {
  sidebarOpen: boolean;
  setSidebarOpen: (v: boolean) => void;
  toggleSidebar: () => void;
}

export const useUiStore = create<UiState>((set) => ({
  sidebarOpen: false,
  setSidebarOpen: (sidebarOpen) => set({ sidebarOpen }),
  toggleSidebar: () => set((s) => ({ sidebarOpen: !s.sidebarOpen })),
}));

// Collapsed/expanded state of the sidebar's sections, persisted so the menu
// comes back the way the operator left it. Keyed by section title (titles are
// stable identifiers in Sidebar); absent key = the section's default state.
interface SectionsState {
  collapsed: Record<string, boolean>;
  setCollapsed: (key: string, collapsed: boolean) => void;
}

export const useSectionsStore = create<SectionsState>()(
  persist(
    (set) => ({
      collapsed: {},
      setCollapsed: (key, isCollapsed) =>
        set((s) => ({ collapsed: { ...s.collapsed, [key]: isCollapsed } })),
    }),
    { name: 'gsoc-sidebar-sections' }
  )
);

// Chrome state for the crisis workspace's live-map dock — the right-hand
// column that frames the globe while an incident is open. Width and collapsed
// are persisted; ignored on mobile where the workspace is always full-width.
interface CrisisDockState {
  widthPx: number;
  collapsed: boolean;
  setWidthPx: (px: number) => void;
  setCollapsed: (collapsed: boolean) => void;
}

export const CRISIS_DOCK_DEFAULT_WIDTH = 440;

export const useCrisisDockStore = create<CrisisDockState>()(
  persist(
    (set) => ({
      widthPx: CRISIS_DOCK_DEFAULT_WIDTH,
      collapsed: false,
      setWidthPx: (widthPx) => set({ widthPx }),
      setCollapsed: (collapsed) => set({ collapsed }),
    }),
    { name: 'gsoc-crisis-dock' }
  )
);

// Runtime-only screen rect of the dock's transparent map window. The dock
// publishes it while mounted; the globe's container in App.tsx pins itself to
// this rect, so the one live Cesium viewer keeps rendering — and stays
// interactive — inside the dock's frame instead of behind the workspace.
export interface MapFrameRect {
  left: number;
  top: number;
  width: number;
  height: number;
}

interface CrisisMapFrameState {
  rect: MapFrameRect | null;
  setRect: (rect: MapFrameRect | null) => void;
}

export const useCrisisMapFrameStore = create<CrisisMapFrameState>((set) => ({
  rect: null,
  setRect: (rect) => set({ rect }),
}));
