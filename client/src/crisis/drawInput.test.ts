import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  classifyDrawClick, CLOSE_PX, DEDUP_PX, discardPrompt, drawKeyAction, minPoints, samePositions,
  STRAY_CLICK_MS, STRAY_CLICK_PX, swallowStrayClicks,
} from './drawInput';
import type { DrawLayerPoint } from './crisisStore';

// Input rules of the crisis layer draw tool (CrisisDrawController).

// A flat stand-in projection: 1° = 100 px.
const toWindow = (p: DrawLayerPoint) => ({ x: p.lon * 100, y: p.lat * 100 });
const pt = (lon: number, lat: number): DrawLayerPoint => ({ lon, lat });
const tri = [pt(0, 0), pt(1, 0), pt(1, 1)];

describe('classifyDrawClick', () => {
  it('closes an area when its first vertex is clicked', () => {
    expect(classifyDrawClick('polygon', tri, { x: 5, y: 5 }, toWindow)).toBe('close');
    expect(classifyDrawClick('polygon', tri, { x: CLOSE_PX + 1, y: 0 }, toWindow)).toBe('add');
  });

  it('needs a real triangle before the first vertex closes', () => {
    const two = tri.slice(0, 2);
    expect(classifyDrawClick('polygon', two, { x: 2, y: 2 }, toWindow)).toBe('add');
  });

  it('never closes a line on its first vertex (a loop route is legitimate)', () => {
    expect(classifyDrawClick('line', tri, { x: 2, y: 2 }, toWindow)).toBe('add');
  });

  it('ignores a click on the last vertex — the second click of a double-click', () => {
    expect(classifyDrawClick('polygon', tri, { x: 100 + 3, y: 100 - 3 }, toWindow)).toBe('ignore');
    expect(classifyDrawClick('line', [pt(0, 0)], { x: 2, y: 0 }, toWindow)).toBe('ignore');
    expect(classifyDrawClick('line', [pt(0, 0)], { x: DEDUP_PX + 1, y: 0 }, toWindow)).toBe('add');
  });

  it('adds the first vertex, and when a vertex cannot be projected', () => {
    expect(classifyDrawClick('polygon', [], { x: 0, y: 0 }, toWindow)).toBe('add');
    expect(classifyDrawClick('polygon', tri, { x: 0, y: 0 }, () => undefined)).toBe('add');
  });
});

const key = (k: string, target: object | null = null, extra: Partial<KeyboardEvent> = {}) => ({
  key: k,
  target: target as EventTarget | null,
  defaultPrevented: false,
  isComposing: false,
  ctrlKey: false,
  metaKey: false,
  altKey: false,
  ...extra,
});

describe('drawKeyAction', () => {
  it('maps Enter / Backspace / Esc on the page to finish / undo / cancel', () => {
    const body = { tagName: 'BODY', closest: () => null };
    expect(drawKeyAction(key('Enter', body))).toBe('finish');
    expect(drawKeyAction(key('Backspace', body))).toBe('undo');
    expect(drawKeyAction(key('Escape', body))).toBe('cancel');
    expect(drawKeyAction(key('a', body))).toBeNull();
    expect(drawKeyAction(key('Enter', null))).toBe('finish');
  });

  it('leaves every key typed into a field to the field — Esc included', () => {
    for (const target of [
      { tagName: 'INPUT', type: 'text' },
      { tagName: 'INPUT', type: 'search' },
      { tagName: 'TEXTAREA' },
      { tagName: 'SELECT' },
      { tagName: 'DIV', isContentEditable: true },
    ]) {
      for (const k of ['Enter', 'Backspace', 'Escape']) expect(drawKeyAction(key(k, target))).toBeNull();
    }
    // A checkbox is not text entry: the shortcuts still apply.
    expect(drawKeyAction(key('Backspace', { tagName: 'INPUT', type: 'checkbox' }))).toBe('undo');
  });

  it('does not finish on Enter that activates a focused button or link', () => {
    expect(drawKeyAction(key('Enter', { tagName: 'BUTTON' }))).toBeNull();
    const inLink = { tagName: 'SPAN', closest: (s: string) => (s.includes('a[href]') ? {} : null) };
    expect(drawKeyAction(key('Enter', inLink))).toBeNull();
    // …but Esc and Backspace there are still the tool's.
    expect(drawKeyAction(key('Escape', { tagName: 'BUTTON' }))).toBe('cancel');
  });

  it('skips presses already claimed, mid-composition, or with modifiers', () => {
    expect(drawKeyAction(key('Escape', null, { defaultPrevented: true }))).toBeNull();
    expect(drawKeyAction(key('Enter', null, { isComposing: true }))).toBeNull();
    expect(drawKeyAction(key('Backspace', null, { metaKey: true }))).toBeNull();
    expect(drawKeyAction(key('Enter', null, { ctrlKey: true }))).toBeNull();
  });
});

