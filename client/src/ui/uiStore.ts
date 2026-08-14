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

// Width of the crisis incident-editor panel (px), persisted. null = the
// default responsive width (46vw clamped). Set by the panel's drag handle and
// expand toggle; ignored on mobile where the panel is always full-width.
interface CrisisPanelState {
  widthPx: number | null;
  setWidthPx: (px: number | null) => void;
}

export const useCrisisPanelStore = create<CrisisPanelState>()(
  persist(
    (set) => ({
      widthPx: null,
      setWidthPx: (widthPx) => set({ widthPx }),
    }),
    { name: 'gsoc-crisis-panel' }
  )
);
