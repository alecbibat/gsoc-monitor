import { useEffect, useRef, useState, type ReactNode, type RefObject } from 'react';
import { useCesiumViewer } from '../../cesium/CesiumContext';
import { flyToLonLat } from '../../cesium/flyTo';
import type { WebcamInfo } from '../../types';
import { exitFullscreen, fullscreenElement, fullscreenSupported, onFullscreenChange, requestFullscreen } from '../../ui/fullscreen';
import { WebcamImage } from './WebcamImage';
import { refreshText, siteOf } from './webcamMeta';

// A camera's panel: its live still (refreshing) or its live video, who runs
// it, and the way to its source page and to its place on the map. A still
// camera whose operator also streams it gets a Still / Live video switch; the
// video plays in the operator's own player, with its branding (the
// Conservancy's donation banner included).
//
// Full screen belongs to the dashboard, not to the operator's player. The
// Conservancy player's exit button is small, hides when the mouse is still,
// and whenever the stream hiccups its "reconnecting" overlay covers it, which
// left no way out of full screen but the Esc key. So the player may not take
// the screen; the dashboard's button does instead, and while the camera fills
// the screen an Exit button stays in the corner.

/** Whether this browser can show an element full screen (iPhone Safari can't). */
export function canShowFullscreen(): boolean {
  return typeof document !== 'undefined' && fullscreenSupported();
}

/** True while the element behind `ref` is the one filling the screen. */
function useIsFullscreen(ref: RefObject<HTMLElement>): boolean {
  const [on, setOn] = useState(false);
  useEffect(() => {
    const update = () => setOn(ref.current !== null && fullscreenElement() === ref.current);
    update();
    return onFullscreenChange(update);
  }, [ref]);
  return on;
}

const ENTER_ICON = 'M3 9V5a2 2 0 0 1 2-2h4M21 9V5a2 2 0 0 0-2-2h-4M3 15v4a2 2 0 0 0 2 2h4M21 15v4a2 2 0 0 1-2 2h-4';
const EXIT_ICON = 'M9 3v3a3 3 0 0 1-3 3H3M21 9h-3a3 3 0 0 1-3-3V3M15 21v-3a3 3 0 0 1 3-3h3M3 15h3a3 3 0 0 1 3 3v3';

function FullscreenIcon({ path }: { path: string }) {
  return (
    <svg
      viewBox="0 0 24 24"
      className="h-[18px] w-[18px]"
      fill="none"
      stroke="currentColor"
      strokeWidth="2"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
    >
      <path d={path} />
    </svg>
  );
}

/**
 * The camera's picture or video with the dashboard's own full-screen button,
 * handed to the picture or video to place in its top-right corner: in the
 * panel, over the operator player's own button (which no longer works); full
 * screen, an Exit button that stays there.
 */
function CameraFrame({ name, children }: { name: string; children: (fill: boolean, control: ReactNode) => ReactNode }) {
  const ref = useRef<HTMLDivElement>(null);
  const fill = useIsFullscreen(ref);
  const control = fill ? (
    <button
      type="button"
      onClick={exitFullscreen}
      className="absolute right-4 top-4 z-10 flex items-center gap-2 rounded-lg border border-white/20 bg-black/75 px-3.5 py-2 text-[13px] font-semibold text-white shadow-lg backdrop-blur-sm transition hover:bg-black/90"
    >
      <FullscreenIcon path={EXIT_ICON} />
      Exit full screen
      <kbd className="rounded border border-white/25 px-1 font-sans text-[10.5px] text-white/55 [@media(pointer:coarse)]:hidden">
        Esc
      </kbd>
    </button>
  ) : canShowFullscreen() ? (
    <button
      type="button"
      onClick={() => ref.current && requestFullscreen(ref.current)}
      title={`Show ${name} full screen`}
      aria-label="Full screen"
      className="absolute right-1 top-1 z-10 rounded-md bg-black/60 p-[9px] text-white/85 shadow backdrop-blur-sm transition hover:bg-black/85 hover:text-white"
    >
      <FullscreenIcon path={ENTER_ICON} />
    </button>
  ) : null;
  return (
    <div ref={ref} className={fill ? 'flex h-full w-full flex-col bg-black' : undefined}>
      {children(fill, control)}
    </div>
  );
}

