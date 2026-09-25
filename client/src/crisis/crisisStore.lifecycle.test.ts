import { beforeEach, describe, expect, it } from 'vitest';
import { useCrisisStore } from './crisisStore';

// Overlay navigation and the incident lifecycle actions (toggle,
// createIncident, removeIncident). The store is a module singleton, so reset
// between tests.
beforeEach(() => {
  useCrisisStore.setState({
    open: false, activeIncidentId: null, activeTab: 'situation-report', activeDrawLayerId: null, incidents: [],
  });
});

const st = () => useCrisisStore.getState();

describe('createIncident', () => {
  it('opens the new incident on the Situation Report, whatever tab the last one was left on', () => {
    st().createIncident('wildfire');
    st().setTab('checklists');
    st().backToList();

    const id = st().createIncident('flood');
    expect(st().activeIncidentId).toBe(id);
    expect(st().open).toBe(true);
    expect(st().activeTab).toBe('situation-report');
  });

  it('leaves the tab alone when an existing incident is opened', () => {
    const id = st().createIncident('wildfire');
    st().setTab('intake');
    st().backToList();
    st().openIncident(id);
    expect(st().activeTab).toBe('intake');
  });
});

describe('toggle (top-bar Crisis button)', () => {
  it('reopens on the incident the workspace was closed on', () => {
    const id = st().createIncident('wildfire');
    st().toggle();
    expect(st().open).toBe(false);
    expect(st().activeIncidentId).toBe(id);

    st().toggle();
    expect(st().open).toBe(true);
    expect(st().activeIncidentId).toBe(id);
  });

  it('reopens on the list when closed from the list', () => {
    st().createIncident('wildfire');
    st().backToList();
    st().close();
    st().toggle();
    expect(st().open).toBe(true);
    expect(st().activeIncidentId).toBeNull();
  });

  it('falls back to the list when the incident it was closed on is gone', () => {
    const id = st().createIncident('wildfire');
    st().close();
    // A peer deleted it while the workspace was closed (bypassing the store
    // action, as a raw state swap would).
    useCrisisStore.setState({ incidents: st().incidents.filter((i) => i.id !== id) });
    st().toggle();
    expect(st().open).toBe(true);
    expect(st().activeIncidentId).toBeNull();
  });
});

describe('removeIncident', () => {
  it('drops the incident and returns to the list when it was open', () => {
    const keep = st().createIncident('flood');
    const gone = st().createIncident('wildfire');
    st().removeIncident(gone);
    expect(st().incidents.map((i) => i.id)).toEqual([keep]);
    expect(st().activeIncidentId).toBeNull();
  });

  it('keeps the open incident when another one is removed', () => {
    const gone = st().createIncident('flood');
    const open = st().createIncident('wildfire');
    st().removeIncident(gone);
    expect(st().activeIncidentId).toBe(open);
  });

  it("ends a draw session on the removed incident's layer, not on another's", () => {
    const a = st().createIncident('wildfire');
    const layerA = st().addDrawLayer({
      name: 'Perimeter', type: 'fire-perimeter', geometry: 'polygon', color: '#ef4444', visible: true, positions: [],
    });
    const b = st().createIncident('flood');
    const layerB = st().addDrawLayer({
      name: 'Staging', type: 'staging-area', geometry: 'point', color: '#22c55e', visible: true, positions: [],
    });

    expect(layerA).not.toBe(layerB);
    st().setActiveDrawLayer(layerB);
    st().removeIncident(a);
    expect(st().activeDrawLayerId).toBe(layerB);

    st().removeIncident(b);
    expect(st().activeDrawLayerId).toBeNull();
  });
});
