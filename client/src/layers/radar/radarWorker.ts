// Radar tile worker: runs the fetch → decode → paint pipeline off the main
// thread so playback never stutters while a loop is loading.
import { RadarTileService, type ServiceIn, type ServiceOut } from './radarTileService';

interface WorkerScope {
  postMessage(msg: ServiceOut, transfer?: Transferable[]): void;
  onmessage: ((e: MessageEvent<ServiceIn>) => void) | null;
}

const scope = self as unknown as WorkerScope;
const service = new RadarTileService((msg, transfer) => scope.postMessage(msg, transfer ?? []));
scope.onmessage = (e) => service.handle(e.data);
scope.postMessage({ type: 'hello' });
