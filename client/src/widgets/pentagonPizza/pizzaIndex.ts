// The "Pentagon Pizza Index" is an OSINT folk-indicator: unusual late-night
// pizza demand around the Pentagon has historically coincided with major
// national-security activity. There is no official feed, and Google's
// "popular times" isn't in any free API, so this module synthesises a
// believable, smoothly-varying activity signal from the local time of day.
// It's deliberately isolated behind one function so a real data source
// (Places/BestTime/scraper) can be dropped in later without touching the UI.

export interface Doughcon {
  level: 1 | 2 | 3 | 4 | 5;
  label: string;
  color: string;
}

const DOUGHCON_TABLE: Array<{ min: number } & Doughcon> = [
  { min: 85, level: 1, label: 'MAXIMUM', color: '#ff3b3b' },
  { min: 68, level: 2, label: 'HIGH', color: '#ff8a3d' },
  { min: 48, level: 3, label: 'ELEVATED', color: '#ffe14d' },
  { min: 28, level: 4, label: 'GUARDED', color: '#52a9ff' },
  { min: -1, level: 5, label: 'ROUTINE', color: '#52e3a4' },
];

export function doughconFor(index: number): Doughcon {
  const row = DOUGHCON_TABLE.find((r) => index >= r.min) ?? DOUGHCON_TABLE[DOUGHCON_TABLE.length - 1];
  return { level: row.level, label: row.label, color: row.color };
}

// The Pentagon keeps Eastern Time; derive the local hour wherever the viewer is.
function pentagonHour(date: Date): number {
  try {
    const parts = new Intl.DateTimeFormat('en-US', {
      timeZone: 'America/New_York',
      hour: 'numeric',
      hour12: false,
    }).formatToParts(date);
    const h = Number(parts.find((p) => p.type === 'hour')?.value);
    return Number.isFinite(h) ? h % 24 : date.getUTCHours();
  } catch {
    return date.getUTCHours();
  }
}

function pentagonWeekday(date: Date): number {
  // 0 = Sunday … 6 = Saturday, in Eastern Time.
  try {
    const wd = new Intl.DateTimeFormat('en-US', {
      timeZone: 'America/New_York',
      weekday: 'short',
    }).format(date);
    return ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'].indexOf(wd);
  } catch {
    return date.getUTCDay();
  }
}

/**
 * Deterministic 0–100 baseline for a given instant: quiet overnight, a dinner
 * bump, and — true to the meme — an elevated weeknight-late-hours floor.
 */
export function baselineActivity(date: Date): number {
  const h = pentagonHour(date) + date.getUTCMinutes() / 60;
  const wd = pentagonWeekday(date);
  const weekday = wd >= 1 && wd <= 5;

  // Smooth diurnal shape via a couple of gaussian "rushes".
  const bump = (center: number, width: number, height: number) =>
    height * Math.exp(-((h - center) ** 2) / (2 * width * width));

  let v = 18; // overnight/baseline floor
  v += bump(12.5, 1.6, 22); // lunch
  v += bump(19, 1.8, 34); // dinner
  if (weekday) v += bump(23.5, 2.2, 26); // the watched late-night window
  if (h >= 1 && h <= 6) v -= 8; // deep overnight lull

  return Math.max(5, Math.min(95, v));
}

/** One random-walk step toward a fresh baseline — keeps the gauge alive. */
export function nextSample(prev: number, date = new Date()): number {
  const target = baselineActivity(date);
  const drift = (target - prev) * 0.25; // pull toward baseline
  const noise = (Math.random() - 0.5) * 10; // jitter
  return Math.max(0, Math.min(100, prev + drift + noise));
}

// A few real pizzerias within delivery range of the Pentagon, used only to
// give the synthetic signal some texture (each gets a fixed offset).
export const PIZZERIAS: Array<{ name: string; area: string; offset: number }> = [
  { name: 'We, The Pizza', area: 'Crystal City', offset: 6 },
  { name: "Domino's", area: 'Pentagon City', offset: -4 },
  { name: '&pizza', area: 'Pentagon Row', offset: 2 },
  { name: 'Extreme Pizza', area: 'Pentagon Row', offset: -9 },
  { name: "Papa John's", area: 'Pentagon City', offset: 9 },
];
