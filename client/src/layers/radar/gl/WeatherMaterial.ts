// The custom Cesium Material behind the Stage B GPU path.
//
// It samples TWO raw magnitude/presence composites, blends them in data space,
// and only then applies the palette. That ordering is the whole point: Stage C
// warps the field along an optical-flow vector before colorizing, and you
// cannot warp colors — a magenta core dragged across a blue field produces
// colors that mean nothing. With `blend` alone (this spike) the result is
// exactly the Stage A dissolve, which is also the permanent fallback whenever
// flow is unavailable.

import * as Cesium from 'cesium';
import { getRadarLut, type RadarPaletteId } from '../palettes';

// The rain LUT is 128 entries indexed by (dBZ+32); the shader has a normalized
// magnitude in 0–1 that corresponds to the FULL 0–255 byte. A 256-wide texture
// indexed directly by that value avoids a scale factor in the shader and the
// off-by-one arguments that come with it.
export function buildLutBitmap(palette: RadarPaletteId): Promise<ImageBitmap> {
  const lut = getRadarLut(palette).rain;
  const px = new Uint8ClampedArray(new ArrayBuffer(256 * 4));
  for (let i = 0; i < 256; i++) {
    const m = Math.min(127, i >> 1);
    px[i * 4] = lut[m * 4];
    px[i * 4 + 1] = lut[m * 4 + 1];
    px[i * 4 + 2] = lut[m * 4 + 2];
    px[i * 4 + 3] = lut[m * 4 + 3];
  }
  return createImageBitmap(new ImageData(px, 256, 1), { premultiplyAlpha: 'none' });
}

const SOURCE = /* glsl */ `
uniform sampler2D frameA;
uniform sampler2D frameB;
uniform sampler2D lut;
uniform float blend;
uniform float south;
uniform float north;
uniform float mercSouth;
uniform float mercNorth;
uniform float alphaScale;

czm_material czm_getMaterial(czm_materialInput materialInput)
{
    czm_material material = czm_getDefaultMaterial(materialInput);

    // st is linear in geodetic lat/lon across the rectangle, but the composite
    // is Web Mercator, so the row has to be reprojected. v = 0 is the block's
    // NORTH edge, matching row 0 of the composite bitmap.
    float lat = mix(south, north, materialInput.st.t);
    float mercY = log(tan(czm_piOverFour + 0.5 * lat));
    float v = (mercNorth - mercY) / (mercNorth - mercSouth);
    vec2 uv = vec2(materialInput.st.s, v);

    if (uv.y < 0.0 || uv.y > 1.0)
    {
        material.alpha = 0.0;
        return material;
    }

    vec4 a = texture(frameA, uv);
    vec4 b = texture(frameB, uv);

    // Blend magnitude and presence SEPARATELY, then divide. Presence is the
    // echo coverage the blur produced, so mixing it first and dividing after is
    // the normalized convolution carried into the time axis: echo appearing or
    // fading between frames stays truthful instead of ghosting.
    float mag = mix(a.r, b.r, blend);
    float pres = mix(a.g, b.g, blend);

    // Same floor as the CPU path (10/255): below this the division amplifies
    // the outermost fringe of the feather into noise.
    if (pres < 0.039)
    {
        material.alpha = 0.0;
        return material;
    }

    float intensity = clamp(mag / pres, 0.0, 1.0);
    vec4 color = czm_gammaCorrect(texture(lut, vec2(intensity, 0.5)));

    material.diffuse = color.rgb;
    // Presence doubles as the edge ramp, with the same power curve the CPU
    // path uses so light rain does not grow a soft skirt.
    material.alpha = color.a * pow(pres, 1.3) * alphaScale;
    return material;
}
`;

export interface WeatherUniforms {
  frameA: ImageBitmap | string;
  frameB: ImageBitmap | string;
  lut: ImageBitmap | string;
  blend: number;
  south: number;
  north: number;
  mercSouth: number;
  mercNorth: number;
  alphaScale: number;
}

export function createWeatherMaterial(): Cesium.Material {
  return new Cesium.Material({
    translucent: true,
    fabric: {
      type: 'RadarWeatherField',
      uniforms: {
        frameA: Cesium.Material.DefaultImageId,
        frameB: Cesium.Material.DefaultImageId,
        lut: Cesium.Material.DefaultImageId,
        blend: 0.0,
        south: 0.0,
        north: 0.0,
        mercSouth: 0.0,
        mercNorth: 1.0,
        alphaScale: 1.0,
      },
      source: SOURCE,
    },
  });
}
