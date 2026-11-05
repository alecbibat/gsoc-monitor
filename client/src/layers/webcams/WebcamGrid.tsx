import { useState } from 'react';
import { usePanelStore } from '../../panels/panelStore';
import type { WebcamInfo } from '../../types';
import { NPS_PARKS } from '../../nps/parks';
import { directImageSrc, siteOf, webcamFreshness } from './webcamMeta';
import { useWebcamsFeed, useWebcamsStore } from './webcamsStore';

// The parks' webcams as a grid of current stills, for the National Parks
// panel: one park's, or every park's grouped. A tile opens the camera's own
// panel (live picture, refreshing). Thumbnails reload every five minutes.

export function openWebcamPanel(cam: WebcamInfo): void {
  usePanelStore.getState().open({
    id: `webcam-${cam.id}`,
    kind: 'webcams',
    title: cam.name,
    subtitle: `${cam.park} · ${cam.operator}`,
    payload: cam as unknown as Record<string, unknown>,
    // Opened on purpose from a list, like the other deliberately launched windows.
    locked: true,
  });
}

/** A link-out camera's tile goes straight to the operator's page. */
function LinkTile({ cam }: { cam: WebcamInfo }) {
  return (
    <a
      href={cam.pageUrl}
      target="_blank"
      rel="noopener noreferrer"
      className="group overflow-hidden rounded-lg border border-white/8 bg-white/5 text-left transition hover:border-emerald-400/40"
      title={`${cam.name} — opens on ${siteOf(cam.pageUrl)}`}
    >
      <div className="flex aspect-video flex-col items-center justify-center gap-0.5 bg-black/40 text-[10px] text-white/45">
        <span>Opens on {siteOf(cam.pageUrl)} ↗</span>
      </div>
      <div className="px-1.5 py-1">
        <div className="truncate text-[11px] font-medium text-white/85 group-hover:text-white">{cam.name}</div>
        <div className="truncate text-[9.5px] text-white/40">{cam.operator}</div>
      </div>
    </a>
  );
}

function Tile({ cam, bucket, showPark }: { cam: WebcamInfo; bucket: number; showPark: boolean }) {
  if (cam.kind === 'link') return <LinkTile cam={cam} />;
  const [failed, setFailed] = useState(false);
  const toMs = (iso: string | null | undefined) => (iso ? Date.parse(iso) || null : null);
  const { stale } = webcamFreshness({
    updated: toMs(cam.status?.imageUpdated),
    unchangedSince: toMs(cam.status?.unchangedSince),
    refreshSec: cam.refreshSec,
    now: Date.now(),
  });
  return (
    <button
      type="button"
      onClick={() => openWebcamPanel(cam)}
      className="group overflow-hidden rounded-lg border border-white/8 bg-white/5 text-left transition hover:border-emerald-400/40"
      title={`${cam.name} — ${cam.operator}`}
    >
      <div className="relative aspect-video bg-black/40">
        {cam.kind === 'image' && (cam.imagePath || cam.directUrl) && !failed ? (
          <img
            src={
              cam.directUrl
                ? directImageSrc(cam.directUrl, cam.directBustCache, bucket)
                : `${cam.imagePath}?v=${bucket}`
            }
            alt=""
            loading="lazy"
            onError={() => setFailed(true)}
            className="h-full w-full object-cover"
          />
        ) : (
          <div className="flex h-full items-center justify-center text-[10px] text-white/40">
            {cam.kind === 'stream' ? '▶ Live video' : 'Unavailable'}
          </div>
        )}
        {(cam.kind === 'stream' || cam.embedUrl) && (
          <span
            className="absolute right-1 top-1 rounded bg-red-500/90 px-1 text-[9px] font-bold uppercase tracking-wider text-white"
            title="Live video available"
          >
            Live
          </span>
        )}
        {stale && (
          <span className="absolute left-1 top-1 rounded bg-amber-500/90 px-1 text-[9px] font-bold uppercase tracking-wider text-ink-950">
            Stale
          </span>
        )}
      </div>
      <div className="px-1.5 py-1">
        <div className="truncate text-[11px] font-medium text-white/85 group-hover:text-white">{cam.name}</div>
        <div className="truncate text-[9.5px] text-white/40">{showPark ? `${cam.park} · ${cam.operator}` : cam.operator}</div>
      </div>
    </button>
  );
}

export function WebcamGrid({ parkCode }: { parkCode: string }) {
  useWebcamsFeed(true);
  const feed = useWebcamsStore((s) => s.feed);
  const error = useWebcamsStore((s) => s.error);
  // Re-renders (every feed poll) pick up a new thumbnail at most every 5 min.
  const bucket = Math.floor(Date.now() / 300_000);
  const all = feed?.cams ?? [];
  const cams = parkCode === 'all' ? all : all.filter((c) => c.parkCode === parkCode);

  if (!feed) {
    return <div className="py-2 text-[12px] text-white/35">{error ? 'Webcams unavailable' : 'Loading webcams…'}</div>;
  }
  if (cams.length === 0) return <div className="py-2 text-[12px] text-white/35">No webcams listed for this park.</div>;

  if (parkCode !== 'all') {
    return (
      <div className="grid grid-cols-2 gap-1.5">
        {cams.map((c) => (
          <Tile key={c.id} cam={c} bucket={bucket} showPark={false} />
        ))}
      </div>
    );
  }
  return (
    <div className="space-y-2">
      {NPS_PARKS.map((p) => {
        const list = cams.filter((c) => c.parkCode === p.code);
        if (list.length === 0) return null;
        return (
          <div key={p.code}>
            <div className="mb-1 text-[10.5px] font-semibold text-emerald-300/80">{p.name}</div>
            <div className="grid grid-cols-2 gap-1.5">
              {list.map((c) => (
                <Tile key={c.id} cam={c} bucket={bucket} showPark={false} />
              ))}
            </div>
          </div>
        );
      })}
    </div>
  );
}

/** How many cameras a park (or all parks) has, once the list is loaded. */
export function useWebcamCount(parkCode: string): number | null {
  const feed = useWebcamsStore((s) => s.feed);
  if (!feed) return null;
  return parkCode === 'all' ? feed.cams.length : feed.cams.filter((c) => c.parkCode === parkCode).length;
}
