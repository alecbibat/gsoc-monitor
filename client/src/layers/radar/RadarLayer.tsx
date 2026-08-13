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
import { FlowProbe, radarFlowProbeEnabled } from './flow/FlowProbe';
import { WarpProbe, radarWarpProbeEnabled } from './flow/WarpProbe';
import { RadarGlSpike, radarGlEnabled } from './gl/RadarGlSpike';
import { RadarLayerV1 } from './RadarLayerV1';
import { RadarLayerV2 } from './RadarLayerV2';

export function RadarLayer() {
  if (radarEngine() !== 'v2') return <RadarLayerV1 />;
  return (
    <>
      <RadarLayerV2 />
      {/* Stage B spike: draws over the imagery below the handover altitude and
          dims it to match, so the flag being off leaves Stage A untouched. */}
      {radarGlEnabled() && <RadarGlSpike />}
      {/* Stage C PR 5: computes optical flow and publishes a summary at
          window.__radarFlow(). Measures only — nothing draws it. */}
      {radarFlowProbeEnabled() && <FlowProbe />}
      {/* Stage C PR 6: runs the warp over the live region and reports how far
          it departs from a crossfade, at window.__radarWarp(). The render
          wiring lands in PR 7, where `t` becomes continuous. */}
      {radarWarpProbeEnabled() && <WarpProbe />}
    </>
  );
}
