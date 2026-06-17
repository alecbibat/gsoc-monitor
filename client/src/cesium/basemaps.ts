import * as Cesium from 'cesium';
import type { BasemapId } from '../types';

interface BasemapDef {
  label: string;
  attribution: string;
  build: () => Cesium.ImageryProvider;
  // Optional ImageryLayer colour adjustments applied after the layer is added.
  adjust?: {
    brightness?: number;
    contrast?: number;
    saturation?: number;
    gamma?: number;
  };
}

export const BASEMAPS: Record<BasemapId, BasemapDef> = {
  dark: {
    label: 'Dark',
    attribution: '© CARTO © OpenStreetMap contributors',
    build: () =>
      new Cesium.UrlTemplateImageryProvider({
        url: 'https://{s}.basemaps.cartocdn.com/dark_all/{z}/{x}/{y}.png',
        subdomains: ['a', 'b', 'c', 'd'],
        maximumLevel: 18,
        credit: new Cesium.Credit('© CARTO © OpenStreetMap contributors'),
      }),
  },
  light: {
    label: 'Light',
    attribution: '© CARTO © OpenStreetMap contributors',
    build: () =>
      new Cesium.UrlTemplateImageryProvider({
        url: 'https://{s}.basemaps.cartocdn.com/light_all/{z}/{x}/{y}.png',
        subdomains: ['a', 'b', 'c', 'd'],
        maximumLevel: 18,
        credit: new Cesium.Credit('© CARTO © OpenStreetMap contributors'),
      }),
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
