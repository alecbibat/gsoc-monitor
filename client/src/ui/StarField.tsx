import { useEffect, useRef } from 'react';

// Deterministic seeded PRNG (Mulberry32) so stars are always in the same place.
function mkRng(seed: number) {
  let s = seed;
  return () => {
    s = (s + 0x6d2b79f5) | 0;
    let t = Math.imul(s ^ (s >>> 15), 1 | s);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

export function StarField() {
  const ref = useRef<HTMLCanvasElement>(null);

  useEffect(() => {
    const canvas = ref.current;
    if (!canvas) return;

    const dpr = Math.min(window.devicePixelRatio || 1, 2);
    const w = window.innerWidth;
    const h = window.innerHeight;
    canvas.width = Math.round(w * dpr);
    canvas.height = Math.round(h * dpr);
    canvas.style.width = `${w}px`;
    canvas.style.height = `${h}px`;

    const ctx = canvas.getContext('2d')!;
    ctx.scale(dpr, dpr);

    // Rich deep-space background gradient.
    const bg = ctx.createRadialGradient(w * 0.5, h * 0.45, 0, w * 0.5, h * 0.45, Math.max(w, h) * 0.75);
    bg.addColorStop(0, '#04050f');
    bg.addColorStop(0.5, '#020308');
    bg.addColorStop(1, '#000000');
    ctx.fillStyle = bg;
    ctx.fillRect(0, 0, w, h);

    const rng = mkRng(7337);

    // 700 sub-pixel dust stars.
    for (let i = 0; i < 700; i++) {
      const x = rng() * w;
      const y = rng() * h;
      const alpha = 0.08 + rng() * 0.22;
      // Slightly blue-tinted star color.
      const g = Math.round(210 + rng() * 30);
      const b = Math.round(220 + rng() * 35);
      ctx.fillStyle = `rgba(200,${g},${b},${alpha})`;
      ctx.fillRect(Math.round(x), Math.round(y), 1, 1);
    }

    // 200 small stars (0.6–1.2 px radius).
    for (let i = 0; i < 200; i++) {
      const x = rng() * w;
      const y = rng() * h;
      const r = 0.5 + rng() * 0.7;
      const alpha = 0.25 + rng() * 0.45;
      // Mix warm orange-white and cool blue-white.
      const warm = rng() > 0.75;
      const col = warm
        ? `rgba(255,${Math.round(200 + rng() * 55)},180,${alpha})`
        : `rgba(210,${Math.round(215 + rng() * 40)},255,${alpha})`;
      ctx.beginPath();
      ctx.arc(x, y, r, 0, Math.PI * 2);
      ctx.fillStyle = col;
      ctx.fill();
    }

    // 18 bright stars with a subtle diffraction cross.
    const rng2 = mkRng(1234);
    for (let i = 0; i < 18; i++) {
      const x = rng2() * w;
      const y = rng2() * h;
      const r = 1.2 + rng2() * 0.9;
      const alpha = 0.75 + rng2() * 0.25;
      // Core.
      ctx.beginPath();
      ctx.arc(x, y, r, 0, Math.PI * 2);
      ctx.fillStyle = `rgba(255,255,255,${alpha})`;
      ctx.fill();
      // Soft glow.
      const glow = ctx.createRadialGradient(x, y, 0, x, y, r * 6);
      glow.addColorStop(0, `rgba(200,220,255,0.18)`);
      glow.addColorStop(1, 'transparent');
      ctx.fillStyle = glow;
      ctx.beginPath();
      ctx.arc(x, y, r * 6, 0, Math.PI * 2);
      ctx.fill();
      // Diffraction spikes (2-pixel cross, very faint).
      const len = r * 12;
      ctx.strokeStyle = `rgba(220,235,255,${alpha * 0.22})`;
      ctx.lineWidth = 0.5;
      ctx.beginPath();
      ctx.moveTo(x - len, y);
      ctx.lineTo(x + len, y);
      ctx.stroke();
      ctx.beginPath();
      ctx.moveTo(x, y - len);
      ctx.lineTo(x, y + len);
      ctx.stroke();
    }

    // Very faint Milky Way smear (low-contrast elongated cloud).
    const mw = ctx.createLinearGradient(w * 0.1, h * 0.2, w * 0.85, h * 0.75);
    mw.addColorStop(0, 'rgba(80,100,160,0)');
    mw.addColorStop(0.3, 'rgba(80,100,160,0.025)');
    mw.addColorStop(0.5, 'rgba(90,110,175,0.04)');
    mw.addColorStop(0.7, 'rgba(80,100,160,0.025)');
    mw.addColorStop(1, 'rgba(80,100,160,0)');
    ctx.fillStyle = mw;
    ctx.fillRect(0, 0, w, h);
  }, []);

  return (
    <canvas
      ref={ref}
      className="pointer-events-none absolute inset-0"
      aria-hidden="true"
    />
  );
}
