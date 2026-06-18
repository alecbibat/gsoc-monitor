// Cinematic holographic wireframe globe for the auth screen.
// Pure SVG + CSS (meridian pulse, atmosphere breathing, star twinkle, surface
// events) plus SMIL animateMotion for the orbiting satellites and a tiny bit of
// React state for the live lightning strikes — no WebGL, no deps, GPU-cheap.

import { useEffect, useState } from 'react';

const C = 120;            // viewBox center
const R = 82;             // globe radius
const TILT_SIN = 0.4226;  // sin(25°) — vertical foreshortening of the tilt
const TILT_COS = 0.9063;  // cos(25°)
const POLE = R * TILT_COS; // screen distance from center to a visible pole
const MER_COUNT = 6;
const MER_DUR = 8;        // seconds for one meridian pulse cycle

// Latitude rings: horizontal ellipses, flattened by the tilt, lifted toward the poles.
const LATS = [-70, -47, -23, 0, 23, 47, 70].map((deg) => {
  const b = (deg * Math.PI) / 180;
  const rx = R * Math.cos(b);
  return { rx, ry: rx * TILT_SIN, cy: C - R * Math.sin(b) * TILT_COS, deg };
});

// Deterministic-enough starfield (generated once at module load).
const STARS = Array.from({ length: 34 }, () => ({
  x: Math.random() * 240,
  y: Math.random() * 240,
  r: Math.random() * 0.8 + 0.3,
  delay: Math.random() * 4,
  dur: 2.5 + Math.random() * 3,
}));

// Uniform random point inside the globe disk (sqrt for even areal spread).
function randomOnDisk(maxR: number): [number, number] {
  const t = Math.random() * Math.PI * 2;
  const rr = Math.sqrt(Math.random()) * maxR;
  return [C + rr * Math.cos(t), C + rr * Math.sin(t)];
}

// Randomly-placed surface events (new spots each page load).
const FIRES = Array.from({ length: 3 }, () => {
  const [x, y] = randomOnDisk(R * 0.8);
  return { x, y, delay: Math.random() * 0.5 };
});
const TORNADOES = Array.from({ length: 2 }, () => {
  const [x, y] = randomOnDisk(R * 0.78);
  return { x, y, delay: Math.random() * 0.9 };
});

function flamePath(x: number, y: number) {
  return `M ${x} ${y} C ${x - 3} ${y - 3} ${x - 2.6} ${y - 8} ${x} ${y - 9.5} C ${x + 2.6} ${y - 8} ${x + 3} ${y - 3} ${x} ${y} Z`;
}
function funnelPath(x: number, y: number) {
  return `M ${x - 5} ${y - 10} L ${x + 5} ${y - 10} L ${x + 1.6} ${y} L ${x - 1.6} ${y} Z`;
}
// Jagged bolt from sky down to the ground point (x, y).
function boltPath(x: number, y: number) {
  const len = 13 + Math.random() * 7;
  const segs = 3 + Math.floor(Math.random() * 2);
  let d = `M ${x.toFixed(1)} ${(y - len).toFixed(1)}`;
  for (let i = 1; i <= segs; i++) {
    const yy = y - len + (len * i) / segs;
    const xx = i === segs ? x : x + (Math.random() - 0.5) * 7;
    d += ` L ${xx.toFixed(1)} ${yy.toFixed(1)}`;
  }
  return d;
}

// Build an SVG ellipse outline as a path so satellites can ride it via <mpath>.
function ellipsePath(a: number, b: number) {
  return `M ${C - a},${C} a ${a},${b} 0 1,0 ${2 * a},0 a ${a},${b} 0 1,0 ${-2 * a},0 Z`;
}

const ORBITS = [
  { id: 'gsoc-orbit-1', a: 105, b: 30, tilt: -22, dur: 7, color: '#3ddcff', r: 2.4 },
  { id: 'gsoc-orbit-2', a: 112, b: 19, tilt: 30, dur: 11, color: '#52e3a4', r: 2.0 },
  { id: 'gsoc-orbit-3', a: 96, b: 44, tilt: 9, dur: 9, color: '#3ddcff', r: 1.8 },
];

