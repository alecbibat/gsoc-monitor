// Small normalizers for NPS Data API text, links and dates.

const NAMED_ENTITIES: Record<string, string> = {
  amp: '&',
  lt: '<',
  gt: '>',
  quot: '"',
  apos: "'",
  nbsp: ' ',
  ndash: '–',
  mdash: '—',
  lsquo: '‘',
  rsquo: '’',
  ldquo: '“',
  rdquo: '”',
  hellip: '…',
  deg: '°',
};

function decodeEntities(s: string): string {
  return s.replace(/&(#x[0-9a-f]+|#\d+|[a-z]+);/gi, (m, body: string) => {
    if (body[0] === '#') {
      const code = body[1] === 'x' || body[1] === 'X' ? parseInt(body.slice(2), 16) : parseInt(body.slice(1), 10);
      return Number.isFinite(code) && code > 0 && code < 0x110000 ? String.fromCodePoint(code) : m;
    }
    return NAMED_ENTITIES[body.toLowerCase()] ?? m;
  });
}

/**
 * Plain text from an NPS text field. Most are plain already, but some carry
 * HTML (links, <p>, <br>) or entities. Paragraph breaks are kept as blank
 * lines; other runs of whitespace collapse.
 */
export function plainText(raw: string | null | undefined): string {
  if (!raw) return '';
  const withBreaks = raw
    .replace(/<\s*br\s*\/?>/gi, '\n')
    .replace(/<\/\s*(p|div|li|h[1-6])\s*>/gi, '\n\n')
    .replace(/<[^>]*>/g, '');
  return decodeEntities(withBreaks)
    .split(/\n\s*\n/)
    .map((para) => para.replace(/\s+/g, ' ').trim())
    .filter(Boolean)
    .join('\n\n');
}

/** An absolute http(s) URL, or null. NPS sometimes gives site-relative paths or blanks. */
export function absUrl(raw: string | null | undefined): string | null {
  const s = (raw ?? '').trim();
  if (!s) return null;
  if (s.startsWith('//')) return `https:${s}`;
  if (s.startsWith('/')) return `https://www.nps.gov${s}`;
  if (/^https?:\/\//i.test(s)) return s.replace(/^http:\/\/(www\.)?nps\.gov/i, 'https://www.nps.gov');
  if (/^www\./i.test(s)) return `https://${s}`;
  return null;
}

export interface NpsDate {
  /** The calendar day NPS states, YYYY-MM-DD. */
  day: string;
  /**
   * Epoch ms. NPS stamps carry no zone and are usually a bare date
   * ("2026-11-04 00:00:00.0"); a bare date maps to 12:00 UTC that day, which
   * falls on the same calendar day in every US time zone.
   */
  ms: number;
  /** True when NPS gave only a date (a midnight stamp), so no time should be shown. */
  dateOnly: boolean;
}

/** Parse an NPS timestamp: "2026-11-04 00:00:00.0", "2025-01-27 12:37:06.0", "2026-11-04", or ISO 8601. */
export function parseNpsDate(raw: string | null | undefined): NpsDate | null {
  const s = (raw ?? '').trim();
  if (!s) return null;
  const m = /^(\d{4})-(\d{2})-(\d{2})(?:[ T](\d{2}):(\d{2})(?::(\d{2})(?:\.\d+)?)?)?(Z|[+-]\d{2}:?\d{2})?$/.exec(s);
  if (!m) {
    const t = Date.parse(s);
    if (Number.isNaN(t)) return null;
    return { day: new Date(t).toISOString().slice(0, 10), ms: t, dateOnly: false };
  }
  const [, y, mo, d, hh, mm, ss, zone] = m;
  const day = `${y}-${mo}-${d}`;
  const midnight = !hh || (hh === '00' && mm === '00' && (!ss || ss === '00'));
  if (midnight && !zone) {
    return { day, ms: Date.UTC(+y, +mo - 1, +d, 12), dateOnly: true };
  }
  // A clock time without a zone: NPS's servers are on US time; read it as UTC,
  // which is close enough for "posted N hours ago".
  const ms = zone
    ? Date.parse(`${day}T${hh ?? '00'}:${mm ?? '00'}:${ss ?? '00'}${zone.length === 5 ? `${zone.slice(0, 3)}:${zone.slice(3)}` : zone}`)
    : Date.UTC(+y, +mo - 1, +d, +(hh ?? 0), +(mm ?? 0), +(ss ?? 0));
  if (Number.isNaN(ms)) return null;
  return { day, ms, dateOnly: false };
}
