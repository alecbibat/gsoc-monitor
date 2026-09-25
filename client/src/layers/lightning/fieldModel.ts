// The 24 h field: the server's stable sample of the view box, held as one
// billboard per strike key. Two pure pieces live here so they can be tested
// without WebGL:
//   - diffField(): what a new /field response changes. The server's sample is
//     stable (a mark stays put from poll to poll, zooming in only adds), so a
//     refresh is a small add/remove against thousands of kept marks — the layer
//     never clears and re-adds the collection.
//   - fieldMarkState(): what one mark should look like right now.
import { stageIndexForAge } from './lightningPalette';

export interface FieldDiff<M> {
  /** Marks in the response that aren't held yet (first occurrence of a key). */
  add: M[];
  /** Held keys the response no longer carries. */
  remove: string[];
  /** Held keys the response still carries — left untouched. */
  keep: string[];
}

/** Anything keyed: a Set of keys or the layer's Map of marks. */
export interface KeySet {
  has(key: string): boolean;
  keys(): IterableIterator<string>;
}

export function diffField<M extends { key: string }>(current: KeySet, next: readonly M[]): FieldDiff<M> {
  const add: M[] = [];
  const keep: string[] = [];
  const seen = new Set<string>();
  for (const m of next) {
    if (seen.has(m.key)) continue; // a key twice in one response is one mark
    seen.add(m.key);
    if (current.has(m.key)) keep.push(m.key);
    else add.push(m);
  }
  const remove: string[] = [];
  for (const k of current.keys()) if (!seen.has(k)) remove.push(k);
  return { add, remove, keep };
}

/** The mark has reached 24 h: drop it and recycle its billboard. */
export const MARK_EXPIRED = -1;
/** Held but not drawn: its live twin is showing, or it's older than the window. */
export const MARK_HIDDEN = -2;

/**
 * A field mark's state: its colour stage (≥ 0), MARK_HIDDEN or MARK_EXPIRED.
 * The layer applies it only when it differs from the mark's current state, so
 * a settled field costs one comparison per mark per tick.
 *
 * `liveTwin`: the same strike is in the live pool and already drawn as a white
 * X; the field copy stays hidden until that entry retires, so a strike is
 * never drawn twice and never blinks out at the hand-over.
 * `windowS`: the selected window. Older marks are hidden client-side only —
 * the server always sends the full 24 h, so switching windows is instant.
 */
export function fieldMarkState(ageS: number, windowS: number, liveTwin: boolean): number {
  const stage = stageIndexForAge(ageS);
  if (stage < 0) return MARK_EXPIRED;
  if (liveTwin || ageS >= windowS) return MARK_HIDDEN;
  return stage;
}
