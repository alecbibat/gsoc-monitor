// Draws a crisp map-pin marker (teardrop) with a bright white outline, a white
// inner dot, and a soft drop shadow. The outline + shadow keep the pin legible
// against dark basemaps, snow, or busy terrain, and it stays readable when
// scaled down at far camera distances — where the old plain PinBuilder pins
// (no outline, shrunk to 40%) tended to disappear.
//
// The tip sits at the bottom-centre of the image, so render the billboard with
// VerticalOrigin.BOTTOM to plant the tip on the ground point.

export interface PinIcon {
  url: string;
  width: number; // CSS px to render the billboard at
  height: number;
}

const R = 13; // bulb radius (CSS px)
const STROKE = 2.5; // white outline width
const TAIL = 2.3; // tip distance below the bulb centre, as a multiple of R
const PAD = 4; // transparent margin for the drop shadow

// Memoise per colour — the whole app shares ~13 group colours across 30 pins.
const cache = new Map<string, PinIcon>();

export function makePinIcon(cssColor: string): PinIcon {
  const cached = cache.get(cssColor);
  if (cached) return cached;

  const cx = R + STROKE + PAD;
  const cy = R + STROKE + PAD;
  const tipY = cy + R * TAIL;
  const width = 2 * (R + STROKE + PAD);
  const height = tipY + STROKE;

  const dpr = Math.min(3, Math.max(1, window.devicePixelRatio || 1));
  const canvas = document.createElement('canvas');
  canvas.width = Math.ceil(width * dpr);
  canvas.height = Math.ceil(height * dpr);
  const ctx = canvas.getContext('2d');
  if (!ctx) {
    const fallback = { url: '', width, height };
    return fallback;
  }
  ctx.scale(dpr, dpr);

  // Teardrop silhouette: an arc over the top of the bulb, then two tangent lines
  // down to the tip. The tangent contact points sit at ±gamma off the vertical.
  const D = tipY - cy;
  const gamma = Math.acos(R / D);
  const aRight = Math.atan2(R * Math.cos(gamma), R * Math.sin(gamma));
  const aLeft = Math.atan2(R * Math.cos(gamma), -R * Math.sin(gamma));

  ctx.beginPath();
  ctx.arc(cx, cy, R, aRight, aLeft, true); // anticlockwise → over the top
  ctx.lineTo(cx, tipY);
  ctx.closePath();

  // Fill with a soft shadow so the marker separates from any background.
  ctx.shadowColor = 'rgba(0, 0, 0, 0.55)';
  ctx.shadowBlur = 3;
  ctx.shadowOffsetY = 1;
  ctx.fillStyle = cssColor;
  ctx.fill();

  // Bright outline (no shadow on the stroke).
  ctx.shadowColor = 'transparent';
  ctx.shadowBlur = 0;
  ctx.shadowOffsetY = 0;
  ctx.lineWidth = STROKE;
  ctx.lineJoin = 'round';
  ctx.strokeStyle = 'rgba(255, 255, 255, 0.95)';
  ctx.stroke();

  // White inner dot for the classic pin read + extra contrast.
  ctx.beginPath();
  ctx.arc(cx, cy, R * 0.42, 0, Math.PI * 2);
  ctx.fillStyle = 'rgba(255, 255, 255, 0.95)';
  ctx.fill();

  const icon = { url: canvas.toDataURL(), width, height };
  cache.set(cssColor, icon);
  return icon;
}
