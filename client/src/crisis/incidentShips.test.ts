import { describe, expect, it } from 'vitest';
import {
  SHIP_GROUP_ID,
  incidentShipMmsis,
  incidentShips,
  incidentVessels,
  isShipGroupId,
  shipListText,
  shipLocationGroup,
} from './incidentShips';
import { FLEET_ROSTER } from '../layers/ships/fleet';
import type { ShipState } from '../types';

const STAR_BREEZE = '311083000';
const WIND_SURF = '309242000';
const STAR_PRIDE = '311084000';

function pos(mmsi: string, lat: number, lon: number): ShipState {
  return {
    mmsi,
    imo: null,
    name: FLEET_ROSTER.find((s) => s.mmsi === mmsi)?.name ?? null,
    callsign: null,
    shipType: 60,
    latitude: lat,
    longitude: lon,
    speedKt: 12,
    heading: 90,
    course: 90,
    navStatus: 0,
    destination: null,
    lastSeenSec: 60,
  };
}

describe('incidentShips', () => {
  it('drops unknown MMSIs, dedupes, and returns fleet order', () => {
    const ships = incidentShips([WIND_SURF, 'not-a-ship', STAR_BREEZE, WIND_SURF]);
    expect(ships.map((s) => s.name)).toEqual(['Star Breeze', 'Wind Surf']);
    expect(incidentShipMmsis([WIND_SURF, STAR_BREEZE])).toEqual([STAR_BREEZE, WIND_SURF]);
  });

  it('tolerates missing, empty and malformed lists', () => {
    expect(incidentShips(undefined)).toEqual([]);
    expect(incidentShips(null)).toEqual([]);
    expect(incidentShips([])).toEqual([]);
    expect(incidentShips([42, { mmsi: STAR_BREEZE }])).toEqual([]);
  });

  it('identifies the fleet pseudo-group id', () => {
    expect(isShipGroupId(SHIP_GROUP_ID)).toBe(true);
    expect(isShipGroupId('windstar')).toBe(false); // the shore-side office group
    expect(isShipGroupId(null)).toBe(false);
  });
});

describe('incidentVessels', () => {
  it('pairs each selected ship with its live position, null when unreported', () => {
    const vessels = incidentVessels([STAR_BREEZE, WIND_SURF], [pos(STAR_BREEZE, 20, -155)]);
    expect(vessels.map((v) => v.roster.name)).toEqual(['Star Breeze', 'Wind Surf']);
    expect(vessels[0].ship?.latitude).toBe(20);
    expect(vessels[1].ship).toBeNull();
    expect(vessels[0].color).not.toBe(vessels[1].color); // Star vs Wind class
  });

  it('ignores positions for ships the incident did not select', () => {
    const vessels = incidentVessels([STAR_BREEZE], [pos(WIND_SURF, 1, 1), pos(STAR_BREEZE, 2, 2)]);
    expect(vessels).toHaveLength(1);
    expect(vessels[0].ship?.latitude).toBe(2);
  });
});

describe('shipLocationGroup', () => {
  it('maps positioned vessels onto a location group', () => {
    const group = shipLocationGroup([STAR_BREEZE, WIND_SURF], [
      pos(STAR_BREEZE, 20.5, -156.5),
      pos(WIND_SURF, -17.5, -149.5),
    ]);
    expect(group?.id).toBe(SHIP_GROUP_ID);
    expect(group?.locations).toEqual([
      { name: 'Star Breeze', lat: 20.5, lon: -156.5 },
      { name: 'Wind Surf', lat: -17.5, lon: -149.5 },
    ]);
  });

  it('leaves out vessels with no position rather than pinning them at 0,0', () => {
    const group = shipLocationGroup([STAR_BREEZE, STAR_PRIDE], [pos(STAR_BREEZE, 5, 5)]);
    expect(group?.locations.map((l) => l.name)).toEqual(['Star Breeze']);
  });

  it('is null when nothing is selected or nothing has reported', () => {
    expect(shipLocationGroup([], [pos(STAR_BREEZE, 1, 1)])).toBeNull();
    expect(shipLocationGroup([STAR_BREEZE], [])).toBeNull();
  });
});

describe('shipListText', () => {
  it('reads as prose and truncates long lists', () => {
    expect(shipListText([])).toBe('none');
    expect(shipListText([STAR_BREEZE])).toBe('Star Breeze');
    expect(shipListText([STAR_BREEZE, WIND_SURF])).toBe('Star Breeze and Wind Surf');
    expect(shipListText(FLEET_ROSTER.map((s) => s.mmsi))).toBe(
      'Star Breeze, Star Legend, Star Pride and 4 more'
    );
  });
});
