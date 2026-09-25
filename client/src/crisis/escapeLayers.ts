import { useEffect, useRef } from 'react';

// ── Esc inside the crisis workspace ──────────────────────────────────────────
// One Esc undoes one thing, innermost first:
//   1. modals (stand-down, report, picker, lightbox, delete confirm) claim it
//      themselves with a document/window CAPTURE listener + stopPropagation;
//      the admin page stops every keystroke at the document while it is open;
//   2. a React handler can claim it with preventDefault() (the overlay skips
//      defaultPrevented presses);
//   3. an open non-modal layer registered here (a dropdown, a side panel)
//      closes;
//   4. a focused text field is left (blurred) — the typing survives;
//   5. the incident steps back to the list; the list closes the workspace.
// CrisisOverlay runs steps 3–5 from its window BUBBLE listener, so everything
// above wins without coordination.
//
// Layers are a stack rather than a capture listener of their own: a capture
// listener would also swallow the Esc meant for a modal or the admin page
// opened on top of the dropdown.

type Layer = () => void;
const layers: Layer[] = [];

/** Register an Esc layer; returns its remover. Most recent registration closes first. */
export function pushEscapeLayer(onEscape: Layer): () => void {
  layers.push(onEscape);
  return () => {
    const i = layers.lastIndexOf(onEscape);
    if (i >= 0) layers.splice(i, 1);
  };
}

/**
 * Hand Esc to the innermost open layer. It stays registered until its owner
 * actually closes (the hook's cleanup removes it), so a layer that declines —
 * say, to confirm discarding a draft — gets the next Esc too.
 */
export function dismissTopEscapeLayer(): boolean {
  const top = layers[layers.length - 1];
  if (!top) return false;
  top();
  return true;
}

/** While `active`, Esc (when nothing more specific claims it) calls `onEscape`. */
export function useEscapeLayer(active: boolean, onEscape: () => void): void {
  const ref = useRef(onEscape);
  ref.current = onEscape;
  useEffect(() => {
    if (!active) return;
    return pushEscapeLayer(() => ref.current());
  }, [active]);
}

const NON_TEXT_INPUTS = new Set(['button', 'checkbox', 'color', 'file', 'image', 'radio', 'range', 'reset', 'submit']);

/** A field Esc should leave rather than close around: text inputs, textareas, selects, editables. */
export function isTextEntry(el: Element | null): el is HTMLElement {
  if (!el || !(el instanceof HTMLElement)) return false;
  if (el.isContentEditable) return true;
  if (el instanceof HTMLTextAreaElement || el instanceof HTMLSelectElement) return true;
  return el instanceof HTMLInputElement && !NON_TEXT_INPUTS.has(el.type);
}
