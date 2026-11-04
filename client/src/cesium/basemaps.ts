import * as Cesium from 'cesium';
import type { BasemapId } from '../types';
import { buildEarthProvider } from './earthBasemap';
import type { LabelTheme } from './placeLabels';

interface ImageryAdjust {
  brightness?: number;
  contrast?: number;
  saturation?: number;
  gamma?: number;
}

interface BasemapDef {
  label: string;
  attribution: string;
  build: () => Cesium.ImageryProvider;
  // Optional ImageryLayer colour adjustments applied after the layer is added.
  adjust?: ImageryAdjust;
  // Palette for the vector place-name layer (placeLabels.ts) drawn over this
  // map type. Omitted where the tiles already print their own names (topo).
  // Where set, the base imagery is a label-free variant: names come from the
  // vector layer, which stays upright, sharp and one size at every zoom where
  // raster label tiles draped on the globe stretch, blur and resize.
  labels?: LabelTheme;
  // Draw only city names as vector labels. Esri's gray canvas *base* tiles
  // paint country, state and water names into the imagery itself (there is
  // no label-free variant), so vector area names would print them twice.
  cityLabelsOnly?: boolean;
  // Draw vector country and state/province borders (boundaryLines.ts). Only
  // the photographic map types need them; the canvas bases carry their own.
  borders?: boolean;
}

export const BASEMAPS: Record<BasemapId, BasemapDef> = {
  // Dark/Light are Esri's gray canvas services — same keyless host as the
  // World Imagery service below. (Previously CARTO raster tiles,
  // which now watermark every request made without an API key.) Both canvas
  // services stop at LOD 16.
  dark: {
    label: 'Dark',
    attribution: 'Esri Dark Gray Canvas · © OpenStreetMap contributors',
    build: () =>
      new Cesium.UrlTemplateImageryProvider({
        url: 'https://server.arcgisonline.com/ArcGIS/rest/services/Canvas/World_Dark_Gray_Base/MapServer/tile/{z}/{y}/{x}',
        maximumLevel: 16,
        credit: new Cesium.Credit('Esri, HERE, Garmin, © OpenStreetMap contributors'),
      }),
    labels: 'dark',
    cityLabelsOnly: true,
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
    labels: 'light',
    cityLabelsOnly: true,
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
    labels: 'imagery',
    borders: true,
  },
  earth: {
    label: 'Earth',
    attribution: 'NASA EOSDIS GIBS · MODIS Terra/Aqua',
    // Stateful: the provider bakes in the date + AM/PM pass from
    // earthBasemap.ts, and CesiumGlobe rebuilds the base imagery whenever that
    // store changes (see the EarthTimeBar navigator). True color as-shot — no
    // darkening, this map type IS the photograph.
    build: buildEarthProvider,
    labels: 'imagery',
    borders: true,
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
