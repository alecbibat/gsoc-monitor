import { create } from 'zustand';
import type { RoadSourceStatus } from '../../types';

interface RoadsStatusState {
  closed: number;
  restricted: number;
  sources: RoadSourceStatus[];
  /** When the server assembled the list. */
  fetchedAt: string | null;
  error: string | null;
  setStatus: (partial: Partial<Pick<RoadsStatusState, 'closed' | 'restricted' | 'sources' | 'fetchedAt' | 'error'>>) => void;
}

export const useRoadsStatus = create<RoadsStatusState>((set) => ({
  closed: 0,
  restricted: 0,
  sources: [],
  fetchedAt: null,
  error: null,
  setStatus: (partial) => set(partial),
}));
