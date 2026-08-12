// Warms the playback loop.
//
// Instant scrubbing was v1's one genuine virtue: every frame already had a
// layer, so every frame was already downloaded. v2 loads lazily, so without
// this the first pass through the timeline would stutter. The replacement is a
// warmed horizon — decode every timeline frame's copy of the visible tiles into
// the worker field cache ahead of the playhead, so displaying a frame is a LUT
// pass over memory rather than a download.
//
// Warming is deliberately timid. It yields to the visible layer, runs two
// requests at a time, and goes through Cesium's RequestScheduler like any other
// imagery so it competes on the same per-server budget instead of starving the
// tiles someone is actually looking at.

import * as Cesium from 'cesium';
import type { RadarFrame } from '../../types';
import type { RadarPaletteId } from './palettes';
import { radarTileUrl } from './RainViewerImagery';
import { recentTiles } from './visibleTiles';
import { isTileWarm, warmTile } from './worker/pool';

const MAX_CONCURRENT = 2;
// How long to wait before retrying after the scheduler declines a warm fetch
// (it declines because the visible layer is using the server slots, which is
// exactly the right outcome — just try again shortly).
const BACKOFF_MS = 400;

interface PlanEntry {
  key: string;
  url: string;
  level: number;
}

export interface PrefetchDeps {
  host: string;
  palette: () => RadarPaletteId;
  // True while the visible layer still has tiles outstanding. Warming pauses,
  // so the frame on screen always wins the race for bandwidth.
  busy: () => boolean;
  onProgress: (ready: number) => void;
}

export class RadarPrefetcher {
  private readonly deps: PrefetchDeps;
  private plan: PlanEntry[] = [];
  private cursor = 0;
  private inFlight = 0;
  private warmed = 0;
  private timer: number | null = null;
  private destroyed = false;
  // Retained so the backoff can re-plan rather than just resume. On the first
  // pass the visible tile set is usually still EMPTY — Cesium has not asked for
  // anything yet — and a plan built then would stay empty forever, holding
  // `loopReady` at 0 and (because playback waits on it) never producing the
  // playhead change that would have triggered the next re-plan.
  private lastFrames: RadarFrame[] = [];
  private lastPlayhead = 0;

  constructor(deps: PrefetchDeps) {
    this.deps = deps;
  }

  destroy(): void {
    this.destroyed = true;
    if (this.timer != null) clearTimeout(this.timer);
    this.timer = null;
    this.plan = [];
  }

  // Rebuild the warming plan. Frames nearest the playhead come first, so the
  // horizon grows outward from where playback is about to be rather than from
  // the start of the timeline.
  update(frames: RadarFrame[], playhead: number): void {
    if (this.destroyed) return;
    this.lastFrames = frames;
    this.lastPlayhead = playhead;
    const coords = recentTiles();
    if (frames.length === 0 || coords.length === 0) {
      this.plan = [];
      this.cursor = 0;
      this.report();
      // Nothing to warm YET — try again once the visible layer has asked for
      // some tiles.
      this.schedule();
      return;
    }

    const order = [...frames.keys()].sort(
      (a, b) => frameDistance(a, playhead, frames.length) - frameDistance(b, playhead, frames.length)
    );

    const plan: PlanEntry[] = [];
    for (const i of order) {
      const frame = frames[i];
      for (const c of coords) {
        plan.push({
          key: `${frame.path}|${c.level}/${c.x}/${c.y}`,
          url: radarTileUrl(this.deps.host, frame, c.level, c.x, c.y),
          level: c.level,
        });
      }
    }
    this.plan = plan;
    this.cursor = 0;
    this.pump();
  }

  private report(): void {
    const total = this.plan.length;
    this.deps.onProgress(total === 0 ? 0 : Math.min(1, this.warmed / total));
  }

  // Re-plan after a backoff rather than merely resuming: the visible tile set
  // may have appeared or moved since, and re-planning covers both.
  private schedule(): void {
    if (this.destroyed || this.timer != null) return;
    this.timer = setTimeout(() => {
      this.timer = null;
      if (!this.destroyed) this.update(this.lastFrames, this.lastPlayhead);
    }, BACKOFF_MS) as unknown as number;
  }

  private pump(): void {
    if (this.destroyed) return;

    // Recount from scratch: the plan may have just been rebuilt, and tiles the
    // visible layer loaded on its own count as warm too.
    this.warmed = 0;
    for (const entry of this.plan) if (isTileWarm(entry.key)) this.warmed++;
    this.report();

    if (this.deps.busy()) {
      this.schedule();
      return;
    }

    while (this.inFlight < MAX_CONCURRENT && this.cursor < this.plan.length) {
      const entry = this.plan[this.cursor];
      if (isTileWarm(entry.key)) {
        this.cursor++;
        continue;
      }
      const job = warmTile(entry.key, entry.level, this.deps.palette(), () =>
        // Warming shares the imagery budget rather than going around it. A
        // declined fetch means the visible layer is using the slots; back off
        // and let it.
        new Cesium.Resource({
          url: entry.url,
          request: new Cesium.Request({
            throttle: true,
            throttleByServer: true,
            type: Cesium.RequestType.IMAGERY,
          }),
        }).fetchBlob()
      );
      if (!job) {
        this.schedule();
        return;
      }
      this.cursor++;
      this.inFlight++;
      job.done
        .catch(() => {
          // A tile that will not warm is not an error worth surfacing: it is
          // simply fetched again when it is displayed.
        })
        .finally(() => {
          this.inFlight--;
          if (!this.destroyed) this.pump();
        });
    }

    // Nothing left to start but work still in flight, or a plan that grew
    // between passes — keep a slow heartbeat so progress finishes reporting.
    if (this.cursor < this.plan.length || this.inFlight > 0) this.schedule();
  }
}

// Distance from the playhead going FORWARD around the loop, so the frames
// playback is about to reach are warmed before the ones behind it.
function frameDistance(index: number, playhead: number, length: number): number {
  const ahead = (index - playhead + length) % length;
  // Frames just behind the playhead still matter (scrubbing back, loop wrap),
  // just less than the ones immediately ahead.
  return ahead <= length / 2 ? ahead : (length - ahead) * 1.5;
}
