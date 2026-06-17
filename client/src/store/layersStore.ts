import { create } from 'zustand';
import { persist } from 'zustand/middleware';
import type { BasemapId, LayerId, SatelliteGroup } from '../types';

interface LayersState {
  active: Record<LayerId, boolean>;
  basemap: BasemapId;
  toggleLayer: (id: LayerId) => void;
  setBasemap: (id: BasemapId) => void;
  flightFavoritesOnly: boolean;
  setFlightFavoritesOnly: (v: boolean) => void;
  flightFavorites: string[];
  toggleFlightFavorite: (icao24: string) => void;
  shipFavoritesOnly: boolean;
  setShipFavoritesOnly: (v: boolean) => void;
  shipFavorites: string[];
  toggleShipFavorite: (mmsi: string) => void;
  shipPaths: boolean;
  setShipPaths: (v: boolean) => void;
  firesNearMiles: 0 | 50 | 100 | 200;
  setFiresNearMiles: (v: 0 | 50 | 100 | 200) => void;
  satelliteGroup: SatelliteGroup;
  setSatelliteGroup: (v: SatelliteGroup) => void;
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
        lightning: false,
        fires: false,
        ships: false,
        satellites: false,
        locations: true,
        osmBuildings: false,
        earth3d: false,
        traffic: false,
        timezones: false,
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
      shipFavoritesOnly: false,
      setShipFavoritesOnly: (v) => set({ shipFavoritesOnly: v }),
      shipFavorites: [],
      toggleShipFavorite: (mmsi) => {
        const current = get().shipFavorites;
        set({
          shipFavorites: current.includes(mmsi)
            ? current.filter((id) => id !== mmsi)
            : [...current, mmsi],
        });
      },
      shipPaths: true,
      setShipPaths: (v) => set({ shipPaths: v }),
      firesNearMiles: 0,
      setFiresNearMiles: (v) => set({ firesNearMiles: v }),
      satelliteGroup: 'stations',
      setSatelliteGroup: (v) => set({ satelliteGroup: v }),
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
        shipFavorites: state.shipFavorites,
        shipPaths: state.shipPaths,
        firesNearMiles: state.firesNearMiles,
        satelliteGroup: state.satelliteGroup,
      }),
    }
  )
);
