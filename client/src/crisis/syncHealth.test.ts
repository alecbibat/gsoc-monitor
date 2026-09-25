import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { noteSaveStatus, useSyncHealth } from './syncHealth';
import { toggleChecklistItem } from './checklistSync';
import { useCrisisStore } from './crisisStore';

beforeEach(() => {
  useSyncHealth.setState({ authLapsed: false, loadState: 'loading' });
});

describe('noteSaveStatus', () => {
  it('flags a 401 and clears on the next 2xx', () => {
    noteSaveStatus(401);
    expect(useSyncHealth.getState().authLapsed).toBe(true);
    noteSaveStatus(503); // still failing, for another reason: no news on the sign-in
    expect(useSyncHealth.getState().authLapsed).toBe(true);
    noteSaveStatus(204);
    expect(useSyncHealth.getState().authLapsed).toBe(false);
  });
});

describe('checklist toggles report the sign-in state', () => {
  const fetchMock = vi.fn();
  const incident = () => {
    const s = useCrisisStore.getState();
    return s.incidents.find((i) => i.id === s.activeIncidentId)!;
  };

  beforeEach(() => {
    useCrisisStore.setState({ incidents: [], activeIncidentId: null, syncState: 'idle' });
    useCrisisStore.getState().createIncident('wildfire');
    fetchMock.mockReset();
    vi.stubGlobal('fetch', fetchMock);
    vi.spyOn(console, 'warn').mockImplementation(() => {});
  });
  afterEach(() => {
    vi.unstubAllGlobals();
    vi.restoreAllMocks();
  });

  it('a 401 raises the signed-out notice; a later success clears it', async () => {
    fetchMock.mockResolvedValueOnce(new Response(JSON.stringify({ error: 'Not signed in' }), { status: 401 }));
    const failed = await toggleChecklistItem(incident(), 'ic-imm-1', true);
    expect(failed).toMatchObject({ ok: false, superseded: false, status: 401, retryable: true });
    expect(useSyncHealth.getState().authLapsed).toBe(true);

    fetchMock.mockResolvedValueOnce(new Response(JSON.stringify({
      checklists: { 'ic-imm-1': { checked: true, at: '2026-09-25T10:00:00.000Z', by: 'Ana' } },
    }), { status: 200 }));
    expect(await toggleChecklistItem(incident(), 'ic-imm-1', true)).toEqual({ ok: true });
    expect(useSyncHealth.getState().authLapsed).toBe(false);
  });
});
