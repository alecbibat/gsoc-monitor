import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { useTemplatesStore } from './templatesStore';
import type { CrisisTemplatesConfig } from './model';

const META = { custom: false, revision: 0, updatedAt: null, updatedBy: null };
const cfg = (text: string): CrisisTemplatesConfig => ({
  checklistRoles: { ...META, roles: [{ id: 'ic', code: 'IC', title: 'IC', color: '#ffffff', reportsTo: '', directs: '' }] },
  checklistBlocks: [{ ...META, scope: { incidentType: null, propertyId: null }, items: [{ id: 'g-1', roleId: 'ic', phase: 'immediate', text }] }],
  intakeBlocks: [],
});
const textOf = () => useTemplatesStore.getState().config?.checklistBlocks[0].items[0].text;

// A fetch whose responses the test releases one at a time, in order.
function controllableFetch() {
  const pending: { resolve: (r: Response) => void; reject: (e: unknown) => void }[] = [];
  const fn = vi.fn(() => new Promise<Response>((resolve, reject) => { pending.push({ resolve, reject }); }));
  const ok = (body: unknown) => new Response(JSON.stringify(body), { status: 200, headers: { 'Content-Type': 'application/json' } });
  return {
    fn,
    respond: async (body: unknown) => { pending.shift()!.resolve(ok(body)); await flush(); },
    fail: async (status: number) => { pending.shift()!.resolve(new Response('{}', { status })); await flush(); },
    drop: async () => { pending.shift()!.reject(new TypeError('Failed to fetch')); await flush(); },
  };
}

const flush = () => new Promise((r) => setTimeout(r, 0));

describe('useTemplatesStore', () => {
  let net: ReturnType<typeof controllableFetch>;

  beforeEach(() => {
    net = controllableFetch();
    vi.stubGlobal('fetch', net.fn);
    vi.spyOn(console, 'warn').mockImplementation(() => {});
    useTemplatesStore.setState({ config: null, status: 'idle', error: null });
  });

  afterEach(() => {
    vi.unstubAllGlobals();
    vi.restoreAllMocks();
  });

  it('loads the config and reports status along the way', async () => {
    const done = useTemplatesStore.getState().load();
    expect(useTemplatesStore.getState().status).toBe('loading');
    await net.respond(cfg('one'));
    await done;
    expect(useTemplatesStore.getState()).toMatchObject({ status: 'ready', error: null });
    expect(textOf()).toBe('one');
  });

  it('coalesces calls made during a fetch into exactly one follow-up', async () => {
    const { load } = useTemplatesStore.getState();
    const first = load();
    const second = load();
    const third = load();
    expect(second).toBe(third);
    expect(net.fn).toHaveBeenCalledTimes(1);

    // The first GET may predate the save that prompted the later calls…
    await net.respond(cfg('stale'));
    await first;
    expect(textOf()).toBe('stale');
    // …so a follow-up runs, and it is what the later callers wait for.
    expect(net.fn).toHaveBeenCalledTimes(2);
    await net.respond(cfg('fresh'));
    await third;
    expect(textOf()).toBe('fresh');
    expect(net.fn).toHaveBeenCalledTimes(2);
  });

  it('keeps the last good config when a reload fails', async () => {
    const a = useTemplatesStore.getState().load();
    await net.respond(cfg('good'));
    await a;
    const b = useTemplatesStore.getState().load();
    expect(useTemplatesStore.getState().status).toBe('ready'); // no spinner over a working list
    await net.fail(503);
    await b;
    expect(textOf()).toBe('good');
    expect(useTemplatesStore.getState()).toMatchObject({ status: 'ready' });
    expect(useTemplatesStore.getState().error).toMatch(/503/);
  });

  it('reports an error state when there is nothing to fall back to', async () => {
    const a = useTemplatesStore.getState().load();
    await net.drop();
    await a;
    expect(useTemplatesStore.getState()).toMatchObject({ status: 'error', config: null });
    expect(useTemplatesStore.getState().error).toBeTruthy();
  });

  it('rejects a malformed body without losing the current config', async () => {
    const a = useTemplatesStore.getState().load();
    await net.respond(cfg('good'));
    await a;
    const b = useTemplatesStore.getState().load();
    await net.respond({ checklistBlocks: 'nope' });
    await b;
    expect(textOf()).toBe('good');
    expect(useTemplatesStore.getState().error).toMatch(/unexpected/i);
  });

  it("never lets an older in-flight GET overwrite a save's config", async () => {
    const a = useTemplatesStore.getState().load();
    useTemplatesStore.getState().setConfig(cfg('saved'));
    await net.respond(cfg('pre-save'));
    await a;
    expect(textOf()).toBe('saved');
    expect(useTemplatesStore.getState()).toMatchObject({ status: 'ready', error: null });
  });
});
