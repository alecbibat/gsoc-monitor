// satellite.js (SGP4) loads on demand. The first load caches the module here so
// the satellite detail panel can use it synchronously without a static import.
// That panel only opens from entities SatelliteLayer draws after the load.
// A static import would pull satellite.js into the shared panel chunk that
// every panel kind downloads.
export type SatLib = typeof import('satellite.js');

let lib: SatLib | null = null;

// No memoized promise: a rejected import stays retryable (the layer retries on
// its next toggle), and import() already dedupes in-flight loads.
export function loadSatlib(): Promise<SatLib> {
  if (lib) return Promise.resolve(lib);
  return import('satellite.js').then((m) => (lib = m));
}

export function getSatlib(): SatLib | null {
  return lib;
}
