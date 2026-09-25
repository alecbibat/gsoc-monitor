import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { CHECKLIST_AUTO_RETRY_MS, inflightChecklistIds, mergeChecklists, toggleChecklistItem } from './checklistSync';
import { useCrisisStore } from './crisisStore';
import type { ChecklistStateMap } from './checklistTemplate';

const at = (m: number) => `2026-08-19T10:${String(m).padStart(2, '0')}:00.000Z`;

describe('mergeChecklists', () => {
  const remote: ChecklistStateMap = {
    'ic-imm-1': { checked: true, at: at(0), by: 'Ops' },
    'ic-imm-2': { checked: false, at: at(1) },
  };

  it('takes the server map wholesale when nothing is in flight', () => {
    const local: ChecklistStateMap = { 'ic-imm-1': { checked: false, at: at(2) } };
    expect(mergeChecklists(remote, local, new Set())).toBe(remote);
  });

  it('keeps local state for items whose own push is still in flight', () => {
    // A stale SSE snapshot must not visually revert a toggle the user just
    // made; the item's own response/echo converges it.
    const local: ChecklistStateMap = { 'ic-imm-1': { checked: false, at: at(2), by: 'Me' } };
    const merged = mergeChecklists(remote, local, new Set(['ic-imm-1']));
    expect(merged['ic-imm-1']).toEqual(local['ic-imm-1']);
    expect(merged['ic-imm-2']).toEqual(remote['ic-imm-2']);
  });

  it('ignores in-flight ids with no local entry', () => {
    const merged = mergeChecklists(remote, {}, new Set(['ic-imm-1']));
    expect(merged).toEqual(remote);
  });
});

// ── toggleChecklistItem: result, rollback, one automatic re-send ────────────

describe('toggleChecklistItem', () => {
  const fetchMock = vi.fn();
  const serverMap = (checked: boolean): ChecklistStateMap => ({ 'ic-imm-1': { checked, at: at(30), by: 'Server' } });
  const json = (status: number, body: unknown) =>
    Promise.resolve(new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json' } }));
  const incident = () => {
    const s = useCrisisStore.getState();
    return s.incidents.find((i) => i.id === s.activeIncidentId)!;
  };
  const itemState = () => incident().checklists?.['ic-imm-1'];

  beforeEach(() => {
    useCrisisStore.setState({ incidents: [], activeIncidentId: null, syncState: 'idle' });
    useCrisisStore.getState().createIncident('wildfire');
    fetchMock.mockReset();
    vi.stubGlobal('fetch', fetchMock);
    vi.spyOn(console, 'warn').mockImplementation(() => {});
  });
  afterEach(() => {
    vi.useRealTimers();
    vi.unstubAllGlobals();
    vi.restoreAllMocks();
  });

  it('adopts the server-stamped entry on success', async () => {
    fetchMock.mockReturnValueOnce(json(200, { checklists: serverMap(true) }));
    const result = await toggleChecklistItem(incident(), 'ic-imm-1', true);
    expect(result).toEqual({ ok: true });
    expect(itemState()).toEqual(serverMap(true)['ic-imm-1']);
    expect(inflightChecklistIds(incident().id).size).toBe(0);
  });

  it('rolls back a rejected toggle and reports it without lighting the global sync indicator', async () => {
    fetchMock.mockReturnValueOnce(json(409, { error: 'Incident is archived' }));
    const result = await toggleChecklistItem(incident(), 'ic-imm-1', true);
    expect(result).toMatchObject({ ok: false, superseded: false, status: 409, retryable: false });
    expect(!result.ok && !result.superseded && result.message).toMatch(/stood down/);
    expect(itemState()).toBeUndefined();
    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(useCrisisStore.getState().syncState).toBe('idle');
  });

  it('re-sends once after a network failure, holding the optimistic check meanwhile', async () => {
    vi.useFakeTimers();
    fetchMock
      .mockReturnValueOnce(Promise.reject(new TypeError('Failed to fetch')))
      .mockReturnValueOnce(json(200, { checklists: serverMap(true) }));
    const pending = toggleChecklistItem(incident(), 'ic-imm-1', true);
    await vi.advanceTimersByTimeAsync(CHECKLIST_AUTO_RETRY_MS - 1);
    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(itemState()?.checked).toBe(true);
    await vi.advanceTimersByTimeAsync(1);
    expect(await pending).toEqual({ ok: true });
    expect(fetchMock).toHaveBeenCalledTimes(2);
    expect(itemState()).toEqual(serverMap(true)['ic-imm-1']);
  });

  it('gives up after the one re-send, rolls back, and offers a manual retry', async () => {
    vi.useFakeTimers();
    fetchMock.mockImplementation(() => json(503, { error: 'Service Unavailable' }));
    const pending = toggleChecklistItem(incident(), 'ic-imm-1', true);
    await vi.advanceTimersByTimeAsync(CHECKLIST_AUTO_RETRY_MS);
    const result = await pending;
    expect(result).toMatchObject({ ok: false, superseded: false, status: 503, retryable: true });
    expect(fetchMock).toHaveBeenCalledTimes(2);
    expect(itemState()).toBeUndefined();
    expect(inflightChecklistIds(incident().id).size).toBe(0);
  });

  it('never re-sends an older toggle over a newer one of the same item', async () => {
    vi.useFakeTimers();
    fetchMock
      .mockReturnValueOnce(Promise.reject(new TypeError('Failed to fetch')))       // check: fails
      .mockReturnValueOnce(json(200, { checklists: serverMap(false) }));            // uncheck: lands
    const first = toggleChecklistItem(incident(), 'ic-imm-1', true);
    await vi.advanceTimersByTimeAsync(0);
    const second = toggleChecklistItem(incident(), 'ic-imm-1', false);
    expect(await second).toEqual({ ok: true });
    await vi.advanceTimersByTimeAsync(CHECKLIST_AUTO_RETRY_MS);
    expect(await first).toEqual({ ok: false, superseded: true });
    expect(fetchMock).toHaveBeenCalledTimes(2);
    expect(itemState()).toEqual(serverMap(false)['ic-imm-1']);
    expect(inflightChecklistIds(incident().id).size).toBe(0);
  });
});
