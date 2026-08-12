// Radar layer entry point — picks the rendering engine.
//
// The component's contract is unchanged from before the split: it mounts inside
// CesiumGlobe, gates on `layersStore.active.radar`, renders nothing itself, and
// mounts standalone on the anonymous crisis share page (so everything below it
// stays keyless and client-fetched).
//
// v2 currently covers the plain radar mode only. Clouds/Combined still run the
// v1 stack because both are built on RainViewer's infrared product, which Stage
// 0 is checking still exists upstream — pruning or porting them is PR 4's call,
// once there is an answer to prune against.

import { useRadarStore } from './radarStore';
import { radarEngine } from './engineFlag';
import { RadarLayerV1 } from './RadarLayerV1';
import { RadarLayerV2 } from './RadarLayerV2';

export function RadarLayer() {
  const mode = useRadarStore((s) => s.mode);
  if (radarEngine() === 'v2' && mode === 'radar') return <RadarLayerV2 />;
  return <RadarLayerV1 />;
}
