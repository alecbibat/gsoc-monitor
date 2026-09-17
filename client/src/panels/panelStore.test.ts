import { beforeEach, describe, expect, it } from 'vitest';
import { usePanelStore, type PanelOpenData } from './panelStore';

// The store is a module singleton — reset between tests.
beforeEach(() => {
  usePanelStore.setState({ panels: [], topZ: 10 });
});

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
    s.open(quake(1));
    s.open({ id: 'flight-1', kind: 'flights', title: 'UAL1', payload: {} });
    // Nothing to sweep yet but the one flight; add a third to prove the rule
    // isn't "close the previous one" but "close all unlocked".
    s.setLocked('flight-1', true);
    s.open(quake(2));
    s.setLocked('flight-1', false);
    s.open(quake(3));
    expect(ids()).toEqual(['quake-3']);
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
    s.open(quake(1)); // caller passes no `locked` — stays locked
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

describe('panels opened locked (widgets)', () => {
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
    const first = byId('quake-1');
    s.open(quake(2));
    const second = byId('quake-2');
    expect([second.x, second.y]).toEqual([first.x, first.y]);
  });

  it('offsets a new popup so it does not land exactly on a locked one', () => {
    const s = usePanelStore.getState();
    s.open(quake(1));
    s.toggleLock('quake-1');
    s.open(quake(2));
    const a = byId('quake-1');
    const b = byId('quake-2');
    expect([b.x, b.y]).not.toEqual([a.x, a.y]);
  });

  it('reuses a cascade slot once the locked panel has been dragged out of it', () => {
    const s = usePanelStore.getState();
    s.open(quake(1));
    s.toggleLock('quake-1');
    const slot0 = [byId('quake-1').x, byId('quake-1').y];
    s.updateRect('quake-1', { x: 5, y: 5 });
    s.open(quake(2));
    expect([byId('quake-2').x, byId('quake-2').y]).toEqual(slot0);
  });
});
