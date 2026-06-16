import * as Cesium from 'cesium';

/**
 * A custom animated polyline material: the line glows dimly at rest while a
 * bright pulse with a fading trail sweeps along it from start to end — the
 * "signal travelling down the wire" / heart-rate-monitor look.
 *
 * Cesium's built-in MaterialProperty types don't include this, so we register
 * a small GLSL material and a matching Property that feeds it per-frame
 * uniforms. Note: this only animates while the scene is actively rendering, so
 * the consumer must drive renders (the globe runs in requestRenderMode).
 */

const MATERIAL_TYPE = 'PulseLine';
let registered = false;

function ensureRegistered() {
  if (registered) return;
  registered = true;
  // _materialCache is internal but stable; this is the documented community
  // pattern for registering custom Entity polyline materials.
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  (Cesium.Material as any)._materialCache.addMaterial(MATERIAL_TYPE, {
    fabric: {
      type: MATERIAL_TYPE,
      uniforms: {
        color: new Cesium.Color(1, 1, 1, 1),
        speed: 8.0,
        trail: 0.16,
      },
      source: `
        czm_material czm_getMaterial(czm_materialInput materialInput) {
          czm_material material = czm_getDefaultMaterial(materialInput);
          float s = materialInput.s;                          // 0..1 along the line
          float head = fract(czm_frameNumber * speed * 0.001); // moving pulse head
          float d = fract(head - s);                           // distance behind head
          float pulse = pow(clamp(1.0 - d / trail, 0.0, 1.0), 2.0);
          material.diffuse = color.rgb;
          material.emission = color.rgb * pulse * 1.6;         // bright glowing head
          material.alpha = color.a * (0.22 + 0.78 * pulse);    // dim base + bright pulse
          return material;
        }
      `,
    },
    translucent: () => true,
  });
}

export class PulseLineMaterialProperty {
  private _definitionChanged = new Cesium.Event();
  color: Cesium.Color;
  speed: number;
  trail: number;

  constructor(color: Cesium.Color, speed = 8.0, trail = 0.16) {
    ensureRegistered();
    this.color = color;
    this.speed = speed;
    this.trail = trail;
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
    return result;
  }

  equals(other: unknown): boolean {
    return (
      this === other ||
      (other instanceof PulseLineMaterialProperty &&
        Cesium.Color.equals(this.color, other.color) &&
        this.speed === other.speed &&
        this.trail === other.trail)
    );
  }
}
