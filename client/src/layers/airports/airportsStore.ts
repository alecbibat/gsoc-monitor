import { create } from 'zustand';
import type { AirportTier } from './airportsMeta';

export const NO_AIRPORT_TIERS: Record<AirportTier, number> = {
  closure: 0,
  'ground-stop': 0,
  'ground-delay': 0,
  delay: 0,
  deicing: 0,
  notice: 0,
};

interface AirportsStatusState {
  /** Airports drawn. */
  count: number;
  /** Of those, how many are drawn in each tier (their worst event). */
  tiers: Record<AirportTier, number>;
  /** When the server last fetched from the FAA. */
  fetchedAt: string | null;
  error: string | null;
  setStatus: (partial: Partial<Pick<AirportsStatusState, 'count' | 'tiers' | 'fetchedAt' | 'error'>>) => void;
}

export const useAirportsStatus = create<AirportsStatusState>((set) => ({
  count: 0,
  tiers: { ...NO_AIRPORT_TIERS },
  fetchedAt: null,
  error: null,
  setStatus: (partial) => set(partial),
}));
