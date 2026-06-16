import { create } from 'zustand';
import { persist } from 'zustand/middleware';
import type { BasemapId, LayerId } from '../types';

interface LayersState {
  active: Record<LayerId, boolean>;
  basemap: BasemapId;
  toggleLayer: (id: LayerId) => void;
  setBasemap: (id: BasemapId) => void;
  flightFavoritesOnly: boolean;
  setFlightFavoritesOnly: (v: boolean) => void;
  flightFavorites: string[];
  toggleFlightFavorite: (icao24: string) => void;
  earthquakeMagnitude: 'significant' | '4.5' | '2.5' | '1.0' | 'all';
  earthquakePeriod: 'hour' | 'day' | 'week';
  setEarthquakeFilter: (
    partial: Partial<{
      magnitude: LayersState['earthquakeMagnitude'];
      period: LayersState['earthquakePeriod'];
    }>
  ) => void;
}

export const useLayersStore = create<LayersState>()(
  persist(
    (set, get) => ({
      active: {
        radar: false,
        earthquakes: true,
        alerts: true,
        flights: false,
        hurricanes: true,
      },
      basemap: 'dark',
      toggleLayer: (id) =>
        set((state) => ({ active: { ...state.active, [id]: !state.active[id] } })),
      setBasemap: (id) => set({ basemap: id }),
      flightFavoritesOnly: false,
      setFlightFavoritesOnly: (v) => set({ flightFavoritesOnly: v }),
      flightFavorites: [],
      toggleFlightFavorite: (icao24) => {
        const current = get().flightFavorites;
        set({
          flightFavorites: current.includes(icao24)
            ? current.filter((id) => id !== icao24)
            : [...current, icao24],
        });
      },
      earthquakeMagnitude: '2.5',
      earthquakePeriod: 'day',
      setEarthquakeFilter: (partial) =>
        set((state) => ({
          earthquakeMagnitude: partial.magnitude ?? state.earthquakeMagnitude,
          earthquakePeriod: partial.period ?? state.earthquakePeriod,
        })),
    }),
    {
      name: 'gsoc-layers',
      partialize: (state) => ({
        active: state.active,
        basemap: state.basemap,
        flightFavorites: state.flightFavorites,
      }),
    }
  )
);
