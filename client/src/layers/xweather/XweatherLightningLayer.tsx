import { useLayersStore } from '../../store/layersStore';
import { useXweatherStore, xwLayerCode } from './xweatherStore';
import { XwTileLayer } from './XwTileLayer';

// Xweather (Vaisala NLDN) lightning raster overlay — the Dataminr-style strike
// map. See XwTileLayer for the proxy/refresh/zoom-cap machinery.
export function XweatherLightningLayer() {
  const active = useLayersStore(
    (s) => (s.active as Record<string, boolean>).xweatherLightning ?? false
  );
  const mode = useXweatherStore((s) => s.mode);
  const window = useXweatherStore((s) => s.window);
  const time = useXweatherStore((s) => s.time);
  return <XwTileLayer active={active} code={xwLayerCode(mode, window)} time={time} />;
}
