// <input type="datetime-local"> speaks zone-less wall time ("2026-09-25T14:05").
// Storing that verbatim makes every other viewer read it as THEIR local time —
// a 14:05 start logged in Honolulu shows as 14:05 in New York. Store the
// instant (UTC ISO) instead and convert at the input boundary.

const pad = (n: number) => String(n).padStart(2, '0');

// Ends in Z or a ±hh:mm offset — i.e. names an instant, not a wall time.
const HAS_ZONE = /(?:Z|[+-]\d{2}:?\d{2})$/i;

/** Input value → stored instant. An empty (cleared) input stays empty. */
export function fromLocalInput(value: string): string {
  if (!value) return '';
  const d = new Date(value); // zone-less date-time strings parse as local time
  return Number.isNaN(d.getTime()) ? '' : d.toISOString();
}

/**
 * Stored value → input value ('YYYY-MM-DDTHH:mm', local). Legacy zone-less
 * values (written straight from the input before this conversion) pass
 * through unchanged: they are already in the input's format, and the zone
 * they were typed in is unknowable.
 */
export function toLocalInput(stored: string | null | undefined): string {
  if (!stored) return '';
  if (!HAS_ZONE.test(stored)) return stored;
  const d = new Date(stored);
  if (Number.isNaN(d.getTime())) return '';
  // The input only accepts a 4-digit year. Typing into its year field passes
  // through "0002", "0020", "0202" — an unpadded "2-03-01T09:30" would be
  // rejected and blank the field mid-keystroke.
  const year = String(d.getFullYear()).padStart(4, '0');
  return `${year}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`;
}

/** The current minute as a stored instant — what a "Now" button writes. */
export function nowForInput(now: Date = new Date()): string {
  return fromLocalInput(toLocalInput(now.toISOString()));
}
