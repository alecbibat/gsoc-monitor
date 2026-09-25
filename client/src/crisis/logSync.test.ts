import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { ActionLogEntry, Incident } from './crisisStore';

// logSync keeps its queues in module state, so every test loads a fresh copy
// (and a fresh store to go with it) and drives fetch + timers by hand.
type Mods = { logSync: typeof import('./logSync'); store: typeof import('./crisisStore') };

async function load(): Promise<Mods> {
  vi.resetModules();
  const store = await import('./crisisStore');
  const logSync = await import('./logSync');
  return { logSync, store };
}

const entry = (id: string, description = ''): ActionLogEntry => ({
  id, timestamp: '2026-09-25T10:00:00.000Z', description, entryType: 'action',
});

const incident = (log: ActionLogEntry[]): Incident =>
  ({ id: 'inc-1', actionLog: log } as unknown as Incident);

const ok = () => Promise.resolve({ ok: true, status: 200 } as Response);
const status = (s: number) => Promise.resolve({ ok: false, status: s } as Response);
const offline = () => Promise.reject(new TypeError('Failed to fetch'));

let fetchMock: ReturnType<typeof vi.fn>;

beforeEach(() => {
  vi.useFakeTimers();
  vi.spyOn(console, 'warn').mockImplementation(() => {});
  fetchMock = vi.fn();
  vi.stubGlobal('fetch', fetchMock);
});

afterEach(() => {
  vi.useRealTimers();
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

/** Store holds `log`; the server is known to hold `serverLog`. */
function seed({ logSync, store }: Mods, log: ActionLogEntry[], serverLog: ActionLogEntry[]) {
  logSync.seedBaseline(incident(serverLog));
  store.useCrisisStore.setState({ incidents: [incident(log)] });
  return () => logSync.syncLogsFromStore(store.useCrisisStore.getState().incidents);
}

const syncState = ({ store }: Mods) => store.useCrisisStore.getState().syncState;
const methods = () => fetchMock.mock.calls.map(([, init]) => (init as RequestInit).method);

describe('logSync retry', () => {
  it('retries a failed append on its own, without another store change', async () => {
    const m = await load();
    fetchMock.mockImplementationOnce(offline).mockImplementation(ok);
    seed(m, [entry('a')], [])();
    await vi.advanceTimersByTimeAsync(0);
    expect(syncState(m)).toBe('error');
    expect(methods()).toEqual(['POST']);

    await vi.advanceTimersByTimeAsync(5_000);
    expect(methods()).toEqual(['POST', 'POST']);
    expect(syncState(m)).toBe('saved');
    expect(m.logSync.hasPendingWork()).toBe(false);
  });

  it('backs off 5 s → 10 s → 20 s while the server stays down', async () => {
    const m = await load();
    fetchMock.mockImplementation(offline);
    seed(m, [entry('a')], [])();
    await vi.advanceTimersByTimeAsync(0);
    expect(fetchMock).toHaveBeenCalledTimes(1);

    await vi.advanceTimersByTimeAsync(5_000);
    expect(fetchMock).toHaveBeenCalledTimes(2);
    await vi.advanceTimersByTimeAsync(9_999);
    expect(fetchMock).toHaveBeenCalledTimes(2);
    await vi.advanceTimersByTimeAsync(1);
    expect(fetchMock).toHaveBeenCalledTimes(3);
    await vi.advanceTimersByTimeAsync(20_000);
    expect(fetchMock).toHaveBeenCalledTimes(4);
    expect(syncState(m)).toBe('error');
    // Still counts as unsaved work while the retry is armed.
    expect(m.logSync.hasPendingWork()).toBe(true);
  });

  it('retries a failed edit as another PATCH', async () => {
    const m = await load();
    fetchMock.mockImplementationOnce(() => status(503)).mockImplementation(ok);
    seed(m, [entry('a', 'edited')], [entry('a')])();
    await vi.advanceTimersByTimeAsync(800);
    expect(methods()).toEqual(['PATCH']);
    expect(syncState(m)).toBe('error');

    await vi.advanceTimersByTimeAsync(5_000 + 800);
    expect(methods()).toEqual(['PATCH', 'PATCH']);
    expect(syncState(m)).toBe('saved');
  });

  it('does not report "saved" while an earlier failure is still unsent', async () => {
    const m = await load();
    // a's append fails; b's edit succeeds while a waits for its retry.
    fetchMock.mockImplementationOnce(offline).mockImplementation(ok);
    const sync = seed(m, [entry('a'), entry('b', 'edited')], [entry('b')]);
    sync();
    await vi.advanceTimersByTimeAsync(0);
    expect(syncState(m)).toBe('error');
    await vi.advanceTimersByTimeAsync(800); // b's PATCH lands → re-diff re-sends a
    expect(methods()).toEqual(['POST', 'PATCH', 'POST']);
    expect(syncState(m)).toBe('saved');
  });

  it('clears "Saving…" when an edited entry was deleted by a peer (PATCH 404)', async () => {
    const m = await load();
    fetchMock.mockImplementation(() => status(404));
    seed(m, [entry('a', 'edited')], [entry('a')])();
    expect(syncState(m)).toBe('saving');
    await vi.advanceTimersByTimeAsync(800);
    expect(syncState(m)).toBe('saved');
    // Delete wins: nothing is retried.
    await vi.advanceTimersByTimeAsync(120_000);
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it('clears "Saving…" when a debounced edit finds its entry gone', async () => {
    const m = await load();
    seed(m, [entry('a', 'edited')], [entry('a')])();
    expect(syncState(m)).toBe('saving');
    // Removed without the watcher re-diffing (the timer is still armed).
    m.store.useCrisisStore.setState({ incidents: [incident([])] });
    await vi.advanceTimersByTimeAsync(800);
    expect(fetchMock).not.toHaveBeenCalled();
    expect(syncState(m)).toBe('saved');
  });
});
