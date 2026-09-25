// Track geometry for the radar scrubber: tick marks, their time labels and the
// loaded-frames buffer bar. Pure (no React or DOM), so the spacing rules are
// unit-testable. Positions are by frame index, as the playhead moves: frame i
// sits at i / (n − 1) of the track.

export interface TimelineTick {
  index: number; // frame index
  at: number; // position along the track, 0–1
  major: boolean; // on the hour: drawn taller
  label: string | null;
  // How the label hangs off its tick: centred, or flush with the track's end
  // when centring would push it past the edge.
  align: 'start' | 'center' | 'end';
}

// Label spacing, in minutes: the finest step whose labels fit wins, so a short
// loop is labelled frame by frame and narrow tracks fall back to hourly (or
// coarser).
const LABEL_STEPS = [10, 30, 60, 120, 180];
export const LABEL_MIN_GAP_PX = 40; // centre to centre, however short the labels
const LABEL_PAD_PX = 8; // clear space between neighbouring labels
const LABEL_CHAR_PX = 5.2; // rough advance of a 9 px tabular label glyph
const MIN_TICK_GAP_PX = 4; // below this, per-frame ticks become a smear: majors only

let clockFmt: Intl.DateTimeFormat | null = null;
let hourFmt: Intl.DateTimeFormat | null = null;

// Short label for a tick: "5 PM" on the hour, "5:30" between (the day period
// is implied by its neighbours), "17:00" / "17:30" on 24-hour clocks.
export function tickLabel(epochSec: number): string {
  clockFmt ??= new Intl.DateTimeFormat(undefined, { hour: 'numeric', minute: '2-digit' });
  const d = new Date(epochSec * 1000);
  const parts = clockFmt.formatToParts(d);
  const twelveHour = parts.some((p) => p.type === 'dayPeriod');
  if (twelveHour && d.getMinutes() === 0) {
    hourFmt ??= new Intl.DateTimeFormat(undefined, { hour: 'numeric' });
    return hourFmt.format(d);
  }
  return parts
    .filter((p) => p.type !== 'dayPeriod')
    .map((p) => p.value)
    .join('')
    .trim();
}

function minuteOfDay(epochSec: number): number {
  const d = new Date(Math.round(epochSec / 60) * 60_000);
  return d.getHours() * 60 + d.getMinutes();
}

// Typical spacing between frames, in minutes (RainViewer: 10).
function frameStepMinutes(times: number[]): number {
  const diffs: number[] = [];
  for (let i = 1; i < times.length; i++) diffs.push(Math.round((times[i] - times[i - 1]) / 60));
  diffs.sort((a, b) => a - b);
  const median = diffs[Math.floor(diffs.length / 2)];
  return median > 0 ? median : 10;
}

function labelWidth(label: string): number {
  return label.length * LABEL_CHAR_PX;
}

// Where the frames sit relative to the clock's step boundaries, in minutes.
// Normally some frame lands on a whole ten minutes (0). In UTC+5:45, +8:45 and
// +12:45 every frame lands on :05, :15 … instead, so no frame would ever be on
// the hour or the half-hour: the steps are then counted from the frames' own
// offset, labelling every k-th frame (5:05, 5:35, 6:05) with the frame just
// past each hour drawn as the hour tick.
function gridPhase(minutes: number[], frameStep: number): number {
  if (minutes.some((m) => m % frameStep === 0)) return 0;
  const counts = new Map<number, number>();
  let phase = 0;
  let most = 0;
  for (const m of minutes) {
    const p = m % frameStep;
    const c = (counts.get(p) ?? 0) + 1;
    counts.set(p, c);
    if (c > most) {
      most = c;
      phase = p;
    }
  }
  return phase;
}

// Ticks to draw on a track `widthPx` wide for frames at `times` (epoch
// seconds, oldest first): one per frame (skipped when they'd crowd), taller on
// the hour, and labels at the finest step whose neighbours stay at least
// LABEL_MIN_GAP_PX apart without overlapping.
export function timelineTicks(times: number[], widthPx: number): TimelineTick[] {
  const n = times.length;
  if (n < 2 || !(widthPx > 0)) return [];
  const pxPerFrame = widthPx / (n - 1);
  const frameStep = frameStepMinutes(times);
  const raw = times.map(minuteOfDay);
  const phase = gridPhase(raw, frameStep);
  const minutes = raw.map((m) => (m - phase + 1440) % 1440);

  // Pick the label step.
  let labelled: Map<number, string> = new Map();
  for (const step of LABEL_STEPS) {
    if (step < frameStep) continue;
    const picks: Array<{ i: number; label: string; x: number }> = [];
    for (let i = 0; i < n; i++) {
      if (minutes[i] % step === 0) picks.push({ i, label: tickLabel(times[i]), x: i * pxPerFrame });
    }
    const fits = picks.every((p, k) => {
      if (k === 0) return true;
      const q = picks[k - 1];
      const gap = p.x - q.x;
      return gap >= LABEL_MIN_GAP_PX && gap >= (labelWidth(p.label) + labelWidth(q.label)) / 2 + LABEL_PAD_PX;
    });
    if (fits) {
      labelled = new Map(picks.map((p) => [p.i, p.label]));
      break;
    }
  }

  const ticks: TimelineTick[] = [];
  for (let i = 0; i < n; i++) {
    const major = minutes[i] % 60 === 0;
    const label = labelled.get(i) ?? null;
    if (!major && !label && pxPerFrame < MIN_TICK_GAP_PX) continue;
    let align: TimelineTick['align'] = 'center';
    if (label) {
      const x = i * pxPerFrame;
      const half = labelWidth(label) / 2;
      if (x - half < 0) align = 'start';
      else if (x + half > widthPx) align = 'end';
    }
    ticks.push({ index: i, at: i / (n - 1), major, label, align });
  }
  return ticks;
}

// Runs of loaded frames in a playhead readiness mask ('1' = loaded), as
// inclusive [first, last] frame indices.
export function bufferRuns(mask: string): Array<[number, number]> {
  const runs: Array<[number, number]> = [];
  let start = -1;
  for (let i = 0; i <= mask.length; i++) {
    const on = mask[i] === '1';
    if (on && start < 0) start = i;
    else if (!on && start >= 0) {
      runs.push([start, i - 1]);
      start = -1;
    }
  }
  return runs;
}

export interface BufferSegment {
  from: number; // track position, in (fractional) frames
  to: number;
  forecast: boolean;
}

// The buffer bar's lit segments: each run of loaded frames spans half a frame
// either side of its frames (so neighbouring runs meet), split at the newest
// observed frame `nowIdx` so the forecast part can be drawn in its own style.
export function bufferSegments(mask: string, nowIdx: number): BufferSegment[] {
  const last = mask.length - 1;
  const segments: BufferSegment[] = [];
  for (const [a, b] of bufferRuns(mask)) {
    const from = Math.max(0, a - 0.5);
    const to = Math.min(last, b + 0.5);
    if (from < nowIdx) segments.push({ from, to: Math.min(to, nowIdx), forecast: false });
    if (to > nowIdx) segments.push({ from: Math.max(from, nowIdx), to, forecast: true });
  }
  return segments;
}
