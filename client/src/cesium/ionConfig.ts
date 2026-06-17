import * as Cesium from 'cesium';

// Cesium ion powers the free OSM Buildings + World Terrain assets. Provide your
// own free token from https://ion.cesium.com/tokens via VITE_CESIUM_ION_TOKEN
// (set it as a Heroku Config Var before the build, like the other VITE_* vars).
// When absent, CesiumJS falls back to its bundled demo token, which is
// rate-limited and intended for local development only.
const ION_TOKEN = (import.meta as unknown as { env: Record<string, string> }).env
  .VITE_CESIUM_ION_TOKEN as string | undefined;

export const hasCustomIonToken = Boolean(ION_TOKEN);

if (ION_TOKEN) {
  Cesium.Ion.defaultAccessToken = ION_TOKEN;
}
