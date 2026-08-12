// Playback timing, shared by both radar engines.

// Frame cadence during playback (ms). The dissolve occupies almost the whole
// interval — the incoming frame fades in continuously on top of the held one
// (zoom.earth's rolling dissolve), so playback reads as motion, not a
// slideshow. The small gap below the cadence absorbs timer jitter so a dissolve
// normally completes before the next tick supersedes it.
export const FRAME_MS = 800;
export const FADE_MS = 720;

// Clouds sit dimmer than radar in combined mode so precipitation stays the
// subject of the composition.
export const CLOUD_ALPHA = 0.7;