const CSS = `
.gsoc-globe { width: 100%; height: 100%; display: block; overflow: visible; }
.gsoc-mer {
  fill: none; stroke: #3ddcff; stroke-width: 0.55;
  transform-box: fill-box; transform-origin: center;
  animation: gsoc-mer ${MER_DUR}s ease-in-out infinite;
}
@keyframes gsoc-mer {
  0%, 100% { transform: scaleX(1);    opacity: 0.5; }
  50%      { transform: scaleX(0.03); opacity: 0.12; }
}
.gsoc-atmo {
  transform-box: fill-box; transform-origin: center;
  animation: gsoc-atmo 6s ease-in-out infinite;
}
@keyframes gsoc-atmo {
  0%, 100% { opacity: 0.5;  transform: scale(1); }
  50%      { opacity: 0.85; transform: scale(1.045); }
}
.gsoc-star { animation: gsoc-tw var(--d,3s) ease-in-out infinite; }
@keyframes gsoc-tw { 0%, 100% { opacity: 0.12; } 50% { opacity: 0.7; } }

.gsoc-fire { transform-box: fill-box; transform-origin: center bottom; animation: gsoc-fire 0.55s ease-in-out infinite; }
@keyframes gsoc-fire { 0%,100% { transform: scaleY(0.9) scaleX(1.05); } 50% { transform: scaleY(1.3) scaleX(0.82); } }
.gsoc-fire-glow { animation: gsoc-fireglow 0.7s ease-in-out infinite; }
@keyframes gsoc-fireglow { 0%,100% { opacity: 0.3; } 50% { opacity: 0.65; } }
.gsoc-tornado { transform-box: fill-box; transform-origin: center top; animation: gsoc-twist 0.85s ease-in-out infinite; }
@keyframes gsoc-twist { 0%,100% { transform: skewX(-11deg); } 50% { transform: skewX(11deg); } }
.gsoc-bolt { animation: gsoc-bolt 0.55s ease-out forwards; }
@keyframes gsoc-bolt { 0% { opacity: 0; } 10% { opacity: 1; } 28% { opacity: 0.25; } 42% { opacity: 0.9; } 100% { opacity: 0; } }

@media (prefers-reduced-motion: reduce) {
  .gsoc-mer, .gsoc-atmo, .gsoc-star, .gsoc-fire, .gsoc-fire-glow, .gsoc-tornado { animation: none; }
  .gsoc-mer { opacity: 0.32; }
}
`;