describe('discardPrompt', () => {
  it('asks only once there are at least 2 placed points', () => {
    expect(discardPrompt(0, false)).toBeNull();
    expect(discardPrompt(1, true)).toBeNull();
    expect(discardPrompt(2, false)).toMatch(/Discard the 2 points/);
  });

  it('says what happens to the saved shape', () => {
    expect(discardPrompt(5, true)).toMatch(/keeps its previous shape/);
    expect(discardPrompt(5, false)).toMatch(/stays empty/);
  });
});

describe('minPoints / samePositions', () => {
  it('knows each geometry’s minimum', () => {
    expect([minPoints('point'), minPoints('line'), minPoints('polygon')]).toEqual([1, 2, 3]);
  });

  it('compares vertices by value and order', () => {
    expect(samePositions(tri, tri.map((p) => ({ ...p })))).toBe(true);
    expect(samePositions(tri, [...tri].reverse())).toBe(false); // ⇄ Flip
    expect(samePositions(tri, tri.slice(0, 2))).toBe(false);
  });
});

describe('swallowStrayClicks', () => {
  afterEach(() => { vi.useRealTimers(); });

  const press = (type: string, x: number, y: number) =>
    Object.assign(new Event(type, { cancelable: true }), { clientX: x, clientY: y });
  // What sits behind the swallower (React's root listener, the globe's canvas).
  const setup = () => {
    vi.useFakeTimers();
    const target = new EventTarget();
    const stop = swallowStrayClicks(target, { x: 100, y: 100 });
    const reached: string[] = [];
    for (const type of ['pointerdown', 'mousedown', 'click', 'dblclick', 'touchend']) {
      target.addEventListener(type, () => reached.push(type));
    }
    const send = (e: Event) => { target.dispatchEvent(e); return e.defaultPrevented; };
    return { stop, reached, send };
  };

  it("swallows the rest of a double-click on the finishing point, and nothing that isn't", () => {
    const { reached, send } = setup();
    expect(send(press('pointerdown', 103, 98))).toBe(true);
    expect(send(press('mousedown', 103, 98))).toBe(true); // no focus for a field underneath
    expect(send(press('click', 103, 98))).toBe(true);
    expect(reached).toEqual([]);
    // A deliberate click somewhere else goes through.
    expect(send(press('click', 100 + STRAY_CLICK_PX + 5, 100))).toBe(false);
    expect(reached).toEqual(['click']);
  });

  it('stops after the double-click, or after a moment, whichever is first', () => {
    const a = setup();
    expect(a.send(press('dblclick', 100, 100))).toBe(true);
    expect(a.send(press('click', 100, 100))).toBe(false);

    const b = setup();
    vi.advanceTimersByTime(STRAY_CLICK_MS);
    expect(b.send(press('click', 100, 100))).toBe(false);
    expect(b.reached).toEqual(['click']);
  });

  it('reads a touch position from changedTouches', () => {
    const { send } = setup();
    const tap = Object.assign(new Event('touchend', { cancelable: true }), { changedTouches: [{ clientX: 101, clientY: 99 }] });
    expect(send(tap)).toBe(true);
  });
});
