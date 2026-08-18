// Windstar vessels as an incident location.
//
// The fleet can't live in LOCATION_GROUPS: every consumer of that list assumes
// fixed lat/lon (fire-pin envelopes, the proximity scan, the screensaver tour),
// and a ship's position is only known once the AIS feed answers. So the fleet
// is modelled as a *pseudo* location group — selectable in the incident's
// Property field under the same id everywhere — that resolves to a real
// LocationGroup only when live positions are in hand.
//
// The incident carries the vessel identities (MMSIs); positions are always read
// live, never frozen into the record or the share snapshot.
import type { Location, LocationGroup } from '../layers/locations/locations';
import { FLEET_ROSTER, fleetColor, type FleetRosterShip } from '../layers/ships/fleet';
import type { ShipState } from '../types';

/** Id used wherever a location group id is expected (Property field, snapshots). */
export const SHIP_GROUP_ID = 'windstar-ships';
export const SHIP_GROUP_NAME = 'Windstar Ships';
export const SHIP_GROUP_ICON = '🚢';
/** Matches the Windstar shore-side group's cyan so the brand reads as one. */
export const SHIP_GROUP_COLOR = '#0ea5e9';

export function isShipGroupId(id: string | null | undefined): boolean {
  return id === SHIP_GROUP_ID;
}

/**
 * Roster entries for the selected MMSIs: deduped, sorted into fleet order, and
 * with ids this build doesn't know dropped (incidents and share snapshots
 * outlive fleet changes — a sold ship must not render as a blank card).
 */
export function incidentShips(mmsis: readonly unknown[] | null | undefined): FleetRosterShip[] {
  if (!Array.isArray(mmsis) || mmsis.length === 0) return [];
  const want = new Set(mmsis.filter((m): m is string => typeof m === 'string'));
  return FLEET_ROSTER.filter((s) => want.has(s.mmsi));
}

/** The same list as ids — the canonical form to persist and publish. */
export function incidentShipMmsis(mmsis: readonly unknown[] | null | undefined): string[] {
  return incidentShips(mmsis).map((s) => s.mmsi);
}

/** One selected vessel paired with its live position, if the feed has one. */
export interface IncidentVessel {
  roster: FleetRosterShip;
  /** null = selected for the incident but no position reported yet. */
  ship: ShipState | null;
  /** Class colour (Star / Wind), shared with the globe markers. */
  color: string;
}

export function incidentVessels(
  mmsis: readonly unknown[] | null | undefined,
  ships: readonly ShipState[]
): IncidentVessel[] {
  const byMmsi = new Map(ships.map((s) => [s.mmsi, s]));
  return incidentShips(mmsis).map((roster) => ({
    roster,
    ship: byMmsi.get(roster.mmsi) ?? null,
    color: fleetColor(roster.cls),
  }));
}

/**
 * The selected vessels as a location group, for the map surfaces that already
 * speak LocationGroup (share-map pins, zoom-to-incident framing).
 *
 * Vessels without a live position are left out rather than pinned at 0,0 —
 * null when that leaves nothing to draw.
 */
export function shipLocationGroup(
  mmsis: readonly unknown[] | null | undefined,
  ships: readonly ShipState[]
): LocationGroup | null {
  const locations: Location[] = incidentVessels(mmsis, ships)
    .filter((v): v is IncidentVessel & { ship: ShipState } => v.ship !== null)
    .map((v) => ({ name: v.roster.name, lat: v.ship.latitude, lon: v.ship.longitude }));
  if (locations.length === 0) return null;
  return {
    id: SHIP_GROUP_ID,
    name: SHIP_GROUP_NAME,
    color: SHIP_GROUP_COLOR,
    icon: SHIP_GROUP_ICON,
    locations,
  };
}

/** "Star Breeze, Wind Surf and 2 more" — for log entries and summaries. */
export function shipListText(mmsis: readonly unknown[] | null | undefined, max = 3): string {
  const names = incidentShips(mmsis).map((s) => s.name);
  if (names.length === 0) return 'none';
  if (names.length <= max) {
    return names.length === 1
      ? names[0]
      : `${names.slice(0, -1).join(', ')} and ${names[names.length - 1]}`;
  }
  return `${names.slice(0, max).join(', ')} and ${names.length - max} more`;
}
