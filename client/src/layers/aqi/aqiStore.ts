import { create } from 'zustand';

interface AqiState {
  count: number; // visible stations
  airnowCount: number;
  purpleairCount: number;
  worstAqi: number;
  worstCategory: string;
  noKey: boolean; // AirNow key missing
  purpleAirNoKey: boolean; // PurpleAir key missing
  error: string | null;
  // Per-source visibility (client-side filter; no refetch on toggle).
  showAirnow: boolean;
  showPurpleair: boolean;
  setStatus: (
    partial: Partial<Omit<AqiState, 'setStatus' | 'toggleSource'>>
  ) => void;
  toggleSource: (source: 'airnow' | 'purpleair') => void;
}

export const useAqiStatus = create<AqiState>()((set) => ({
  count: 0,
  airnowCount: 0,
  purpleairCount: 0,
  worstAqi: 0,
  worstCategory: '',
  noKey: false,
  purpleAirNoKey: false,
  error: null,
  showAirnow: true,
  showPurpleair: true,
  setStatus: (partial) => set((s) => ({ ...s, ...partial })),
  toggleSource: (source) =>
    set((s) =>
      source === 'airnow' ? { showAirnow: !s.showAirnow } : { showPurpleair: !s.showPurpleair }
    ),
}));
