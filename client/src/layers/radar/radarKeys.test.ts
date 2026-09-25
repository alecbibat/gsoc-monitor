import { describe, expect, it, vi } from 'vitest';
import { radarKeyAction, radarKeyFor, runRadarKeyAction, type RadarKeyAction } from './radarKeys';
import type { RadarController } from './radarPlayhead';

// Radar loop hotkeys (RadarHotkeys) and the scrubber track's keys.

const body = { tagName: 'BODY', closest: () => null };
const key = (k: string, target: object | null = body, extra: Partial<KeyboardEvent> = {}) => ({
  key: k,
  target: target as EventTarget | null,
  shiftKey: false,
  repeat: false,
  defaultPrevented: false,
  isComposing: false,
  ctrlKey: false,
  metaKey: false,
  altKey: false,
  ...extra,
});
const on = { active: true, blocked: false };

describe('radarKeyAction', () => {
  it('maps Space, the arrows and Home/End on the page', () => {
    expect(radarKeyAction(key(' '), on)).toBe('toggle');
    expect(radarKeyAction(key('ArrowLeft'), on)).toBe('prev');
    expect(radarKeyAction(key('ArrowRight'), on)).toBe('next');
    expect(radarKeyAction(key('ArrowLeft', body, { shiftKey: true }), on)).toBe('prev3');
    expect(radarKeyAction(key('ArrowRight', body, { shiftKey: true }), on)).toBe('next3');
    expect(radarKeyAction(key('Home'), on)).toBe('oldest');
    expect(radarKeyAction(key('End'), on)).toBe('latest');
    expect(radarKeyAction(key('a'), on)).toBeNull();
    expect(radarKeyAction(key('ArrowUp'), on)).toBeNull();
    expect(radarKeyAction(key(' ', null), on)).toBe('toggle');
  });

  it('does nothing while the layer is off or another mode owns the keyboard', () => {
    expect(radarKeyAction(key(' '), { active: false, blocked: false })).toBeNull();
    expect(radarKeyAction(key(' '), { active: true, blocked: true })).toBeNull();
  });

  it('leaves presses already claimed, IME composition and modifier chords alone', () => {
    expect(radarKeyAction(key(' ', body, { defaultPrevented: true }), on)).toBeNull();
    expect(radarKeyAction(key('ArrowLeft', body, { isComposing: true }), on)).toBeNull();
    for (const mod of ['ctrlKey', 'metaKey', 'altKey'] as const) {
      expect(radarKeyAction(key('ArrowLeft', body, { [mod]: true }), on)).toBeNull();
    }
  });

  it('holds Space, Home and End to one press but lets held arrows scrub', () => {
    expect(radarKeyAction(key(' ', body, { repeat: true }), on)).toBeNull();
    expect(radarKeyAction(key('End', body, { repeat: true }), on)).toBeNull();
    expect(radarKeyAction(key('ArrowRight', body, { repeat: true }), on)).toBe('next');
  });

  it('leaves every key typed into a field to the field', () => {
    for (const target of [
      { tagName: 'INPUT', type: 'text' },
      { tagName: 'INPUT', type: 'search' },
      { tagName: 'TEXTAREA' },
      { tagName: 'SELECT' },
      { tagName: 'DIV', isContentEditable: true },
    ]) {
      for (const k of [' ', 'ArrowLeft', 'Home']) expect(radarKeyAction(key(k, target), on)).toBeNull();
    }
  });

  it('leaves keys aimed at a focused control to the control', () => {
    // isTextEntry lets range inputs, checkboxes and buttons through — Space
    // would press the button AND toggle the loop, arrows move the slider AND
    // step a frame — so they're skipped here too.
    for (const target of [
      { tagName: 'INPUT', type: 'range' },
      { tagName: 'INPUT', type: 'checkbox' },
      { tagName: 'BUTTON' },
      { tagName: 'SUMMARY' },
    ]) {
      for (const k of [' ', 'ArrowLeft', 'End']) expect(radarKeyAction(key(k, target), on)).toBeNull();
    }
    // Inside a link, an ARIA widget (the scrubber's own role="slider" track,
    // a tab list, a menu), or a button's icon.
    for (const role of ['a[href]', '[role="slider"]', '[role="tablist"]', '[role="menuitem"]', 'button']) {
      const inside = { tagName: 'SPAN', closest: (s: string) => (s.split(', ').includes(role) ? {} : null) };
      expect(radarKeyAction(key(' ', inside), on)).toBeNull();
    }
    // A plain element that merely sits in the page is fair game.
    const plain = { tagName: 'DIV', closest: () => null };
    expect(radarKeyAction(key(' ', plain), on)).toBe('toggle');
  });
});

describe('radarKeyFor', () => {
  it('ignores the target (the focused track handles its own keys)', () => {
    expect(radarKeyFor(key('ArrowLeft', { tagName: 'DIV' }))).toBe('prev');
    expect(radarKeyFor(key('Spacebar'))).toBe('toggle');
    expect(radarKeyFor(key('ArrowLeft', body, { ctrlKey: true }))).toBeNull();
  });
});

describe('runRadarKeyAction', () => {
  it('drives the loop controller', () => {
    const control: RadarController = {
      play: vi.fn(),
      pause: vi.fn(),
      toggle: vi.fn(),
      scrub: vi.fn(),
      endScrub: vi.fn(),
      step: vi.fn(),
      latest: vi.fn(),
      oldest: vi.fn(),
      probe: vi.fn(async () => null),
    };
    const actions: RadarKeyAction[] = ['toggle', 'prev', 'next', 'prev3', 'next3', 'oldest', 'latest'];
    for (const a of actions) runRadarKeyAction(a, control);
    expect(control.toggle).toHaveBeenCalledTimes(1);
    expect(vi.mocked(control.step).mock.calls).toEqual([[-1], [1], [-3], [3]]);
    expect(control.oldest).toHaveBeenCalledTimes(1);
    expect(control.latest).toHaveBeenCalledTimes(1);
  });
});
