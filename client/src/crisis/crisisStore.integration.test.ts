import { beforeEach, describe, expect, it } from 'vitest';
import { DEFAULT_ROLES, endIsStaleStandDownStamp, useCrisisStore, type Incident } from './crisisStore';

// Store actions whose effects span several parts of an incident: the org-chart
// reset (roles + assignments + log), draw-layer edits (shape + thumbnail) and
// the stand-down End rule the modal shares with the store.

beforeEach(() => {
  useCrisisStore.setState({ incidents: [], activeIncidentId: null });
});

const st = () => useCrisisStore.getState();
const active = (): Incident => {
  const s = useCrisisStore.getState();
  return s.incidents.find((i) => i.id === s.activeIncidentId)!;
};

const addCustomRole = (title: string): string => {
  st().addRole({ title, parentId: 'ic', color: '#888888', isCommandStaff: false, isSupport: false, order: 99 });
  return active().roles.find((r) => r.title === title)!.id;
};

describe('resetRoles', () => {
  it('restores the default chart and logs the reset', () => {
    st().createIncident();
    addCustomRole('Drone Unit');
    st().resetRoles();

    const inc = active();
    expect(inc.roles.map((r) => r.id)).toEqual(DEFAULT_ROLES.map((r) => r.id));
    const [entry] = inc.actionLog;
    expect(entry.system).toBe('role-removed');
    expect(entry.description).toBe('ICS org chart reset to defaults');
    expect(entry.meta).toEqual({ reset: 'true', releasedAssignments: '0' });
  });

  it('ends (never deletes) active assignments on custom roles', () => {
    st().createIncident();
    const drone = addCustomRole('Drone Unit');
    st().assignRole(drone, 'Dee Park');
    st().assignRole('safety', 'Ana Ruiz');
    st().resetRoles();

    const inc = active();
    expect(inc.assignments).toHaveLength(2);
    const released = inc.assignments.find((a) => a.roleId === drone)!;
    expect(released.name).toBe('Dee Park');
    expect(released.endedAt).toBeTruthy();
    // People in standard roles stay seated.
    expect(inc.assignments.find((a) => a.roleId === 'safety')!.endedAt).toBeUndefined();

    const [entry] = inc.actionLog;
    expect(entry.description).toBe('ICS org chart reset to defaults — 1 assignment released');
    expect(entry.meta).toEqual({ reset: 'true', releasedAssignments: '1' });
  });

  it('keeps the end time of assignments already released', () => {
    st().createIncident();
    const drone = addCustomRole('Drone Unit');
    st().assignRole(drone, 'Dee Park');
    const id = active().assignments[0].id;
    st().endAssignment(id);
    const endedAt = active().assignments[0].endedAt;
    st().resetRoles();

    expect(active().assignments[0].endedAt).toBe(endedAt);
    expect(active().actionLog[0].meta?.releasedAssignments).toBe('0');
  });

  it('is a no-op on an archived incident', () => {
    st().createIncident();
    const id = active().id;
    st().standDownIncident(id);
    const before = active();
    st().resetRoles();
    expect(active()).toBe(before);
  });
});

describe('updateDrawLayer', () => {
  const addLayer = () =>
    st().addDrawLayer({
      name: 'Perimeter',
      type: 'fire-perimeter',
      geometry: 'polygon',
      color: '#ff0000',
      visible: true,
      positions: [{ lat: 1, lon: 1 }, { lat: 2, lon: 2 }, { lat: 1, lon: 3 }],
      thumbnail: 'https://example.test/old.jpg',
    });
  const layer = (id: string) => active().drawLayers.find((l) => l.id === id)!;

  it('drops the thumbnail when the shape changes', () => {
    st().createIncident();
    const id = addLayer();
    st().updateDrawLayer(id, { positions: [{ lat: 5, lon: 5 }] });
    expect(layer(id).positions).toEqual([{ lat: 5, lon: 5 }]);
    expect(layer(id).thumbnail).toBeUndefined();
  });

  it('keeps a thumbnail sent along with the new shape', () => {
    st().createIncident();
    const id = addLayer();
    st().updateDrawLayer(id, { positions: [{ lat: 5, lon: 5 }], thumbnail: 'https://example.test/new.jpg' });
    expect(layer(id).thumbnail).toBe('https://example.test/new.jpg');
  });

  it('keeps the thumbnail for edits that leave the shape alone', () => {
    st().createIncident();
    const id = addLayer();
    st().updateDrawLayer(id, { visible: false, name: 'Perimeter (old)' });
    expect(layer(id).thumbnail).toBe('https://example.test/old.jpg');
    st().updateDrawLayer(id, { thumbnail: 'https://example.test/new.jpg' });
    expect(layer(id).thumbnail).toBe('https://example.test/new.jpg');
  });
});

describe('endIsStaleStandDownStamp', () => {
  it('is true only for the automatic End of the latest stand-down', () => {
    st().createIncident();
    const id = active().id;
    expect(endIsStaleStandDownStamp(active())).toBe(false); // blank End

    st().standDownIncident(id);
    st().reopenIncident(id);
    const reopened = st().incidents.find((i) => i.id === id)!;
    expect(reopened.incidentEndDatetime).toBeTruthy();
    expect(endIsStaleStandDownStamp(reopened)).toBe(true);

    // An End the operator entered is theirs, not a stale stamp.
    const edited = { ...reopened, incidentEndDatetime: '2026-01-01T00:00:00.000Z' };
    expect(endIsStaleStandDownStamp(edited)).toBe(false);
  });

  it('is false when the stand-down was given an explicit End', () => {
    st().createIncident();
    const id = active().id;
    st().standDownIncident(id, '', '2026-02-02T10:00:00.000Z');
    const inc = st().incidents.find((i) => i.id === id)!;
    expect(inc.incidentEndDatetime).toBe('2026-02-02T10:00:00.000Z');
    expect(endIsStaleStandDownStamp(inc)).toBe(false);
  });
});
