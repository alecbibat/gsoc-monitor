import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { usePanelStore, type PanelOpenData } from './panelStore';

// The store is a module singleton — reset between tests. Placement reads the
// viewport, so stub one: without it every cascade slot collapses to x=600 and
// the browser branch of the math never runs.
beforeEach(() => {
  vi.stubGlobal('window', { innerWidth: 1280, innerHeight: 800 });
  usePanelStore.setState({ panels: [], topZ: 10 });
});
afterEach(() => vi.unstubAllGlobals());

// Cascade slot n for the stubbed 1280×800 viewport: width 360, margin 24,
// 64px top chrome, 32px step down-left per slot.
const slot = (n: number) => [1280 - 360 - 24 - n * 32, 24 + 64 + n * 32];

const quake = (n: number, extra: Partial<PanelOpenData> = {}): PanelOpenData => ({
  id: `quake-${n}`,
  kind: 'earthquakes',
  title: `M${n}.0`,
  payload: { mag: n },
  ...extra,
});

const widget: PanelOpenData = {
  id: 'widget-news-feed',
  kind: 'news-feed',
  title: 'Breaking News',
  payload: {},
  locked: true,
};

const ids = () => usePanelStore.getState().panels.map((p) => p.id);
const byId = (id: string) => usePanelStore.getState().panels.find((p) => p.id === id)!;
const posOf = (id: string) => [byId(id).x, byId(id).y];

describe('one popup at a time', () => {
  it('opens transient panels unlocked', () => {
    usePanelStore.getState().open(quake(1));
    expect(byId('quake-1').locked).toBe(false);
  });

  it('replaces the open unlocked panel when a new one opens', () => {
    const s = usePanelStore.getState();
    s.open(quake(1));
    s.open(quake(2));
    expect(ids()).toEqual(['quake-2']);
  });

  it('closes every unlocked panel, whatever its kind', () => {
    const s = usePanelStore.getState();
    s.open(widget); // opens locked, so it coexists with the next popup
    s.open(quake(1));
    s.toggleLock(widget.id); // now two unlocked panels of different kinds
    s.open(quake(2));
    expect(ids()).toEqual(['quake-2']);
  });

  it('keeps locked panels open across new clicks', () => {
    const s = usePanelStore.getState();
    s.open(quake(1));
    s.toggleLock('quake-1');
    s.open(quake(2));
    s.open(quake(3));
    expect(ids()).toEqual(['quake-1', 'quake-3']);
    expect(byId('quake-1').locked).toBe(true);
    expect(byId('quake-3').locked).toBe(false);
  });

  it('keeps surviving locked panels in their original order after a sweep', () => {
    // The mobile deck pages and dots follow array order, so a sweep must not
    // reshuffle the survivors.
    const s = usePanelStore.getState();
    s.open(quake(1));
    s.toggleLock('quake-1');
    s.open(quake(2)); // unlocked, sits between the two locked ones
    s.open(widget);
    s.open(quake(3));
    expect(ids()).toEqual(['quake-1', widget.id, 'quake-3']);
  });

  it('brings the new panel to the front', () => {
    const s = usePanelStore.getState();
    s.open(quake(1));
    s.toggleLock('quake-1');
    s.open(quake(2));
    expect(byId('quake-2').z).toBeGreaterThan(byId('quake-1').z);
    expect(usePanelStore.getState().topZ).toBe(byId('quake-2').z);
  });
});

describe('re-opening an already open panel', () => {
  it('refreshes its data and raises it without closing anything', () => {
    const s = usePanelStore.getState();
    s.open(quake(1));
    s.toggleLock('quake-1');
    s.open(quake(2));
    s.open(quake(1, { title: 'M1.0 (updated)', payload: { mag: 1.1 } }));
    expect(ids()).toEqual(['quake-1', 'quake-2']);
    expect(byId('quake-1').title).toBe('M1.0 (updated)');
    expect(byId('quake-1').payload).toEqual({ mag: 1.1 });
    expect(byId('quake-1').z).toBeGreaterThan(byId('quake-2').z);
  });

  it('never overrides the lock the user set', () => {
    const s = usePanelStore.getState();
    s.open(quake(1));
    s.toggleLock('quake-1');
    s.open(quake(1, { locked: false })); // caller says unlock — the user's lock still wins
    expect(byId('quake-1').locked).toBe(true);

    s.open(widget);
    s.toggleLock(widget.id); // user unlocked the widget
    s.open(widget); // launcher passes locked: true again — the user's choice wins
    expect(byId(widget.id).locked).toBe(false);
  });

  it('keeps its position and dock state', () => {
    const s = usePanelStore.getState();
    s.open(quake(1));
    s.dock('quake-1', 'bl');
    const before = byId('quake-1');
    s.open(quake(1));
    const after = byId('quake-1');
    expect(after.dockedTo).toBe('bl');
    expect([after.x, after.y, after.width, after.height]).toEqual([
      before.x,
      before.y,
      before.width,
      before.height,
    ]);
  });
});

