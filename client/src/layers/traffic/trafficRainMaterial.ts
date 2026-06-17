import * as Cesium from 'cesium';

/**
 * A falling-drop animated polyline material for traffic congestion pillars.
 * The line is intended to run vertically from the ground up; a bright glowing
 * drop sweeps from top to bottom (s=1 → s=0) so it looks like neon rain
 * falling onto a congested road segment. Multiple strands with different
 * `offset` values run in parallel to give the "digital rain" effect.
 *
 * Mirrors the PulseLine pattern: registered once via Cesium's material cache,
 * then wrapped in a Property so Cesium treats it as dynamic (isConstant=false)
 * and re-evaluates uniforms each frame.
 */

const MATERIAL_TYPE = 'TrafficRain';
let registered = false;

function ensureRegistered() {
  if (registered) return;
  registered = true;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  (Cesium.Material as any)._materialCache.addMaterial(MATERIAL_TYPE, {
    fabric: {
      type: MATERIAL_TYPE,
      uniforms: {
        color: new Cesium.Color(1, 0, 0, 1),
        speed: 4.0,
        trail: 0.13,
        offset: 0.0,
      },
      source: `
        czm_material czm_getMaterial(czm_materialInput materialInput) {
          czm_material material = czm_getDefaultMaterial(materialInput);
          // s=0 at bottom (start), s=1 at top (end). Invert so drop falls top→bottom.
          float s = 1.0 - materialInput.s;
          float phase = fract(czm_frameNumber * speed * 0.0005 + offset);
          float d = fract(s - phase);
          float drop = pow(clamp(1.0 - d / trail, 0.0, 1.0), 3.0);
          // Faint trailing glow behind the drop head.
          float glow = clamp(1.0 - d / 0.45, 0.0, 1.0) * 0.10;
          material.diffuse = color.rgb;
          material.emission = color.rgb * (drop * 2.8 + glow * 0.8);
          material.alpha = color.a * max(glow * 0.4, drop * 0.92);
          return material;
        }
      `,
    },
    translucent: () => true,
  });
}

export class TrafficRainMaterialProperty {
  private _definitionChanged = new Cesium.Event();
  color: Cesium.Color;
  speed: number;
  trail: number;
  offset: number;

  constructor(color: Cesium.Color, speed = 4.0, trail = 0.13, offset = 0.0) {
    ensureRegistered();
    this.color = color;
    this.speed = speed;
    this.trail = trail;
    this.offset = offset;
  }

  get isConstant(): boolean {
    return false;
  }

  get definitionChanged(): Cesium.Event {
    return this._definitionChanged;
  }

  getType(): string {
    return MATERIAL_TYPE;
  }

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  getValue(_time: Cesium.JulianDate, result?: any): any {
    if (!result) result = {};
    result.color = Cesium.Color.clone(this.color, result.color);
    result.speed = this.speed;
    result.trail = this.trail;
    result.offset = this.offset;
    return result;
  }

  equals(other: unknown): boolean {
    return (
      this === other ||
      (other instanceof TrafficRainMaterialProperty &&
        Cesium.Color.equals(this.color, other.color) &&
        this.speed === other.speed &&
        this.trail === other.trail &&
        this.offset === other.offset)
    );
  }
}