function WebcamStream({ cam, fill, control }: { cam: WebcamInfo; fill: boolean; control: ReactNode }) {
  if (!cam.embedUrl) return null;
  // The player may take the screen itself only where the dashboard can't
  // (iPhone, whose own video player always has a Done button).
  const playerFullscreen = !canShowFullscreen();
  const m = cam.embedMarginPx;
  // Full screen, the video gets the largest 16:9 box that fits, on black: the
  // player sizes itself to its width, so a taller box would show its page.
  return (
    <div className={fill ? 'flex min-h-0 flex-1 items-center justify-center' : undefined}>
      <div
        className={fill ? 'relative overflow-hidden bg-black' : 'relative aspect-video overflow-hidden rounded-lg border border-white/10 bg-black'}
        style={fill ? { width: 'min(100vw, 177.78vh)', height: 'min(100vh, 56.25vw)' } : undefined}
      >
        <iframe
          src={cam.embedUrl}
          title={`${cam.name} live video`}
          className="absolute"
          // Larger than the box by the embed page's own margin, which is cropped off.
          style={{ left: -m, top: -m, width: `calc(100% + ${2 * m}px)`, height: `calc(100% + ${2 * m}px)` }}
          allow={playerFullscreen ? 'autoplay; encrypted-media; picture-in-picture; fullscreen' : 'autoplay; encrypted-media; picture-in-picture'}
          allowFullScreen={playerFullscreen}
          referrerPolicy="strict-origin-when-cross-origin"
          loading="lazy"
        />
        {control}
      </div>
    </div>
  );
}

/** A camera whose operator allows it only on their own site. */
function WebcamLinkOut({ cam }: { cam: WebcamInfo }) {
  return (
    <div className="flex aspect-video flex-col items-center justify-center gap-2 rounded-lg border border-white/10 bg-black/40 px-4 text-center">
      <p className="text-[11.5px] leading-snug text-white/55">
        {cam.operator} shows this camera only on its own site; it can't be embedded here.
      </p>
      <a
        href={cam.pageUrl}
        target="_blank"
        rel="noopener noreferrer"
        className="rounded-md bg-emerald-500/20 px-3 py-1.5 text-[12px] font-semibold text-emerald-200 transition hover:bg-emerald-500/30"
      >
        Watch on {siteOf(cam.pageUrl)} ↗
      </a>
    </div>
  );
}

export function WebcamDetails({ payload: cam }: { payload: WebcamInfo }) {
  const viewer = useCesiumViewer();
  const [live, setLive] = useState(false);
  const canSwitch = cam.kind === 'image' && !!cam.embedUrl;
  const showStream = cam.kind === 'stream' || (canSwitch && live);
  return (
    <div className="space-y-2.5">
      {canSwitch && (
        <div className="flex gap-1 rounded-lg bg-white/5 p-1" role="group" aria-label="Camera view">
          {(['Still', 'Live video'] as const).map((label) => {
            const on = (label === 'Live video') === live;
            return (
              <button
                key={label}
                type="button"
                aria-pressed={on}
                onClick={() => setLive(label === 'Live video')}
                className={`flex-1 rounded-md py-1 text-[11px] font-semibold transition ${
                  on ? 'bg-emerald-500/20 text-emerald-200' : 'text-white/40 hover:text-white/70'
                }`}
              >
                {label}
              </button>
            );
          })}
        </div>
      )}
      {cam.kind === 'link' ? (
        <WebcamLinkOut cam={cam} />
      ) : (
        <CameraFrame name={cam.name}>
          {(fill, control) =>
            showStream ? <WebcamStream cam={cam} fill={fill} control={control} /> : <WebcamImage cam={cam} fill={fill} control={control} />
          }
        </CameraFrame>
      )}
      <div className="flex flex-wrap gap-1.5 text-[10px] font-semibold uppercase tracking-wider">
        <span className="rounded bg-emerald-500/15 px-1.5 py-0.5 text-emerald-200">{cam.park}</span>
        <span className="rounded bg-white/10 px-1.5 py-0.5 text-white/65">{cam.operator}</span>
        <span className="rounded bg-white/10 px-1.5 py-0.5 text-white/55">
          {cam.kind === 'link'
            ? `On ${siteOf(cam.pageUrl)}`
            : cam.kind === 'stream'
              ? 'Live video'
              : canSwitch
                ? `${refreshText(cam.refreshSec)} · live video`
                : refreshText(cam.refreshSec)}
        </span>
      </div>
      {cam.note && <p className="text-[12px] leading-snug text-white/70">{cam.note}</p>}
      <div className="flex flex-wrap items-center gap-x-4 gap-y-1 text-[11px]">
        <a href={cam.pageUrl} target="_blank" rel="noopener noreferrer" className="text-emerald-300/85 hover:text-emerald-200 hover:underline">
          Source page ↗
        </a>
        {viewer && (
          <button
            type="button"
            onClick={() => !viewer.isDestroyed() && flyToLonLat(viewer, cam.lon, cam.lat, 12_000)}
            className="ml-auto rounded border border-white/12 px-2 py-0.5 text-white/60 transition hover:bg-white/8 hover:text-white"
          >
            Show on map
          </button>
        )}
      </div>
      {cam.approxLocation && (
        <p className="text-[10px] leading-snug text-white/30">Marked at the place it shows; the camera itself may be nearby.</p>
      )}
    </div>
  );
}
