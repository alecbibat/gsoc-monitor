import { create } from 'zustand';

// Small UI-chrome store. Currently just the mobile sidebar drawer state; the
// drawer is always visible on md+ screens and toggled here on small screens.
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
