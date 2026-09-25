// Non-text <input> types: Backspace/Enter/Esc there aren't text editing, so
// global map-tool shortcuts keep working when one of these has focus.
const NON_TEXT_INPUT = new Set(['button', 'checkbox', 'color', 'file', 'image', 'radio', 'range', 'reset', 'submit']);

/**
 * True when a key event's target is a field the user is typing into — a text
 * <input>, <textarea>, <select> or contentEditable element. Global keyboard
 * shortcuts (map draw/measure tools) must leave those keystrokes to the field.
 *
 * Duck-typed on tagName rather than `instanceof HTMLElement`, so it also works
 * for elements from another document (iframes) and in DOM-less tests.
 */
export function isTextEntry(target: EventTarget | null | undefined): boolean {
  if (!target || typeof target !== 'object') return false;
  const el = target as { tagName?: unknown; isContentEditable?: unknown; type?: unknown };
  if (el.isContentEditable === true) return true;
  const tag = typeof el.tagName === 'string' ? el.tagName.toUpperCase() : '';
  if (tag === 'TEXTAREA' || tag === 'SELECT') return true;
  if (tag !== 'INPUT') return false;
  const type = typeof el.type === 'string' ? el.type.toLowerCase() : 'text';
  return !NON_TEXT_INPUT.has(type);
}
