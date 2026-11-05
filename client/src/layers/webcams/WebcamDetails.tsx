import { useState } from 'react';
import { useCesiumViewer } from '../../cesium/CesiumContext';
import { flyToLonLat } from '../../cesium/flyTo';
import type { WebcamInfo } from '../../types';
import { WebcamImage } from './WebcamImage';
import { refreshText, siteOf } from './webcamMeta';

// A camera's panel: its live still (refreshing) or its live video, who runs
// it, and the way to its source page and to its place on the map. A still
// camera whose operator also streams it gets a Still / Live video switch; the
// video plays in the operator's own player, with its branding (the
// Conservancy's donation banner included).

function WebcamStream({ cam }: { cam: WebcamInfo }) {
  if (!cam.embedUrl) return null;
  return (
    <div className="relative aspect-video overflow-hidden rounded-lg border border-white/10 bg-black">
      <iframe
        src={cam.embedUrl}
        title={`${cam.name} live video`}
        className="absolute inset-0 h-full w-full"
        allow="autoplay; encrypted-media; picture-in-picture; fullscreen"
        allowFullScreen
        referrerPolicy="strict-origin-when-cross-origin"
        loading="lazy"
      />
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
      {cam.kind === 'link' ? <WebcamLinkOut cam={cam} /> : showStream ? <WebcamStream cam={cam} /> : <WebcamImage cam={cam} />}
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
