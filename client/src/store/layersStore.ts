import { create } from 'zustand';
import { persist } from 'zustand/middleware';
import type { BasemapId, FlightGroupId, LayerId, SatelliteGroup } from '../types';

interface LayersState {
  active: Record<LayerId, boolean>;
  basemap: BasemapId;
  toggleLayer: (id: LayerId) => void;
  setBasemap: (id: BasemapId) => void;
  flightFavoritesOnly: boolean;
  setFlightFavoritesOnly: (v: boolean) => void;
  flightFavorites: string[];
  toggleFlightFavorite: (icao24: string) => void;
  flightGroups: Record<FlightGroupId, boolean>;
  toggleFlightGroup: (g: FlightGroupId) => void;
  shipFavoritesOnly: boolean;
  setShipFavoritesOnly: (v: boolean) => void;
  shipFavorites: string[];
  toggleShipFavorite: (mmsi: string) => void;
  shipPaths: boolean;
  setShipPaths: (v: boolean) => void;
  shipNames: boolean;
  setShipNames: (v: boolean) => void;
  firesNearMiles: 0 | 5 | 50 | 100 | 200;
  setFiresNearMiles: (v: 0 | 5 | 50 | 100 | 200) => void;
  // 0 = global (all geocoded events); >0 = only events within N miles of a pin.
  newsNearMiles: 0 | 100 | 250 | 500;
  setNewsNearMiles: (v: 0 | 100 | 250 | 500) => void;
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
        earthquakes: true,
        alerts: true,
        flights: false,
        hurricanes: true,
        lightning: false,
        fires: false,
        smoke: false,
        aqi: false,
        fuel: false,
        ships: false,
        satellites: false,
        locations: true,
        osmBuildings: false,
        earth3d: false,
        timezones: false,
        newsMap: false,
        wind: false,
        windArrows: false,
        rivers: false,
        fireOutlook: false,
        radar: false,
        precip: false,
        wildfires: false,
        outages: false,
        intel: false,
      },
      basemap: 'dark',
      toggleLayer: (id) =>
        set((state) => ({ active: { ...state.active, [id]: !state.active[id] } })),
      setBasemap: (id) => set({ basemap: id }),
      flightFavoritesOnly: false,
      setFlightFavoritesOnly: (v) => set({ flightFavoritesOnly: v }),
      flightGroups: { company: true, 'hurricane-hunters': true, 'fire-tankers': true },
      toggleFlightGroup: (g) =>
        set((state) => ({
          flightGroups: { ...state.flightGroups, [g]: !state.flightGroups[g] },
        })),
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
      shipNames: true,
      setShipNames: (v) => set({ shipNames: v }),
      firesNearMiles: 0,
      setFiresNearMiles: (v) => set({ firesNearMiles: v }),
      newsNearMiles: 0,
      setNewsNearMiles: (v) => set({ newsNearMiles: v }),
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
        flightFavoritesOnly: state.flightFavoritesOnly,
        flightFavorites: state.flightFavorites,
        flightGroups: state.flightGroups,
        shipFavoritesOnly: state.shipFavoritesOnly,
        shipFavorites: state.shipFavorites,
        shipPaths: state.shipPaths,
        shipNames: state.shipNames,
        firesNearMiles: state.firesNearMiles,
        newsNearMiles: state.newsNearMiles,
        satelliteGroup: state.satelliteGroup,
        earthquakeMagnitude: state.earthquakeMagnitude,
        earthquakePeriod: state.earthquakePeriod,
      }),
      // Layers whose UI control has been removed are forced off on every
      // hydration, so a value persisted from before the control was pulled can
      // never auto-activate (earth3d: metered Google API) or wedge itself on
      // with no toggle left to clear it (newsMap/intel: the Open-Source Intel
      // menu group was removed; the share page still drives these flags itself
      // via applyShareLayerFlags under its own storage key).
      merge: (persisted, current) => {
        const p = (persisted ?? {}) as Partial<LayersState>;
        return {
          ...current,
          ...p,
          active: {
            ...current.active,
            ...(p.active ?? {}),
            earth3d: false,
            newsMap: false,
            intel: false,
          },
        } as LayersState;
      },
    }
  )
);
