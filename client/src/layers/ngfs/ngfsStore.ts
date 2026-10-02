import { create } from 'zustand';
import type { NgfsProductStatus } from '../../types';

interface NgfsStatusState {
  count: number; // pixels drawn
  hiddenOther: number; // non-wildland pixels left off the map
  newestScan: number | null; // newest scan either satellite has published, epoch ms
  windowStart: number | null;
  products: NgfsProductStatus[];
  loading: boolean; // no answer yet, or the server is still on its first fetch
  error: string | null;
  setStatus: (
    partial: Partial<Omit<NgfsStatusState, 'setStatus' | 'reset'>>
  ) => void;
  reset: () => void;
}

const EMPTY = {
  count: 0,
  hiddenOther: 0,
  newestScan: null,
  windowStart: null,
  products: [],
  loading: false,
  error: null,
};

export const useNgfsStatus = create<NgfsStatusState>((set) => ({
  ...EMPTY,
  setStatus: (partial) => set(partial),
  reset: () => set(EMPTY),
}));
