import { create } from 'zustand';

// Small UI-chrome store. Holds the mobile sidebar drawer state plus a measured
// layout value the pins-screensaver watch column needs.
interface UiState {
  sidebarOpen: boolean;
  setSidebarOpen: (v: boolean) => void;
  toggleSidebar: () => void;
  // Viewport-Y (px) of the bottom edge of the TopBar's right-hand cluster
  // (search bar + "i" info button). The pins-screensaver watch column starts
  // below this so it never overlaps them, however the cluster wraps at the
  // current viewport width. Updated by TopBar via a ResizeObserver.
  topRightBottom: number;
  setTopRightBottom: (v: number) => void;
}

export const useUiStore = create<UiState>((set) => ({
  sidebarOpen: false,
  setSidebarOpen: (sidebarOpen) => set({ sidebarOpen }),
  toggleSidebar: () => set((s) => ({ sidebarOpen: !s.sidebarOpen })),
  topRightBottom: 0,
  setTopRightBottom: (topRightBottom) => set({ topRightBottom }),
}));
