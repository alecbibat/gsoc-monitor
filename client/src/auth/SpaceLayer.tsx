import { useEffect, useRef } from 'react';

// Full-window space backdrop: a drifting, twinkling starfield (background canvas)
// plus a triangular ship you can fly with the arrow keys (foreground canvas).
//
// Layering: the starfield sits at z-0 (behind the globe); the ship at z-5 (in
// front of the globe, behind the form card) so it's always visible on the open
// left side and tucks neatly behind the panel on the right. Both canvases are
// pointer-events-none so they never block the form.

const STAR_RGB = [
  '255,255,255', // white
  '205,234,255', // pale blue
  '61,220,255',  // accent cyan
  '82,227,164',  // accent green
];

interface Star { x: number; y: number; r: number; vx: number; a: number; tw: number; tp: number; c: string; }

function pickStarColor(): string {
  const roll = Math.random();
  if (roll < 0.62) return STAR_RGB[0];
  if (roll < 0.84) return STAR_RGB[1];
  if (roll < 0.95) return STAR_RGB[2];
  return STAR_RGB[3];
}

export function SpaceLayer() {
  const bgRef = useRef<HTMLCanvasElement>(null);
  const shipRef = useRef<HTMLCanvasElement>(null);

  useEffect(() => {
    const bg = bgRef.current;
    const fg = shipRef.current;
    if (!bg || !fg) return;
    const bctx = bg.getContext('2d');
    const fctx = fg.getContext('2d');
    if (!bctx || !fctx) return;

    const reduce = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
    const dpr = Math.min(window.devicePixelRatio || 1, 2);
    let W = 0, H = 0;
    let stars: Star[] = [];

    const resize = () => {
      W = window.innerWidth;
      H = window.innerHeight;
      for (const cv of [bg, fg]) {
        cv.width = Math.round(W * dpr);
        cv.height = Math.round(H * dpr);
        cv.style.width = `${W}px`;
        cv.style.height = `${H}px`;
      }
      bctx.setTransform(dpr, 0, 0, dpr, 0, 0);
      fctx.setTransform(dpr, 0, 0, dpr, 0, 0);
      const count = Math.min(260, Math.round((W * H) / 8500));
      stars = Array.from({ length: count }, () => ({
        x: Math.random() * W,
        y: Math.random() * H,
        r: Math.random() * 1.3 + 0.3,
        vx: (Math.random() * 0.1 + 0.015) * (Math.random() < 0.5 ? -1 : 1),
        a: Math.random() * 0.5 + 0.35,
        tw: Math.random() * 1.4 + 0.4,
        tp: Math.random() * Math.PI * 2,
        c: pickStarColor(),
      }));
    };
    resize();
    window.addEventListener('resize', resize);

    // ── Ship ────────────────────────────────────────────────────────────────
    const ship = { x: W * 0.42, y: H * 0.5, a: -Math.PI / 2, vx: 0, vy: 0 };
    const keys = new Set<string>();
    const ARROWS = new Set(['ArrowLeft', 'ArrowRight', 'ArrowUp', 'ArrowDown']);

    const isTyping = () => {
      const el = document.activeElement as HTMLElement | null;
      if (!el) return false;
      const t = el.tagName;
      return t === 'INPUT' || t === 'TEXTAREA' || t === 'SELECT' || el.isContentEditable;
    };
    const onKeyDown = (e: KeyboardEvent) => {
      if (!ARROWS.has(e.key) || isTyping()) return;
      e.preventDefault(); // don't scroll the page while flying
      keys.add(e.key);
    };
    const onKeyUp = (e: KeyboardEvent) => keys.delete(e.key);
    const clearKeys = () => keys.clear();
    window.addEventListener('keydown', onKeyDown);
    window.addEventListener('keyup', onKeyUp);
    window.addEventListener('blur', clearKeys);
    document.addEventListener('visibilitychange', clearKeys);

    const drawShip = (thrust: boolean) => {
      const { x, y, a } = ship;
      const nose = 15, spread = 2.5, rr = 11;
      const nx = x + Math.cos(a) * nose, ny = y + Math.sin(a) * nose;
      const lx = x + Math.cos(a + spread) * rr, ly = y + Math.sin(a + spread) * rr;
      const rx = x + Math.cos(a - spread) * rr, ry = y + Math.sin(a - spread) * rr;

      if (thrust) {
        const fl = 9 + Math.random() * 9;
        const fx = x + Math.cos(a + Math.PI) * fl, fy = y + Math.sin(a + Math.PI) * fl;
        fctx.beginPath();
        fctx.moveTo(lx, ly); fctx.lineTo(fx, fy); fctx.lineTo(rx, ry); fctx.closePath();
        fctx.fillStyle = `rgba(255,184,77,${0.5 + Math.random() * 0.35})`;
        fctx.shadowColor = '#ffb84d'; fctx.shadowBlur = 12;
        fctx.fill(); fctx.shadowBlur = 0;
      }

      fctx.beginPath();
      fctx.moveTo(nx, ny); fctx.lineTo(lx, ly); fctx.lineTo(rx, ry); fctx.closePath();
      fctx.fillStyle = 'rgba(61,220,255,0.14)';
      fctx.strokeStyle = '#3ddcff';
      fctx.lineWidth = 1.6; fctx.lineJoin = 'round';
      fctx.shadowColor = '#3ddcff'; fctx.shadowBlur = 10;
      fctx.fill(); fctx.stroke(); fctx.shadowBlur = 0;

      fctx.beginPath();
      fctx.arc(x + Math.cos(a) * 3, y + Math.sin(a) * 3, 1.5, 0, Math.PI * 2);
      fctx.fillStyle = '#cdeaff'; fctx.fill();
    };

    // ── Loop ──────────────────────────────────────────────────────────────────
    let raf = 0;
    let last = performance.now();
    const frame = (now: number) => {
      const dt = Math.min(0.032, (now - last) / 1000);
      last = now;
      const t = now / 1000;

      // Stars
      bctx.clearRect(0, 0, W, H);
      for (const s of stars) {
        if (!reduce) {
          s.x += s.vx;
          if (s.x < -2) s.x = W + 2; else if (s.x > W + 2) s.x = -2;
        }
        const tw = reduce ? s.a : s.a * (0.55 + 0.45 * Math.sin(t * s.tw + s.tp));
        bctx.beginPath();
        bctx.fillStyle = `rgba(${s.c},${tw.toFixed(3)})`;
        bctx.arc(s.x, s.y, s.r, 0, Math.PI * 2);
        bctx.fill();
      }

      // Ship physics (Asteroids-style)
      const ROT = 3.2, ACC = 360, MAX = 430;
      if (keys.has('ArrowLeft')) ship.a -= ROT * dt;
      if (keys.has('ArrowRight')) ship.a += ROT * dt;
      let thrust = false;
      if (keys.has('ArrowUp')) {
        ship.vx += Math.cos(ship.a) * ACC * dt;
        ship.vy += Math.sin(ship.a) * ACC * dt;
        thrust = true;
      }
      const drag = Math.exp(-(keys.has('ArrowDown') ? 1.9 : 0.5) * dt);
      ship.vx *= drag; ship.vy *= drag;
      const sp = Math.hypot(ship.vx, ship.vy);
      if (sp > MAX) { ship.vx *= MAX / sp; ship.vy *= MAX / sp; }
      ship.x += ship.vx * dt; ship.y += ship.vy * dt;
      const M = 22;
      if (ship.x < -M) ship.x = W + M; else if (ship.x > W + M) ship.x = -M;
      if (ship.y < -M) ship.y = H + M; else if (ship.y > H + M) ship.y = -M;

      fctx.clearRect(0, 0, W, H);
      drawShip(thrust);

      raf = requestAnimationFrame(frame);
    };
    raf = requestAnimationFrame(frame);

    return () => {
      cancelAnimationFrame(raf);
      window.removeEventListener('resize', resize);
      window.removeEventListener('keydown', onKeyDown);
      window.removeEventListener('keyup', onKeyUp);
      window.removeEventListener('blur', clearKeys);
      document.removeEventListener('visibilitychange', clearKeys);
    };
  }, []);

  return (
    <>
      <canvas ref={bgRef} className="pointer-events-none absolute inset-0 z-0" />
      {/* Ship is desktop-only (needs a keyboard) */}
      <canvas ref={shipRef} className="pointer-events-none absolute inset-0 z-[5] hidden md:block" />
    </>
  );
}
