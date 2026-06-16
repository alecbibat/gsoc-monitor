import { createContext, useContext } from 'react';
import type * as Cesium from 'cesium';

export const CesiumContext = createContext<Cesium.Viewer | null>(null);

export function useCesiumViewer(): Cesium.Viewer | null {
  return useContext(CesiumContext);
}