describe('panels opened locked (widgets, pop-outs, fuel zones)', () => {
  it('open locked and close nothing', () => {
    const s = usePanelStore.getState();
    s.open(quake(1));
    s.open(widget);
    expect(ids()).toEqual(['quake-1', widget.id]);
    expect(byId(widget.id).locked).toBe(true);
  });

  it('survive map clicks like any locked panel', () => {
    const s = usePanelStore.getState();
    s.open(widget);
    s.open(quake(1));
    s.open(quake(2));
    expect(ids()).toEqual([widget.id, 'quake-2']);
  });
});

describe('lock actions', () => {
  it('toggleLock flips and setLocked sets', () => {
    const s = usePanelStore.getState();
    s.open(quake(1));
    s.toggleLock('quake-1');
    expect(byId('quake-1').locked).toBe(true);
    s.toggleLock('quake-1');
    expect(byId('quake-1').locked).toBe(false);
    s.setLocked('quake-1', true);
    expect(byId('quake-1').locked).toBe(true);
    s.setLocked('quake-1', true);
    expect(byId('quake-1').locked).toBe(true);
  });

  it('ignore unknown ids', () => {
    const s = usePanelStore.getState();
    s.open(quake(1));
    s.toggleLock('nope');
    s.setLocked('nope', true);
    expect(ids()).toEqual(['quake-1']);
    expect(byId('quake-1').locked).toBe(false);
  });

  it('close and closeAll remove locked panels too — an explicit close always wins', () => {
    const s = usePanelStore.getState();
    s.open(quake(1));
    s.toggleLock('quake-1');
    s.open(quake(2));
    s.toggleLock('quake-2');
    s.close('quake-1');
    expect(ids()).toEqual(['quake-2']);
    s.closeAll();
    expect(ids()).toEqual([]);
  });
});

describe('placement', () => {
  it('puts a lone popup in the first cascade slot every time', () => {
    const s = usePanelStore.getState();
    s.open(quake(1));
    expect(posOf('quake-1')).toEqual(slot(0));
    s.open(quake(2));
    expect(posOf('quake-2')).toEqual(slot(0));
  });

  it('cascades a new popup one step away from a locked one', () => {
    const s = usePanelStore.getState();
    s.open(quake(1));
    s.toggleLock('quake-1');
    s.open(quake(2));
    expect(posOf('quake-1')).toEqual(slot(0));
    expect(posOf('quake-2')).toEqual(slot(1));
  });

  it('treats a slot as taken when a locked panel is docked a few pixels off it', () => {
    // Docked top-right is (W-380, 100): 4px right and 12px below slot 0 — an
    // exact-match check would put the new popup right on top of it.
    const s = usePanelStore.getState();
    s.open(quake(1));
    s.toggleLock('quake-1');
    s.dock('quake-1', 'tr');
    expect(posOf('quake-1')).toEqual([1280 - 360 - 20, 80 + 20]);
    s.open(quake(2));
    expect(posOf('quake-2')).toEqual(slot(1));
  });

  it('reuses a cascade slot once the locked panel has been dragged out of it', () => {
    const s = usePanelStore.getState();
    s.open(quake(1));
    s.toggleLock('quake-1');
    s.updateRect('quake-1', { x: 5, y: 5 });
    s.open(quake(2));
    expect(posOf('quake-2')).toEqual(slot(0));
  });

  it('wraps to the first slot once all four cascade slots hold locked panels', () => {
    const s = usePanelStore.getState();
    for (let n = 1; n <= 4; n++) {
      s.open(quake(n));
      s.toggleLock(`quake-${n}`);
    }
    expect([1, 2, 3, 4].map((n) => posOf(`quake-${n}`))).toEqual([0, 1, 2, 3].map(slot));
    s.open(quake(5));
    expect(ids()).toHaveLength(5);
    expect(posOf('quake-5')).toEqual(slot(0));
  });
});
