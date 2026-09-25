import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { Incident } from './crisisStore';

// The blob sync engine keeps its queues in module state, so every test loads
// a fresh copy (and a fresh store to go with it) and drives fetch + timers by
// hand. The store watcher isn't mounted here: `watch()` stands in for it.
type Mods = {
  sync: typeof import('./IncidentSync');
  store: typeof import('./crisisStore');
  canon: typeof import('./syncCanon');
};

async function load(): Promise<Mods> {
  vi.resetModules();
  const store = await import('./crisisStore');
  const sync = await import('./IncidentSync');
  const canon = await import('./syncCanon');
  return { store, sync, canon };
}

const res = (status: number, body: unknown = {}) =>
  ({ ok: status >= 200 && status < 300, status, json: () => Promise.resolve(body) } as Response);
const offline = () => Promise.reject(new TypeError('Failed to fetch'));

function deferred() {
  let resolve!: (r: Response) => void;
  let reject!: (e: unknown) => void;
  const promise = new Promise<Response>((a, b) => { resolve = a; reject = b; });
  return { promise, resolve, reject };
}

let fetchMock: ReturnType<typeof vi.fn>;
let sendBeacon: ReturnType<typeof vi.fn>;

beforeEach(() => {
  vi.useFakeTimers();
  vi.spyOn(console, 'warn').mockImplementation(() => {});
  fetchMock = vi.fn();
  sendBeacon = vi.fn(() => true);
  vi.stubGlobal('fetch', fetchMock);
  vi.stubGlobal('navigator', { sendBeacon });
});

