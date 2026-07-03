import { useLayersStore } from '../../store/layersStore';
import { useXweatherStore, xwCellsLayerCode } from './xweatherStore';
import { XwTileLayer } from './XwTileLayer';

// Xweather radar-derived storm cells, hail-first: cells flagged for hail (or
// rotation / tornado / any severe signature) with their motion tracks and
// forecast cones. US coverage, 3-minute updates, 7-day history.
export function XweatherHailLayer() {
  const active = useLayersStore(
    (s) => (s.active as Record<string, boolean>).xweatherHail ?? false
  );
  const category = useXweatherStore((s) => s.cellCategory);
  const time = useXweatherStore((s) => s.cellTime);
  return <XwTileLayer active={active} code={xwCellsLayerCode(category)} time={time} />;
}