export function GlobeAnimation() {
  // Live lightning: strikes flash in at random spots, then fade and are removed.
  const [bolts, setBolts] = useState<{ id: number; x: number; y: number; d: string }[]>([]);
  useEffect(() => {
    if (window.matchMedia('(prefers-reduced-motion: reduce)').matches) return;
    let alive = true;
    let timer = 0;
    const spawn = () => {
      if (!alive) return;
      const [x, y] = randomOnDisk(R * 0.8);
      const id = Date.now() + Math.random();
      setBolts((b) => [...b, { id, x, y, d: boltPath(x, y) }]);
      window.setTimeout(() => setBolts((b) => b.filter((z) => z.id !== id)), 560);
      timer = window.setTimeout(spawn, 700 + Math.random() * 1500);
    };
    timer = window.setTimeout(spawn, 600);
    return () => { alive = false; window.clearTimeout(timer); };
  }, []);

  return (
    <svg className="gsoc-globe" viewBox="0 0 240 240" role="presentation" aria-hidden="true">
      <style dangerouslySetInnerHTML={{ __html: CSS }} />
      <defs>
        {/* Atmospheric halo */}
        <radialGradient id="gsoc-atmo-grad" cx="50%" cy="50%" r="50%">
          <stop offset="58%" stopColor="#3ddcff" stopOpacity="0" />
          <stop offset="82%" stopColor="#3ddcff" stopOpacity="0.22" />
          <stop offset="100%" stopColor="#3ddcff" stopOpacity="0" />
        </radialGradient>
        {/* Sphere body: faint cyan sheen up-left, deep limb darkening to the edge */}
        <radialGradient id="gsoc-sphere" cx="38%" cy="32%" r="72%">
          <stop offset="0%" stopColor="#3ddcff" stopOpacity="0.16" />
          <stop offset="42%" stopColor="#0a1622" stopOpacity="0.35" />
          <stop offset="100%" stopColor="#02050a" stopOpacity="0.78" />
        </radialGradient>
        {/* Event gradients */}
        <linearGradient id="gsoc-flame" x1="0" y1="1" x2="0" y2="0">
          <stop offset="0%" stopColor="#ffd166" />
          <stop offset="55%" stopColor="#ff8a3d" />
          <stop offset="100%" stopColor="#ff3d2e" />
        </linearGradient>
        <radialGradient id="gsoc-firerad" cx="50%" cy="50%" r="50%">
          <stop offset="0%" stopColor="#ff6a2a" stopOpacity="0.8" />
          <stop offset="100%" stopColor="#ff6a2a" stopOpacity="0" />
        </radialGradient>
        <linearGradient id="gsoc-twirl" x1="0" y1="0" x2="0" y2="1">
          <stop offset="0%" stopColor="#c2cedb" stopOpacity="0.85" />
          <stop offset="100%" stopColor="#5f6b7a" stopOpacity="0.25" />
        </linearGradient>
        <filter id="gsoc-glow" x="-200%" y="-200%" width="500%" height="500%">
          <feGaussianBlur stdDeviation="2" result="b" />
          <feMerge>
            <feMergeNode in="b" />
            <feMergeNode in="SourceGraphic" />
          </feMerge>
        </filter>
        {ORBITS.map((o) => (
          <path key={o.id} id={o.id} d={ellipsePath(o.a, o.b)} />
        ))}
      </defs>

      {/* Starfield */}
      <g>
        {STARS.map((s, i) => (
          <circle
            key={i}
            className="gsoc-star"
            cx={s.x}
            cy={s.y}
            r={s.r}
            fill="#cdeaff"
            style={{ ['--d' as string]: `${s.dur}s`, animationDelay: `${s.delay}s` }}
          />
        ))}
      </g>

      {/* Atmosphere */}
      <circle className="gsoc-atmo" cx={C} cy={C} r={R + 30} fill="url(#gsoc-atmo-grad)" />

      {/* Sphere body */}
      <circle cx={C} cy={C} r={R} fill="url(#gsoc-sphere)" />

      {/* Wireframe cage */}
      <g>
        {LATS.map((l) => (
          <ellipse
            key={l.deg}
            cx={C}
            cy={l.cy}
            rx={l.rx}
            ry={l.ry}
            fill="none"
            stroke="#3ddcff"
            strokeWidth={l.deg === 0 ? 0.75 : 0.5}
            strokeOpacity={l.deg === 0 ? 0.55 : 0.2}
          />
        ))}
        {Array.from({ length: MER_COUNT }, (_, i) => (
          <ellipse
            key={i}
            className="gsoc-mer"
            cx={C}
            cy={C}
            rx={R}
            ry={POLE}
            style={{ animationDelay: `${-(i * MER_DUR) / MER_COUNT}s` }}
          />
        ))}
      </g>

      {/* Surface events — fires, tornadoes, live lightning (clipped to the globe) */}
      <g clipPath="url(#gsoc-disk)">
        {FIRES.map((f, i) => (
          <g key={`fire-${i}`}>
            <circle
              className="gsoc-fire-glow"
              cx={f.x}
              cy={f.y}
              r="7"
              fill="url(#gsoc-firerad)"
              style={{ animationDelay: `${f.delay}s` }}
            />
            <path
              className="gsoc-fire"
              d={flamePath(f.x, f.y)}
              fill="url(#gsoc-flame)"
              style={{ animationDelay: `${f.delay}s` }}
            />
          </g>
        ))}
        {TORNADOES.map((t, i) => (
          <path
            key={`tor-${i}`}
            className="gsoc-tornado"
            d={funnelPath(t.x, t.y)}
            fill="url(#gsoc-twirl)"
            stroke="#cdd6e0"
            strokeWidth="0.3"
            strokeOpacity="0.4"
            style={{ animationDelay: `${t.delay}s` }}
          />
        ))}
        {bolts.map((b) => (
          <g key={b.id} className="gsoc-bolt">
            <path
              d={b.d}
              fill="none"
              stroke="#cdeaff"
              strokeWidth="1.2"
              strokeLinecap="round"
              strokeLinejoin="round"
              filter="url(#gsoc-glow)"
            />
            <circle cx={b.x} cy={b.y} r="2.4" fill="#eaf6ff" filter="url(#gsoc-glow)" />
          </g>
        ))}
      </g>
      <clipPath id="gsoc-disk">
        <circle cx={C} cy={C} r={R} />
      </clipPath>

      {/* Glowing rim */}
      <circle
        cx={C}
        cy={C}
        r={R}
        fill="none"
        stroke="#3ddcff"
        strokeWidth="0.9"
        strokeOpacity="0.85"
        filter="url(#gsoc-glow)"
      />

      {/* Poles */}
      <circle cx={C} cy={C - POLE} r="1.5" fill="#3ddcff" fillOpacity="0.8" />
      <circle cx={C} cy={C + POLE} r="1.5" fill="#3ddcff" fillOpacity="0.4" />

      {/* Orbits + satellites */}
      {ORBITS.map((o) => (
        <g key={o.id} transform={`rotate(${o.tilt} ${C} ${C})`}>
          <use href={`#${o.id}`} fill="none" stroke={o.color} strokeWidth="0.4" strokeOpacity="0.22" />
          <circle r={o.r} fill={o.color} filter="url(#gsoc-glow)">
            <animateMotion dur={`${o.dur}s`} repeatCount="indefinite" rotate="auto">
              <mpath href={`#${o.id}`} />
            </animateMotion>
          </circle>
        </g>
      ))}
    </svg>
  );
}