afterEach(() => {
  vi.useRealTimers();
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

const calls = () => fetchMock.mock.calls.map(([url, init]) => ({
  url: url as string,
  method: (init as RequestInit).method,
  keepalive: (init as RequestInit).keepalive,
  body: JSON.parse((init as RequestInit).body as string) as Incident,
}));
const methods = () => calls().map((c) => c.method);
const lastBody = () => calls()[calls().length - 1].body;

function setup(m: Mods) {
  const st = () => m.store.useCrisisStore.getState();
  const id = st().createIncident('wildfire');
  const inc = () => st().incidents.find((i) => i.id === id)!;
  const t = m.sync.__test;
  return {
    id, inc, t,
    has: () => st().incidents.some((i) => i.id === id),
    syncState: () => st().syncState,
    /** The store watcher's reaction to the incident's current state. */
    watch: () => t.syncChanged(inc()),
    edit: (patch: Partial<Incident>) => st().update(patch),
    /** The server confirms the incident as it is now (a GET row / SSE upsert). */
    confirmOnServer: () => { const s0 = structuredClone(inc()); t.applyUpsert(s0); return s0; },
    /** A peer's version of the incident arriving over the stream. */
    peer: (base: Incident, patch: Partial<Incident>) => t.applyUpsert(structuredClone({ ...base, ...patch })),
  };
}

describe('IncidentSync — creates', () => {
  it('holds a queued PUT back until the create lands, and re-creates a create that failed', async () => {
    const m = await load();
    const { id, has, watch, edit } = setup(m);
    const post = deferred();
    fetchMock.mockImplementationOnce(() => post.promise);
    watch();                                    // new: POST
    edit({ incidentName: 'Ridge Fire' });
    watch();                                    // changed: PUT queued
    await vi.advanceTimersByTimeAsync(4_000);
    expect(methods()).toEqual(['POST']);        // a PUT now could 404 on a row not there yet

    post.resolve(res(503));
    await vi.advanceTimersByTimeAsync(1_500);
    expect(methods()).toEqual(['POST']);        // still a create: no PUT
    expect(has()).toBe(true);

    fetchMock.mockImplementation(() => Promise.resolve(res(200, { actionLog: [] })));
    await vi.advanceTimersByTimeAsync(5_000);   // the retry
    expect(methods()).toEqual(['POST', 'POST']);
    expect(lastBody()).toMatchObject({ id, incidentName: 'Ridge Fire' });
  });

  it('reads a PUT 404 as a delete only for an incident the server confirmed', async () => {
    const m = await load();
    const a = setup(m);
    fetchMock.mockImplementationOnce(() => Promise.resolve(res(404)))
      .mockImplementation(() => Promise.resolve(res(200, { actionLog: [] })));
    a.t.pushIncident(a.inc(), 'PUT');           // never confirmed: its create didn't land
    await vi.advanceTimersByTimeAsync(0);
    expect(a.has()).toBe(true);
    await vi.advanceTimersByTimeAsync(5_000);
    expect(methods()).toEqual(['PUT', 'POST']); // re-created

    const b = setup(m);
    b.confirmOnServer();
    fetchMock.mockImplementationOnce(() => Promise.resolve(res(404)));
    b.edit({ incidentName: 'Gone' });
    b.t.pushIncident(b.inc(), 'PUT');
    await vi.advanceTimersByTimeAsync(0);
    expect(b.has()).toBe(false);                // a teammate deleted it
  });
});

describe('IncidentSync — failed saves', () => {
  it("doesn't let an older push's success clear a newer push's failure", async () => {
    const m = await load();
    const { id, inc, t, edit, confirmOnServer, syncState } = setup(m);
    confirmOnServer();
    const put1 = deferred();
    fetchMock.mockImplementationOnce(() => put1.promise).mockImplementationOnce(() => Promise.resolve(res(503)));
    edit({ incidentName: 'L1' });
    const l1 = inc();
    t.pushIncident(l1, 'PUT');
    edit({ incidentName: 'L2' });
    t.pushIncident(inc(), 'PUT');
    await vi.advanceTimersByTimeAsync(0);       // push 2 failed
    put1.resolve(res(200));                     // push 1 lands late
    await vi.advanceTimersByTimeAsync(0);
    expect(syncState()).toBe('error');
    expect(t.retries.has(id)).toBe(true);
    expect(t.failedBase.get(id)).toBe(m.canon.serverCanon(l1));

    fetchMock.mockImplementation(() => Promise.resolve(res(200)));
    await vi.advanceTimersByTimeAsync(5_000);
    expect(lastBody().incidentName).toBe('L2');
    expect(syncState()).toBe('saved');
  });

  it('bases a failed save on the last copy the server really has when two pushes fail', async () => {
    const m = await load();
    const { id, inc, t, edit, confirmOnServer } = setup(m);
    const s0 = confirmOnServer();
    const put1 = deferred();
    const put2 = deferred();
    fetchMock.mockImplementationOnce(() => put1.promise).mockImplementationOnce(() => put2.promise);
    edit({ incidentName: 'L1' });
    t.pushIncident(inc(), 'PUT');
    edit({ incidentName: 'L2' });
    t.pushIncident(inc(), 'PUT');
    put1.reject(new TypeError('Failed to fetch'));
    await vi.advanceTimersByTimeAsync(0);
    put2.reject(new TypeError('Failed to fetch'));
    await vi.advanceTimersByTimeAsync(0);
    // L1 never landed: the edit sits on S0, so a peer's change rebases onto that.
    expect(t.failedBase.get(id)).toBe(m.canon.serverCanon(s0));
  });

  it('records the newer baseline when a peer upsert landed while the failing push was out', async () => {
    const m = await load();
    const { id, inc, t, edit, confirmOnServer, peer } = setup(m);
    const s0 = confirmOnServer();
    const put = deferred();
    fetchMock.mockImplementationOnce(() => put.promise);
    edit({ executiveSummary: 'Evacuating' });
    t.pushIncident(inc(), 'PUT');
    peer(s0, { incidentStatus: 'monitoring' }); // B: active → monitoring
    put.reject(new TypeError('Failed to fetch'));
    await vi.advanceTimersByTimeAsync(0);
    expect(t.failedBase.get(id)).toBe(m.canon.serverCanon(inc()));

    // B's next change must not be read as a conflict with "our" monitoring.
    peer(s0, { incidentStatus: 'recovery' });
    expect(inc().incidentStatus).toBe('recovery');
  });

  it("rebases a queued edit onto a peer's change after a failed push, so its PUT can't revert the peer", async () => {
    const m = await load();
    const { inc, t, edit, watch, confirmOnServer, peer } = setup(m);
    const s0 = confirmOnServer();
    fetchMock.mockImplementationOnce(offline).mockImplementation(() => Promise.resolve(res(200)));
    edit({ incidentName: 'L1' });
    t.pushIncident(inc(), 'PUT');
    await vi.advanceTimersByTimeAsync(0);       // failed
    edit({ executiveSummary: 'L2' });
    watch();                                    // queued as a PUT — not a POST
    expect(methods()).toEqual(['PUT']);

    peer(s0, { incidentStatus: 'monitoring' });
    expect(inc()).toMatchObject({ incidentName: 'L1', executiveSummary: 'L2', incidentStatus: 'monitoring' });
    watch();
    await vi.advanceTimersByTimeAsync(1_500);
    expect(methods()).toEqual(['PUT', 'PUT']);
    expect(lastBody()).toMatchObject({ incidentName: 'L1', executiveSummary: 'L2', incidentStatus: 'monitoring' });
  });

  it('re-sends a confirmed incident whose save failed as a PUT, never an upsert that could recreate it', async () => {
    const m = await load();
    const { id, inc, t, edit, watch, confirmOnServer } = setup(m);
    confirmOnServer();
    fetchMock.mockImplementation(offline);
    edit({ incidentName: 'L1' });
    t.pushIncident(inc(), 'PUT');
    await vi.advanceTimersByTimeAsync(0);
    edit({ incidentName: 'L2' });
    watch();
    await vi.advanceTimersByTimeAsync(1_500);
    expect(methods()).toEqual(['PUT', 'PUT']);

    // Tab hidden with the save still failing: a keepalive PUT, no beacon.
    t.flushPending();
    expect(sendBeacon).not.toHaveBeenCalled();
    expect(calls()[calls().length - 1]).toMatchObject({ method: 'PUT', keepalive: true, url: `/api/incidents/${id}` });
  });
});

describe('IncidentSync — reconnect resync', () => {
  it('rebases a save that failed offline onto what peers changed meanwhile', async () => {
    const m = await load();
    const { inc, t, edit, watch, confirmOnServer } = setup(m);
    const s0 = confirmOnServer();
    fetchMock.mockImplementation(offline);
    edit({ executiveSummary: 'Written offline' });
    t.pushIncident(inc(), 'PUT');
    await vi.advanceTimersByTimeAsync(0);       // failed, awaiting its retry

    // Back online: the list GET has a teammate's status change from the outage.
    t.applyResyncSnapshot([structuredClone({ ...s0, incidentStatus: 'monitoring' })], () => false, () => {
      throw new Error('nothing was deleted');
    });
    expect(inc()).toMatchObject({ executiveSummary: 'Written offline', incidentStatus: 'monitoring' });

    fetchMock.mockImplementation(() => Promise.resolve(res(200)));
    watch();
    await vi.advanceTimersByTimeAsync(1_500);
    expect(lastBody()).toMatchObject({ executiveSummary: 'Written offline', incidentStatus: 'monitoring' });
  });

  it("drops a confirmed incident the server no longer has, but not a create that didn't land", async () => {
    const m = await load();
    const a = setup(m);
    a.confirmOnServer();
    const b = setup(m);
    fetchMock.mockImplementation(offline);
    a.edit({ incidentName: 'Edited offline' });
    a.t.pushIncident(a.inc(), 'PUT');
    b.t.pushIncident(b.inc(), 'POST');
    await vi.advanceTimersByTimeAsync(0);       // both failed

    const dropped: string[] = [];
    a.t.applyResyncSnapshot([], () => false, (id) => dropped.push(id));
    expect(dropped).toEqual([a.id]);
  });
});
