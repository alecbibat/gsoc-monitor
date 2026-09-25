import { isTextEntry } from '../../lib/isTextEntry';
import { radarControl, type RadarController } from './radarPlayhead';

// Pure keyboard rules for the radar loop (RadarHotkeys, and the scrubber's
// own track). Kept DOM-free — targets are duck-typed — so they're unit-tested
// like the crisis draw tool's drawKeyAction.

export type RadarKeyAction = 'toggle' | 'prev' | 'next' | 'prev3' | 'next3' | 'oldest' | 'latest';

type KeyLike = Pick<
  KeyboardEvent,
  'key' | 'shiftKey' | 'repeat' | 'target' | 'defaultPrevented' | 'isComposing' | 'ctrlKey' | 'metaKey' | 'altKey'
>;

export interface RadarKeyContext {
  active: boolean; // the radar layer is on with a loop (2+ frames) to drive
  blocked: boolean; // another mode owns the keyboard: crisis workspace, a map tool, a tour, a report
}

// Focus targets whose own keyboard behaviour Space and the arrows belong to:
// Space presses a button or ticks a checkbox, arrows move a slider, a radio
// group, a tab list or a menu. Text fields are isTextEntry's job.
const INTERACTIVE_TAGS = new Set(['BUTTON', 'INPUT', 'SELECT', 'TEXTAREA', 'SUMMARY', 'AUDIO', 'VIDEO']);
const INTERACTIVE = [
  'button', 'a[href]', 'summary', 'input', 'select', 'textarea',
  ...[
    'button', 'link', 'menuitem', 'menuitemcheckbox', 'menuitemradio', 'menu', 'menubar',
    'slider', 'scrollbar', 'spinbutton', 'tab', 'tablist', 'radio', 'radiogroup', 'checkbox',
    'switch', 'option', 'listbox', 'combobox', 'textbox', 'tree', 'treegrid', 'grid',
  ].map((r) => `[role="${r}"]`),
].join(', ');

function ownsKeys(target: EventTarget | null): boolean {
  if (!target || typeof target !== 'object') return false;
  const el = target as { tagName?: unknown; closest?: unknown };
  const tag = typeof el.tagName === 'string' ? el.tagName.toUpperCase() : '';
  if (INTERACTIVE_TAGS.has(tag)) return true;
  return typeof el.closest === 'function' && (el.closest as (s: string) => unknown).call(el, INTERACTIVE) != null;
}

/**
 * The loop key a press maps to, ignoring where it was typed: Space toggles
 * play, ←/→ step a frame (Shift: three), Home/End jump to the oldest/latest
 * frame. Held Space/Home/End don't repeat; held arrows do (scrub through).
 */
export function radarKeyFor(e: Pick<KeyLike, 'key' | 'shiftKey' | 'repeat' | 'ctrlKey' | 'metaKey' | 'altKey'>): RadarKeyAction | null {
  if (e.ctrlKey || e.metaKey || e.altKey) return null;
  switch (e.key) {
    case ' ':
    case 'Spacebar':
      return e.repeat ? null : 'toggle';
    case 'ArrowLeft':
      return e.shiftKey ? 'prev3' : 'prev';
    case 'ArrowRight':
      return e.shiftKey ? 'next3' : 'next';
    case 'Home':
      return e.repeat ? null : 'oldest';
    case 'End':
      return e.repeat ? null : 'latest';
    default:
      return null;
  }
}

/**
 * The global radar shortcut a key press triggers, if any. Presses another
 * handler already claimed, IME composition, keys typed into a field and keys
 * aimed at a focused control (a button, the opacity slider, the scrubber's
 * own track — which handles them itself) are left alone.
 */
export function radarKeyAction(e: KeyLike, ctx: RadarKeyContext): RadarKeyAction | null {
  if (!ctx.active || ctx.blocked) return null;
  if (e.defaultPrevented || e.isComposing) return null;
  if (isTextEntry(e.target) || ownsKeys(e.target)) return null;
  return radarKeyFor(e);
}

export function runRadarKeyAction(action: RadarKeyAction, control: RadarController = radarControl): void {
  switch (action) {
    case 'toggle':
      control.toggle();
      break;
    case 'prev':
      control.step(-1);
      break;
    case 'next':
      control.step(1);
      break;
    case 'prev3':
      control.step(-3);
      break;
    case 'next3':
      control.step(3);
      break;
    case 'oldest':
      control.oldest();
      break;
    case 'latest':
      control.latest();
      break;
  }
}
