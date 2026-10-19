import { describe, expect, it, vi } from 'vitest';

describe('nominatimTurn', () => {
  it('hands out turns at least 1.1 s apart, in call order, and lets a caller decline a long wait', async () => {
    vi.useFakeTimers();
    vi.resetModules();
    const { nominatimTurn } = await import('./nominatimGate');
    const order: string[] = [];
    const now = () => Date.now();
    const a = nominatimTurn(Infinity, now).then(() => order.push('a'));
    const b = nominatimTurn(Infinity, now).then(() => order.push('b'));
    const c = nominatimTurn(Infinity, now).then(() => order.push('c'));
    // Third in line would wait 2.2 s: a caller capped at 2 s gives up, unqueued.
    expect(await nominatimTurn(2_000, now)).toBe(false);
    await vi.advanceTimersByTimeAsync(0);
    expect(order).toEqual(['a']);
    await vi.advanceTimersByTimeAsync(1_099);
    expect(order).toEqual(['a']);
    await vi.advanceTimersByTimeAsync(1);
    expect(order).toEqual(['a', 'b']);
    await vi.advanceTimersByTimeAsync(1_100);
    await Promise.all([a, b, c]);
    expect(order).toEqual(['a', 'b', 'c']);
    vi.useRealTimers();
  });
});
