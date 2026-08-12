// Radar layer entry point — picks the rendering engine.
//
// The component's contract is unchanged from before the split: it mounts inside
// CesiumGlobe, gates on `layersStore.active.radar`, renders nothing itself, and
// mounts standalone on the anonymous crisis share page (so everything below it
// stays keyless and client-fetched).
//
// v2 is the default engine; v1 stays reachable as `?radar=v1` for one release
// as the kill switch.

import { radarEngine } from './engineFlag';
import { RadarLayerV1 } from './RadarLayerV1';
import { RadarLayerV2 } from './RadarLayerV2';

export function RadarLayer() {
  return radarEngine() === 'v2' ? <RadarLayerV2 /> : <RadarLayerV1 />;
}
