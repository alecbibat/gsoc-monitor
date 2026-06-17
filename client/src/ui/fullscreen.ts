// Cross-browser Fullscreen API wrapper.
//
// Safari (desktop and iPadOS) only exposes the webkit-prefixed methods, and
// older Edge/IE used ms-prefixes. iPhone Safari exposes no element fullscreen
// API at all (only <video> can go fullscreen there) — for that case callers
// should fall back to the "Add to Home Screen" standalone PWA path.

interface FsElement extends HTMLElement {
  webkitRequestFullscreen?: () => Promise<void> | void;
  webkitRequestFullScreen?: () => Promise<void> | void;
  msRequestFullscreen?: () => Promise<void> | void;
}

interface FsDocument extends Document {
  webkitFullscreenElement?: Element | null;
  webkitCurrentFullScreenElement?: Element | null;
  msFullscreenElement?: Element | null;
  webkitExitFullscreen?: () => Promise<void> | void;
  webkitCancelFullScreen?: () => Promise<void> | void;
  msExitFullscreen?: () => Promise<void> | void;
}

export function fullscreenElement(): Element | null {
  const d = document as FsDocument;
  return (
    d.fullscreenElement ??
    d.webkitFullscreenElement ??
    d.webkitCurrentFullScreenElement ??
    d.msFullscreenElement ??
    null
  );
}

// True when the browser exposes *some* element-fullscreen API. False on iPhone
// Safari, where no programmatic fullscreen exists for non-video elements.
export function fullscreenSupported(): boolean {
  const el = document.documentElement as FsElement;
  return Boolean(
    el.requestFullscreen ||
      el.webkitRequestFullscreen ||
      el.webkitRequestFullScreen ||
      el.msRequestFullscreen
  );
}

export function requestFullscreen(el: HTMLElement = document.documentElement): void {
  const e = el as FsElement;
  const fn =
    e.requestFullscreen ||
    e.webkitRequestFullscreen ||
    e.webkitRequestFullScreen ||
    e.msRequestFullscreen;
  try {
    const r = fn?.call(e);
    if (r && typeof (r as Promise<void>).catch === 'function') {
      (r as Promise<void>).catch(() => {});
    }
  } catch {
    /* user gesture missing or denied — ignore */
  }
}

export function exitFullscreen(): void {
  const d = document as FsDocument;
  const fn = d.exitFullscreen || d.webkitExitFullscreen || d.webkitCancelFullScreen || d.msExitFullscreen;
  try {
    const r = fn?.call(d);
    if (r && typeof (r as Promise<void>).catch === 'function') {
      (r as Promise<void>).catch(() => {});
    }
  } catch {
    /* ignore */
  }
}

// Subscribe to fullscreen state changes across vendor prefixes. Returns an
// unsubscribe function.
export function onFullscreenChange(handler: () => void): () => void {
  const events = ['fullscreenchange', 'webkitfullscreenchange', 'MSFullscreenChange'];
  events.forEach((ev) => document.addEventListener(ev, handler));
  return () => events.forEach((ev) => document.removeEventListener(ev, handler));
}

// Running as an installed/home-screen web app (already chrome-free)?
export function isStandalone(): boolean {
  const nav = navigator as Navigator & { standalone?: boolean };
  return (
    nav.standalone === true ||
    (typeof window.matchMedia === 'function' && window.matchMedia('(display-mode: standalone)').matches)
  );
}

export function isIOS(): boolean {
  const ua = navigator.userAgent || '';
  const iOSDevice = /iPad|iPhone|iPod/.test(ua);
  // iPadOS 13+ reports as Mac; detect via touch points.
  const iPadOS = navigator.platform === 'MacIntel' && navigator.maxTouchPoints > 1;
  return iOSDevice || iPadOS;
}
