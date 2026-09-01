import * as Cesium from 'cesium';
import type { BasemapId } from '../types';
import { buildEarthProvider } from './earthBasemap';

interface ImageryAdjust {
  brightness?: number;
  contrast?: number;
  saturation?: number;
  gamma?: number;
}

interface ImagerySource {
  build: () => Cesium.ImageryProvider;
  adjust?: ImageryAdjust;
}

interface BasemapDef {
  label: string;
  attribution: string;
  build: () => Cesium.ImageryProvider;
  // Optional ImageryLayer colour adjustments applied after the layer is added.
  adjust?: ImageryAdjust;
  // Optional transparent place/boundary label overlay drawn directly above the
  // base imagery. Kept as its own layer so it can be hidden when the camera
  // zooms in — town names otherwise overlap nearby geographic features at
  // close range. The base imagery here is a label-free variant, so hiding the
  // overlay leaves clean terrain/imagery behind.
  overlay?: ImagerySource;
}

// Radar sim harness (?radarsim=1): remote basemap hosts may be unreachable in
// the sandboxes the sim runs in, so the dark basemap swaps to Cesium's
// bundled Natural Earth II tileset — offline, real coastlines, levels 0–2.
const RADAR_SIM =
  import.meta.env.DEV &&
  typeof location !== 'undefined' &&
  new URLSearchParams(location.search).has('radarsim');

function buildSimBasemap(): Cesium.ImageryProvider {
  return new Cesium.UrlTemplateImageryProvider({
    url: Cesium.buildModuleUrl('Assets/Textures/NaturalEarthII') + '/{z}/{x}/{reverseY}.jpg',
    tilingScheme: new Cesium.GeographicTilingScheme(),
    maximumLevel: 2,
    credit: new Cesium.Credit('Natural Earth II'),
  });
}

// Esri's transparent boundaries + place labels (countries, states/provinces,
// cities): light text with dark halos, designed to overlay photographic
// imagery. Shared by the map types whose base is raw satellite imagery.
const ESRI_LABELS: ImagerySource = {
  build: () =>
    new Cesium.UrlTemplateImageryProvider({
      url: 'https://server.arcgisonline.com/ArcGIS/rest/services/Reference/World_Boundaries_and_Places/MapServer/tile/{z}/{y}/{x}',
      maximumLevel: 13,
      credit: new Cesium.Credit('Esri'),
    }),
};

export const BASEMAPS: Record<BasemapId, BasemapDef> = {
  // Dark/Light are Esri's gray canvas services — same keyless host as the
  // World Imagery + labels services below. (Previously CARTO raster tiles,
  // which now watermark every request made without an API key.) Both canvas
  // services stop at LOD 16.
  dark: {
    label: 'Dark',
    attribution: 'Esri Dark Gray Canvas · © OpenStreetMap contributors',
    build: () =>
      RADAR_SIM
        ? buildSimBasemap()
        : new Cesium.UrlTemplateImageryProvider({
            url: 'https://server.arcgisonline.com/ArcGIS/rest/services/Canvas/World_Dark_Gray_Base/MapServer/tile/{z}/{y}/{x}',
            maximumLevel: 16,
            credit: new Cesium.Credit('Esri, HERE, Garmin, © OpenStreetMap contributors'),
          }),
    overlay: {
      build: () =>
        new Cesium.UrlTemplateImageryProvider({
          url: 'https://server.arcgisonline.com/ArcGIS/rest/services/Canvas/World_Dark_Gray_Reference/MapServer/tile/{z}/{y}/{x}',
          maximumLevel: 16,
          credit: new Cesium.Credit('Esri'),
        }),
    },
  },
  light: {
    label: 'Light',
    attribution: 'Esri Light Gray Canvas · © OpenStreetMap contributors',
    build: () =>
      new Cesium.UrlTemplateImageryProvider({
        url: 'https://server.arcgisonline.com/ArcGIS/rest/services/Canvas/World_Light_Gray_Base/MapServer/tile/{z}/{y}/{x}',
        maximumLevel: 16,
        credit: new Cesium.Credit('Esri, HERE, Garmin, © OpenStreetMap contributors'),
      }),
    overlay: {
      build: () =>
        new Cesium.UrlTemplateImageryProvider({
          url: 'https://server.arcgisonline.com/ArcGIS/rest/services/Canvas/World_Light_Gray_Reference/MapServer/tile/{z}/{y}/{x}',
          maximumLevel: 16,
          credit: new Cesium.Credit('Esri'),
        }),
    },
  },
  satellite: {
    label: 'Dark Sat',
    attribution: 'Esri World Imagery',
    build: () =>
      new Cesium.UrlTemplateImageryProvider({
        url: 'https://server.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/tile/{z}/{y}/{x}',
        maximumLevel: 19,
        credit: new Cesium.Credit('Esri, Maxar, Earthstar Geographics'),
      }),
    // Darken Esri imagery into a muted "night satellite" look so overlays pop.
    adjust: { brightness: 0.68, contrast: 1.1, saturation: 0.75, gamma: 1.3 },
    overlay: ESRI_LABELS,
  },
  earth: {
    label: 'Earth',
    attribution: 'NASA EOSDIS GIBS · MODIS Terra/Aqua',
    // Stateful: the provider bakes in the date + AM/PM pass from
    // earthBasemap.ts, and CesiumGlobe rebuilds the base imagery whenever that
    // store changes (see the EarthTimeBar navigator). True color as-shot — no
    // darkening, this map type IS the photograph.
    build: buildEarthProvider,
    overlay: ESRI_LABELS,
  },
  topo: {
    label: 'Topographic',
    attribution: '© OpenTopoMap (CC-BY-SA)',
    build: () =>
      new Cesium.UrlTemplateImageryProvider({
        url: 'https://{s}.tile.opentopomap.org/{z}/{x}/{y}.png',
        subdomains: ['a', 'b', 'c'],
        maximumLevel: 17,
        credit: new Cesium.Credit('© OpenTopoMap (CC-BY-SA)'),
      }),
  },
};
