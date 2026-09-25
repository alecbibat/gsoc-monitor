import { afterEach, describe, expect, it, vi } from 'vitest';
import { publishTickerHeight, TICKER_HEIGHT_VAR } from './NewsTicker';

// A root element's inline style, reduced to the custom properties set on it.
function fakeRoot() {
  const props = new Map<string, string>();
  const style = {
    setProperty: (k: string, v: string) => void props.set(k, v),
    removeProperty: (k: string) => void props.delete(k),
  };
  return { root: { style } as unknown as HTMLElement, props };
}

describe('publishTickerHeight', () => {
  afterEach(() => vi.unstubAllGlobals());

  it('publishes the bar height, follows resizes and clears it on removal', () => {
    let onResize = () => {};
    const disconnect = vi.fn();
    vi.stubGlobal(
      'ResizeObserver',
      class {
        constructor(cb: () => void) {
          onResize = cb;
        }
        observe() {}
        disconnect = disconnect;
      }
    );
    const el = { offsetHeight: 36 } as HTMLElement;
    const { root, props } = fakeRoot();

    const stop = publishTickerHeight(el, root);
    expect(props.get(TICKER_HEIGHT_VAR)).toBe('36px');

    (el as { offsetHeight: number }).offsetHeight = 70; // wrapped headline / safe-area inset
    onResize();
    expect(props.get(TICKER_HEIGHT_VAR)).toBe('70px');

    stop();
    expect(props.has(TICKER_HEIGHT_VAR)).toBe(false);
    expect(disconnect).toHaveBeenCalled();
  });

  it('still publishes once without ResizeObserver', () => {
    vi.stubGlobal('ResizeObserver', undefined);
    const { root, props } = fakeRoot();
    const stop = publishTickerHeight({ offsetHeight: 40 } as HTMLElement, root);
    expect(props.get(TICKER_HEIGHT_VAR)).toBe('40px');
    stop();
    expect(props.size).toBe(0);
  });
});
