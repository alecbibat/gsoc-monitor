import type { DrawGeometry, DrawLayerPoint } from './crisisStore';
import { isTextEntry } from '../lib/isTextEntry';

// Pure input rules for CrisisDrawController (kept Cesium- and DOM-free — a
// plain EventTarget at most — so they can be unit-tested).

/** Fewest vertices a finished shape of this geometry needs. */
export const minPoints = (g: DrawGeometry): number => (g === 'point' ? 1 : g === 'line' ? 2 : 3);

// Screen-pixel thresholds, as in the fuel-zone tool.
export const CLOSE_PX = 14; // click within this of the first vertex → close the area
export const DEDUP_PX = 8; // click within this of the last vertex → double-click jitter, not a vertex

interface Px { x: number; y: number }

/**
 * What a left click does to a line/area being drawn:
 *  - 'close'  — an area with at least 3 vertices, clicked on (near) its first
 *               vertex: finish it. The first vertex is drawn larger for this.
 *  - 'ignore' — the click landed on the previous vertex: the second click of a
 *               double-click (or a shaky tap), which must not add a duplicate.
 *  - 'add'    — place a new vertex.
 * `toWindow` projects a vertex to window pixels (undefined when it can't be
 * projected, e.g. behind the camera).
 */
export function classifyDrawClick(
  geometry: DrawGeometry,
  points: readonly DrawLayerPoint[],
  click: Px,
  toWindow: (p: DrawLayerPoint) => Px | undefined
): 'close' | 'ignore' | 'add' {
  const near = (p: DrawLayerPoint, px: number) => {
    const w = toWindow(p);
    return !!w && Math.hypot(w.x - click.x, w.y - click.y) < px;
  };
  if (geometry === 'polygon' && points.length >= 3 && near(points[0], CLOSE_PX)) return 'close';
  if (points.length > 0 && near(points[points.length - 1], DEDUP_PX)) return 'ignore';
  return 'add';
}

// A click that finishes the shape (closing an area on its first vertex,
// placing a marker) hands the screen back to the incident workspace at once:
// React re-renders it before the rest of a double-click — which the toolbar
// hint invites — or a double-tap arrives.
export const STRAY_CLICK_MS = 500;
export const STRAY_CLICK_PX = 24;
const STRAY_EVENTS = [
  'pointerdown', 'mousedown', 'touchstart', 'pointerup', 'mouseup', 'touchend', 'click', 'dblclick',
] as const;

function eventPoint(e: Event): Px | null {
  const m = e as Partial<MouseEvent>;
  if (typeof m.clientX === 'number' && typeof m.clientY === 'number') return { x: m.clientX, y: m.clientY };
  const t = (e as Partial<TouchEvent>).changedTouches?.[0];
  return t ? { x: t.clientX, y: t.clientY } : null;
}

/**
 * Swallow the follow-up presses of a finishing click for a moment: listen at
 * the window's CAPTURE phase (ahead of React and of Cesium), and stop every
 * press near `at` (client pixels) until the double-click is over or
 * `STRAY_CLICK_MS` has passed — so it can't press a button, focus a field or
 * pick an entity on the globe behind the workspace. A deliberate click
 * elsewhere passes. Returns a function that stops early.
 */
export function swallowStrayClicks(target: EventTarget, at: Px): () => void {
  const onEvent = (e: Event) => {
    const p = eventPoint(e);
    if (!p || Math.hypot(p.x - at.x, p.y - at.y) > STRAY_CLICK_PX) return;
    e.preventDefault();
    e.stopImmediatePropagation();
    if (e.type === 'dblclick') stop();
  };
  const stop = () => {
    clearTimeout(timer);
    for (const type of STRAY_EVENTS) target.removeEventListener(type, onEvent, { capture: true });
  };
  const timer = setTimeout(stop, STRAY_CLICK_MS);
  for (const type of STRAY_EVENTS) target.addEventListener(type, onEvent, { capture: true, passive: false });
  return stop;
}

type KeyLike = Pick<KeyboardEvent, 'key' | 'target' | 'defaultPrevented' | 'isComposing' | 'ctrlKey' | 'metaKey' | 'altKey'>;

// Elements that Enter activates natively: Enter there means "press this", not
// "finish the shape" (e.g. Enter on the focused Undo button).
const ACTIVATABLE = 'button, a[href], summary, [role="button"], [role="link"], [role="menuitem"]';
function isActivatable(target: EventTarget | null): boolean {
  if (!target || typeof target !== 'object') return false;
  const el = target as { tagName?: unknown; closest?: unknown };
  const tag = typeof el.tagName === 'string' ? el.tagName.toUpperCase() : '';
  if (tag === 'BUTTON' || tag === 'SUMMARY') return true;
  return typeof el.closest === 'function' && (el.closest as (s: string) => unknown).call(el, ACTIVATABLE) != null;
}

/**
 * The draw shortcut a key press triggers, if any. Keys typed into a field
 * (TopBar search, a panel input) belong to that field — Esc included, which
 * there dismisses the field's own UI — and presses another handler already
 * claimed (a modal's Esc) or IME composition are left alone.
 */
export function drawKeyAction(e: KeyLike): 'finish' | 'undo' | 'cancel' | null {
  if (e.defaultPrevented || e.isComposing) return null;
  if (e.ctrlKey || e.metaKey || e.altKey) return null;
  if (isTextEntry(e.target)) return null;
  if (e.key === 'Escape') return 'cancel';
  if (e.key === 'Enter') return isActivatable(e.target) ? null : 'finish';
  if (e.key === 'Backspace') return 'undo';
  return null;
}

/**
 * The confirmation to show before discarding an in-progress drawing, or null
 * when there is too little to lose to ask (a stray Esc on one vertex).
 * Cancelling never touches the saved shape — it only drops the new vertices.
 */
export function discardPrompt(placed: number, hasSavedShape: boolean): string | null {
  if (placed < 2) return null;
  return `Discard the ${placed} points you've placed?\n\n${
    hasSavedShape ? 'The layer keeps its previous shape.' : 'The layer stays empty until it is drawn.'
  }`;
}

/** Same vertices in the same order (by value — a synced copy is a new array). */
export function samePositions(a: readonly DrawLayerPoint[], b: readonly DrawLayerPoint[]): boolean {
  return a.length === b.length && a.every((p, i) => p.lat === b[i].lat && p.lon === b[i].lon);
}
