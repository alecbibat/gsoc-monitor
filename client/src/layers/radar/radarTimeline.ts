import type { RadarFrame } from '../../types';

// Pure timeline logic for the radar layer — no React or Cesium, so it's unit
// testable and shared by the layer, the scrubber and the sidebar status line.

export type RadarWindow = 30 | 60 | 120;
export const RADAR_WINDOWS: RadarWindow[] = [30, 60, 120];

export function windowLabel(w: RadarWindow): string {
  return w < 60 ? `${w} min` : `${w / 60} hr`;
}

export interface TimelineFrame {
  frame: RadarFrame;
  time: number; // epoch seconds
  forecast: boolean; // a nowcast frame rather than an observed one
}

// Observed frames inside the window — measured back from the newest observed
// frame rather than the wall clock, so a stale manifest still fills the
// window — followed by any forecast frames newer than it. Inputs are oldest →
// newest, as the manifest delivers them.
export function buildTimeline(
  past: RadarFrame[],
  nowcast: RadarFrame[],
  windowMinutes: number
): TimelineFrame[] {
  if (past.length === 0) return [];
  const latest = past[past.length - 1].time;
  const cutoff = latest - windowMinutes * 60;
  return [
    ...past.filter((f) => f.time >= cutoff).map((f) => ({ frame: f, time: f.time, forecast: false })),
    ...nowcast.filter((f) => f.time > latest).map((f) => ({ frame: f, time: f.time, forecast: true })),
  ];
}

// Index of the newest observed frame: where playback opens and where the
// scrubber draws its "now" divider.
export function nowIndex(timeline: TimelineFrame[]): number {
  for (let i = timeline.length - 1; i >= 0; i--) {
    if (!timeline[i].forecast) return i;
  }
  return 0;
}

export function clampIndex(index: number, length: number): number {
  if (length <= 0) return 0;
  return Math.min(Math.max(0, Math.floor(index)), length - 1);
}

// Next playback index, wrapping to the start after the last frame.
export function nextIndex(index: number, length: number): number {
  if (length <= 0) return 0;
  return (clampIndex(index, length) + 1) % length;
}

// Cheap identity for a manifest, so an unchanged poll doesn't churn the store
// (and with it the imagery layer stack).
export function manifestSignature(host: string, past: RadarFrame[], nowcast: RadarFrame[]): string {
  return `${host}|${past.map((f) => f.path).join(',')}|${nowcast.map((f) => f.path).join(',')}`;
}

// Local clock time, e.g. "2:40 PM".
export function formatClock(epochSec: number): string {
  return new Date(epochSec * 1000).toLocaleTimeString(undefined, {
    hour: 'numeric',
    minute: '2-digit',
  });
}

// Offset from the newest observed frame: "Latest", "−20 min", "+10 min", "−1h 10m".
export function formatOffset(deltaSec: number): string {
  const m = Math.round(deltaSec / 60);
  if (m === 0) return 'Latest';
  const sign = m > 0 ? '+' : '−';
  const a = Math.abs(m);
  if (a < 60) return `${sign}${a} min`;
  const h = Math.floor(a / 60);
  const r = a % 60;
  return r === 0 ? `${sign}${h} hr` : `${sign}${h}h ${r}m`;
}
