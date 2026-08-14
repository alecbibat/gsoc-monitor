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
