// Single source of truth for the tracked Windstar fleet on the client side —
// used by the sidebar roster and anywhere else that needs ship identity without
// a live AIS position. MMSIs match server/src/routes/ships.ts and the keys in
// ShipClassCard's PROFILES.
export interface FleetRosterShip {
  mmsi: string;
  name: string;
  cls: 'STAR' | 'WIND';
}

export const STAR_COLOR = '#38bdf8';
export const WIND_COLOR = '#fbbf24';

export const FLEET_ROSTER: FleetRosterShip[] = [
  { mmsi: '311083000', name: 'Star Breeze', cls: 'STAR' },
  { mmsi: '311085000', name: 'Star Legend', cls: 'STAR' },
  { mmsi: '311084000', name: 'Star Pride', cls: 'STAR' },
  { mmsi: '311001759', name: 'Star Seeker', cls: 'STAR' },
  { mmsi: '309056000', name: 'Wind Spirit', cls: 'WIND' },
  { mmsi: '309163000', name: 'Wind Star', cls: 'WIND' },
  { mmsi: '309242000', name: 'Wind Surf', cls: 'WIND' },
];

export const fleetColor = (cls: 'STAR' | 'WIND'): string =>
  cls === 'STAR' ? STAR_COLOR : WIND_COLOR;
