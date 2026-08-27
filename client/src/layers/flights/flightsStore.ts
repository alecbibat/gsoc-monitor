import { create } from 'zustand';
import type { FlightEvent, FlightState } from '../../types';

interface FlightsStatusState {
  tooWideView: boolean;
  /** Aircraft currently drawn (after group filters). */
  count: number;
  /** Size of the full tracked roster. */
  total: number;
  error: string | null;
  /**
   * Latest full flight list from the poll, so surfaces outside the layer (the
   * details panel) can render live state instead of a click-time snapshot —
   * late-arriving airframe lookups and the "last seen" clock included.
   */
  flights: FlightState[];
  /** Takeoff/landing feed, newest first. */
  events: FlightEvent[];
  setStatus: (
    partial: Partial<Pick<FlightsStatusState, 'tooWideView' | 'count' | 'total' | 'error'>>
  ) => void;
  setFlights: (flights: FlightState[], events: FlightEvent[]) => void;
}

export const useFlightsStatus = create<FlightsStatusState>((set) => ({
  tooWideView: false,
  count: 0,
  total: 0,
  error: null,
  flights: [],
  events: [],
  setStatus: (partial) => set(partial),
  setFlights: (flights, events) => set({ flights, events }),
}));
