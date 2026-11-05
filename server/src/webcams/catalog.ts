import { NPS_PARK_BY_CODE } from '../nps/parks';
import type { WebcamDef } from './types';

// ── The followed parks' webcams ──────────────────────────────────────────────
// Curated by hand: each entry was checked live (the image loads from a fixed
// URL and changes on its own schedule, or the stream plays). Includes the
// cameras NPS runs and those of the parks' official partners (conservancies
// and others). A camera that later breaks shows as unavailable or stale in
// the panel rather than disappearing; prune or fix it here.

export const WEBCAMS: readonly WebcamDef[] = [];

export const WEBCAM_BY_ID: ReadonlyMap<string, WebcamDef> = new Map(WEBCAMS.map((c) => [c.id, c]));

/** What's wrong with a catalog, if anything: duplicate ids, unknown parks, missing URLs, bad coordinates. */
export function catalogProblems(list: readonly WebcamDef[]): string[] {
  const problems: string[] = [];
  const seen = new Set<string>();
  for (const c of list) {
    if (!/^[a-z0-9-]+$/.test(c.id)) problems.push(`${c.id}: id must be a lowercase slug`);
    if (seen.has(c.id)) problems.push(`${c.id}: duplicate id`);
    seen.add(c.id);
    if (!NPS_PARK_BY_CODE.has(c.parkCode)) problems.push(`${c.id}: unknown park ${c.parkCode}`);
    if (!/^https?:\/\//.test(c.pageUrl)) problems.push(`${c.id}: pageUrl must be http(s)`);
    if (c.kind === 'image' && !/^https?:\/\//.test(c.imageUrl ?? '')) problems.push(`${c.id}: image camera without imageUrl`);
    if (c.kind === 'stream' && !/^https:\/\//.test(c.embedUrl ?? '')) problems.push(`${c.id}: stream camera without an https embedUrl`);
    if (!(Math.abs(c.lat) <= 90 && Math.abs(c.lon) <= 180) || (c.lat === 0 && c.lon === 0)) {
      problems.push(`${c.id}: bad coordinates`);
    }
    if (!(c.refreshSec >= 10)) problems.push(`${c.id}: refreshSec must be at least 10`);
  }
  return problems;
}
