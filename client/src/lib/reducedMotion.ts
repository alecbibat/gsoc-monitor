// Some viewers ask for less motion (the OS / browser "reduce motion"
// setting); animated layers honour it by freezing or stepping instead.
//
// One MediaQueryList, created lazily. Its `.matches` is live, so a toggle
// mid-session is still honoured, and callers on per-frame paths don't
// re-parse the query (or allocate a new MediaQueryList) on every call.
let reducedMotionMql: MediaQueryList | null | undefined;

export function prefersReducedMotion(): boolean {
  if (reducedMotionMql === undefined) {
    reducedMotionMql =
      typeof window !== 'undefined' && typeof window.matchMedia === 'function'
        ? window.matchMedia('(prefers-reduced-motion: reduce)')
        : null;
  }
  return reducedMotionMql?.matches ?? false;
}
