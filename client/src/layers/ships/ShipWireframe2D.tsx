import { useEffect, useRef } from 'react';
import { shipWireframeSegments } from './ShipModel3D';

// 2D-canvas rendering of the ship wireframe for the pins-screensaver focus card.
//
// Unlike <ShipModel3D>, this creates NO WebGL context. It projects the cached
// line-segment geometry onto a plain 2D canvas each frame. That distinction is
// the whole point: the screensaver mounts a ship card on every ship visit, and
// a Three.js WebGLRenderer is a second live WebGL context alongside the Cesium
// globe. On weak integrated GPUs those per-visit contexts accumulate until the
// browser hits its context cap and force-drops the oldest one — which is the
// main globe — black-screening the app. A 2D projection has none of that cost,
// while the in-world 3D ship (ShipModelLayer) still gives the real depth read.
//
// Geometry axes (from shipWireframeSegments): +X = bow, +Y = up, +Z = starboard,
// keel at y = 0. The model spins about its Y axis, framed with the same fov-35
// perspective as <ShipModel3D> so the card looks identical.

interface Props {
  variant: 'star' | 'wind';
  color: string;
  masts?: number;
  width?: number;
  height?: number;
}

export function ShipWireframe2D({ variant, color, masts = 4, width = 310, height = 116 }: Props) {
  const canvasRef = useRef<HTMLCanvasElement>(null);

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext('2d');
    if (!ctx) return;

    const dpr = Math.min(window.devicePixelRatio || 1, 2);
    canvas.width = width * dpr;
    canvas.height = height * dpr;
    ctx.scale(dpr, dpr);

    // Flat [x,y,z, …]; each consecutive vertex pair is one line segment.
    const seg = shipWireframeSegments(variant, masts);
    const vertCount = seg.length / 3;

    // Framing: centre vertically, fit the horizontal spin radius + vertical span.
    let minY = Infinity;
    let maxY = -Infinity;
    let horizR = 0;
    for (let i = 0; i < vertCount; i++) {
      const x = seg[i * 3];
      const y = seg[i * 3 + 1];
      const z = seg[i * 3 + 2];
      if (y < minY) minY = y;
      if (y > maxY) maxY = y;
      const r = Math.hypot(x, z);
      if (r > horizR) horizR = r;
    }
    const centerY = (minY + maxY) / 2;
    const vertHalf = (maxY - minY) / 2 || 1;

    // Perspective framing mirroring ShipModel3D's PerspectiveCamera(fov = 35).
    const fov = 35;
    const aspect = width / height;
    const vtan = Math.tan(((fov * Math.PI) / 180) / 2);
    const margin = 1.18;
    const distH = horizR * margin * Math.sqrt(1 + 1 / (vtan * aspect) ** 2);
    const distV = (vertHalf * margin) / vtan;
    const dist = Math.max(distH, distV);
    const focal = height / 2 / vtan; // pixels
    const cx = width / 2;
    const cy = height / 2;

    let raf = 0;
    let last = performance.now();
    let angle = 0;

    const render = () => {
      const now = performance.now();
      angle += ((now - last) / 1000) * 0.65; // match ShipModel3D spin speed
      last = now;
      const sin = Math.sin(angle);
      const cos = Math.cos(angle);

      ctx.clearRect(0, 0, width, height);
      ctx.lineWidth = 1;
      ctx.strokeStyle = color;
      ctx.shadowColor = color;
      ctx.shadowBlur = 6;
      ctx.beginPath();
      for (let s = 0; s + 1 < vertCount; s += 2) {
        const a = s * 3;
        const b = (s + 1) * 3;

        const ax0 = seg[a];
        const ay0 = seg[a + 1];
        const az0 = seg[a + 2];
        const arx = ax0 * cos + az0 * sin;
        const arz = -ax0 * sin + az0 * cos;
        const adenom = dist - arz;
        const apx = cx + (arx * focal) / adenom;
        const apy = cy - ((ay0 - centerY) * focal) / adenom;

        const bx0 = seg[b];
        const by0 = seg[b + 1];
        const bz0 = seg[b + 2];
        const brx = bx0 * cos + bz0 * sin;
        const brz = -bx0 * sin + bz0 * cos;
        const bdenom = dist - brz;
        const bpx = cx + (brx * focal) / bdenom;
        const bpy = cy - ((by0 - centerY) * focal) / bdenom;

        ctx.moveTo(apx, apy);
        ctx.lineTo(bpx, bpy);
      }
      ctx.stroke();
      raf = requestAnimationFrame(render);
    };
    render();

    return () => {
      cancelAnimationFrame(raf);
    };
  }, [variant, color, masts, width, height]);

  return <canvas ref={canvasRef} style={{ width, height }} />;
}
