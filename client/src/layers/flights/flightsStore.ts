import { create } from 'zustand';
import type { FlightState } from '../../types';

interface FlightsStatusState {
  tooWideView: boolean;
  count: number;
  error: string | null;
  /**
   * Latest full flight list from the poll, so surfaces outside the layer (the
   * details panel) can render live state instead of a click-time snapshot —
   * late-arriving airframe lookups and the "last seen" clock included.
   */
  flights: FlightState[];
  setStatus: (
    partial: Partial<Pick<FlightsStatusState, 'tooWideView' | 'count' | 'error'>>
  ) => void;
  setFlights: (flights: FlightState[]) => void;
}

export const useFlightsStatus = create<FlightsStatusState>((set) => ({
  tooWideView: false,
  count: 0,
  error: null,
  flights: [],
  setStatus: (partial) => set(partial),
  setFlights: (flights) => set({ flights }),
}));
