import { describe, expect, it } from 'vitest';
import { MARK_EXPIRED, MARK_HIDDEN, diffField, fieldMarkState } from './fieldModel';

const marks = (...keys: string[]) => keys.map((key) => ({ key }));
const sorted = (a: string[]) => [...a].sort();

describe('field diff', () => {
  it('splits a response into add / remove / keep', () => {
    const d = diffField(new Set(['a', 'b', 'c']), marks('b', 'c', 'd', 'e'));
    expect(d.add.map((m) => m.key)).toEqual(['d', 'e']);
    expect(d.remove).toEqual(['a']);
    expect(d.keep).toEqual(['b', 'c']);
  });

  it('works against the layer map as well as a set', () => {
    const held = new Map([
      ['a', 1],
      ['b', 2],
    ]);
    const d = diffField(held, marks('b'));
    expect(d.remove).toEqual(['a']);
    expect(d.keep).toEqual(['b']);
    expect(d.add).toEqual([]);
  });

  it('is idempotent: applying a diff then diffing again changes nothing', () => {
    const held = new Set(['a', 'b', 'x']);
    const next = marks('a', 'b', 'c', 'd');
    const d = diffField(held, next);
    for (const k of d.remove) held.delete(k);
    for (const m of d.add) held.add(m.key);
    const again = diffField(held, next);
    expect(again.add).toEqual([]);
    expect(again.remove).toEqual([]);
    expect(sorted(again.keep)).toEqual(['a', 'b', 'c', 'd']);
  });

  it('does not depend on the order of the response', () => {
    const held = new Set(['k1', 'k2', 'k3', 'k9']);
    const next = marks('k2', 'k4', 'k1', 'k5', 'k3');
    const a = diffField(held, next);
    const b = diffField(held, [...next].reverse());
    expect(sorted(a.add.map((m) => m.key))).toEqual(sorted(b.add.map((m) => m.key)));
    expect(sorted(a.remove)).toEqual(sorted(b.remove));
    expect(sorted(a.keep)).toEqual(sorted(b.keep));
  });

  it('treats a repeated key as one mark', () => {
    const d = diffField(new Set<string>(), marks('a', 'a', 'b'));
    expect(d.add.map((m) => m.key)).toEqual(['a', 'b']);
  });

  it('handles empty inputs', () => {
    expect(diffField(new Set(['a']), [])).toEqual({ add: [], remove: ['a'], keep: [] });
    expect(diffField(new Set<string>(), [])).toEqual({ add: [], remove: [], keep: [] });
  });
});

describe('field mark state', () => {
  const DAY = 86_400;

  it('steps through the palette stages with age', () => {
    expect(fieldMarkState(30, DAY, false)).toBe(0);
    expect(fieldMarkState(300, DAY, false)).toBe(1);
    expect(fieldMarkState(7_200, DAY, false)).toBe(4);
    expect(fieldMarkState(DAY - 1, DAY, false)).toBe(6);
  });

  it('expires at 24 h whatever else applies', () => {
    expect(fieldMarkState(DAY, DAY, false)).toBe(MARK_EXPIRED);
    expect(fieldMarkState(DAY + 5, 3_600, true)).toBe(MARK_EXPIRED);
  });

  it('hides a mark whose live twin is drawn, and shows it once the twin retires', () => {
    expect(fieldMarkState(90, DAY, true)).toBe(MARK_HIDDEN);
    expect(fieldMarkState(121, DAY, false)).toBe(1);
  });

  it('hides marks older than the selected window without expiring them', () => {
    expect(fieldMarkState(3_599, 3_600, false)).toBe(3);
    expect(fieldMarkState(3_600, 3_600, false)).toBe(MARK_HIDDEN);
    expect(fieldMarkState(20_000, 6 * 3_600, false)).toBe(5);
    expect(fieldMarkState(30_000, 6 * 3_600, false)).toBe(MARK_HIDDEN);
  });

  it('counts clock-skewed future strikes as fresh', () => {
    expect(fieldMarkState(-3, DAY, false)).toBe(0);
  });
});
