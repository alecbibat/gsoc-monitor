import { describe, expect, it } from 'vitest';
import { isTextEntry } from './isTextEntry';

describe('isTextEntry', () => {
  it('is true for fields the user types into', () => {
    expect(isTextEntry({ tagName: 'INPUT', type: 'text' } as unknown as EventTarget)).toBe(true);
    expect(isTextEntry({ tagName: 'input', type: 'SEARCH' } as unknown as EventTarget)).toBe(true);
    expect(isTextEntry({ tagName: 'INPUT' } as unknown as EventTarget)).toBe(true); // no type → text
    expect(isTextEntry({ tagName: 'TEXTAREA' } as unknown as EventTarget)).toBe(true);
    expect(isTextEntry({ tagName: 'SELECT' } as unknown as EventTarget)).toBe(true);
    expect(isTextEntry({ tagName: 'DIV', isContentEditable: true } as unknown as EventTarget)).toBe(true);
  });

  it('is false for non-text inputs, other elements and non-elements', () => {
    for (const type of ['checkbox', 'radio', 'range', 'button', 'submit', 'reset', 'color', 'file', 'image']) {
      expect(isTextEntry({ tagName: 'INPUT', type } as unknown as EventTarget)).toBe(false);
    }
    expect(isTextEntry({ tagName: 'BUTTON' } as unknown as EventTarget)).toBe(false);
    expect(isTextEntry({ tagName: 'DIV', isContentEditable: false } as unknown as EventTarget)).toBe(false);
    expect(isTextEntry(null)).toBe(false);
    expect(isTextEntry(undefined)).toBe(false);
    expect(isTextEntry({} as EventTarget)).toBe(false);
  });
});
