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
  dark: {
    label: 'Dark',
    attribution: '© CARTO © OpenStreetMap contributors',
    build: () =>
      new Cesium.UrlTemplateImageryProvider({
        url: 'https://{s}.basemaps.cartocdn.com/dark_nolabels/{z}/{x}/{y}.png',
        subdomains: ['a', 'b', 'c', 'd'],
        maximumLevel: 18,
        credit: new Cesium.Credit('© CARTO © OpenStreetMap contributors'),
      }),
    overlay: {
      build: () =>
        new Cesium.UrlTemplateImageryProvider({
          url: 'https://{s}.basemaps.cartocdn.com/dark_only_labels/{z}/{x}/{y}.png',
          subdomains: ['a', 'b', 'c', 'd'],
          maximumLevel: 18,
          credit: new Cesium.Credit('© CARTO'),
        }),
    },
  },
  light: {
    label: 'Light',
    attribution: '© CARTO © OpenStreetMap contributors',
    build: () =>
      new Cesium.UrlTemplateImageryProvider({
        url: 'https://{s}.basemaps.cartocdn.com/light_nolabels/{z}/{x}/{y}.png',
        subdomains: ['a', 'b', 'c', 'd'],
        maximumLevel: 18,
        credit: new Cesium.Credit('© CARTO © OpenStreetMap contributors'),
      }),
    overlay: {
      build: () =>
        new Cesium.UrlTemplateImageryProvider({
          url: 'https://{s}.basemaps.cartocdn.com/light_only_labels/{z}/{x}/{y}.png',
          subdomains: ['a', 'b', 'c', 'd'],
          maximumLevel: 18,
          credit: new Cesium.Credit('© CARTO'),
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
