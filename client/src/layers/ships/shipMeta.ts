// Fleet metadata that doesn't need Three.js — kept out of ShipModel3D so
// consumers can read it without pulling the whole three chunk.

// Wind Surf is the fleet's only 5-masted vessel; the rest carry 4.
export function mastCountForShip(name?: string): number {
  return name && /surf/i.test(name) ? 5 : 4;
}
