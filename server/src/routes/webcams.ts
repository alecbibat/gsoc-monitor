import { Router } from 'express';
import { NPS_PARK_BY_CODE } from '../nps/parks';
import { WEBCAMS, WEBCAM_BY_ID } from '../webcams/catalog';
import { getWebcamImage, imageTtlMs, webcamStatus } from '../webcams/proxy';
import type { WebcamDef, WebcamInfo, WebcamsFeed } from '../webcams/types';

// ── /api/webcams — the followed parks' webcams ───────────────────────────────
//   GET /               the catalog, with what the last fetch of each found
//   GET /:id/image      a camera's current still, through the proxy
// See webcams/catalog.ts for the cameras and webcams/proxy.ts for why images
// are proxied.

const router = Router();

export function webcamInfo(cam: WebcamDef): WebcamInfo {
  return {
    id: cam.id,
    parkCode: cam.parkCode,
    park: NPS_PARK_BY_CODE.get(cam.parkCode)?.name ?? cam.parkCode,
    name: cam.name,
    operator: cam.operator,
    pageUrl: cam.pageUrl,
    kind: cam.kind,
    embedUrl: cam.embedUrl ?? null,
    lat: cam.lat,
    lon: cam.lon,
    approxLocation: !!cam.approxLocation,
    refreshSec: cam.refreshSec,
    imagePath:
      cam.kind === 'image' && cam.imageUrl && !cam.browserDirect ? `/api/webcams/${encodeURIComponent(cam.id)}/image` : null,
    directUrl: cam.kind === 'image' && cam.browserDirect && cam.imageUrl ? cam.imageUrl : null,
    directBustCache: !!(cam.browserDirect && cam.bustCache),
    timeOnImage: !!cam.timeOnImage,
    note: cam.note ?? null,
    status: webcamStatus(cam.id),
  };
}

router.get('/', (_req, res) => {
  const feed: WebcamsFeed = { cams: WEBCAMS.map(webcamInfo), fetchedAt: new Date().toISOString() };
  res.set('Cache-Control', 'no-store');
  res.json(feed);
});

router.get('/:id/image', async (req, res) => {
  const cam = WEBCAM_BY_ID.get(req.params.id);
  // Browser-direct cameras are never fetched by the server (see WebcamDef).
  if (!cam || cam.kind !== 'image' || !cam.imageUrl || cam.browserDirect) {
    res.status(404).json({ error: 'No such webcam image' });
    return;
  }
  try {
    const img = await getWebcamImage(cam);
    res.set({
      'Content-Type': img.contentType,
      // Browsers may reuse it for the rest of this fetch's freshness window.
      'Cache-Control': `public, max-age=${Math.max(5, Math.floor((imageTtlMs(cam) - (Date.now() - img.fetchedAt)) / 1000))}`,
      'X-Webcam-Updated': new Date(img.imageUpdated ?? img.fetchedAt).toISOString(),
      'X-Webcam-Updated-Known': img.imageUpdated !== null ? '1' : '0',
      'X-Webcam-Unchanged-Since': new Date(img.unchangedSince).toISOString(),
      'X-Webcam-Fetched': new Date(img.fetchedAt).toISOString(),
      ...(img.stale ? { 'X-Webcam-Stale': '1' } : {}),
    });
    res.send(img.body);
  } catch (err) {
    res.status(502).json({ error: 'Webcam image unavailable', detail: err instanceof Error ? err.message : String(err) });
  }
});

export default router;
