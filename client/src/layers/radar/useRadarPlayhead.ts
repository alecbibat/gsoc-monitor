import { useSyncExternalStore } from 'react';
import { radarPlayhead, type PlayheadState } from './radarPlayhead';

// The playhead minus its continuous position: what React renders (the frame
// named, play state, loading progress). The engine publishes every animation
// frame, but the snapshot below only changes identity when one of these coarse
// fields does, so components using it re-render a few times a second during
// playback, not at 60 fps. Whatever tracks `position` (the scrubber knob)
// subscribes to radarPlayhead directly and writes the DOM.
export type CoarsePlayhead = Omit<PlayheadState, 'position'>;

function coarse(s: PlayheadState): CoarsePlayhead {
  return {
    index: s.index,
    playing: s.playing,
    buffering: s.buffering,
    ready: s.ready,
    total: s.total,
    readyMask: s.readyMask,
    live: s.live,
  };
}

let snapshot: CoarsePlayhead = coarse(radarPlayhead.get());

function getSnapshot(): CoarsePlayhead {
  const s = radarPlayhead.get();
  const c = snapshot;
  if (
    c.index !== s.index ||
    c.playing !== s.playing ||
    c.buffering !== s.buffering ||
    c.ready !== s.ready ||
    c.total !== s.total ||
    c.readyMask !== s.readyMask ||
    c.live !== s.live
  ) {
    snapshot = coarse(s);
  }
  return snapshot;
}

export function useRadarPlayhead(): CoarsePlayhead {
  return useSyncExternalStore(radarPlayhead.subscribe, getSnapshot, getSnapshot);
}
