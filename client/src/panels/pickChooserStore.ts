import { create } from 'zustand';
import type { PanelData } from './panelStore';

// The shape every layer stamps onto its entities (see entityPanelLink).
export type PanelOpenData = Omit<PanelData, 'x' | 'y' | 'width' | 'height' | 'z' | 'dockedTo'>;

interface PickChooserState {
  open: boolean;
  x: number;
  y: number;
  items: PanelOpenData[];
  show: (items: PanelOpenData[], x: number, y: number) => void;
  hide: () => void;
}

// Holds the transient "multiple features under the cursor — pick one" popup.
export const usePickChooserStore = create<PickChooserState>((set) => ({
  open: false,
  x: 0,
  y: 0,
  items: [],
  show: (items, x, y) => set({ open: true, items, x, y }),
  hide: () => set({ open: false, items: [] }),
}));
