import { useEffect, useRef } from 'react';
import * as THREE from 'three';

// Genuine 3D wireframe rendered with Three.js, slowly rotating on its vertical
// axis. Two hull builds: a multi-deck motor yacht (Star class) and a
// multi-masted sailing yacht (Wind class), each shaped to match Windstar's
// actual vessels.

// Low-poly hull shared by both classes. `halfLen` sets the bow-to-stern
// half-length; `beam` sets the max breadth. The bow rises slightly above the
// stern (foredeck) and narrows to a single stem point.
function buildHull(beam: number, halfLen = 3.5): THREE.BufferGeometry {
  const hl = halfLen;
  const hb = beam / 2;
  const dY = 1.0;          // freeboard (deck height above keel)
  const kY = 0;
  const positions = new Float32Array([
    // deck edge ─ port then stbd, stern to mid, bow
    -hl,     dY,       -hb,          // 0 stern deck port
    -hl,     dY,        hb,          // 1 stern deck stbd
     hl*0.4, dY*1.12, -hb,          // 2 mid deck port  (foredeck rises slightly)
     hl*0.4, dY*1.12,  hb,          // 3 mid deck stbd
     hl,     dY*1.22,   0,          // 4 bow stem
    // keel/bilge
    -hl,     kY,       -hb*0.38,    // 5 stern keel port
    -hl,     kY,        hb*0.38,    // 6 stern keel stbd
     hl*0.4, kY,       -hb*0.32,    // 7 mid keel port
     hl*0.4, kY,        hb*0.32,    // 8 mid keel stbd
     hl,     kY+0.28,   0,          // 9 forefoot
  ]);
  const index = [
    0,2,7, 0,7,5, 2,4,9, 2,9,7,      // port side
    1,6,8, 1,8,3, 3,8,9, 3,9,4,      // stbd side
    5,7,8, 5,8,6, 7,9,8,              // bottom
    0,1,3, 0,3,2, 2,3,4,              // deck
    0,5,6, 0,6,1,                     // transom
  ];
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.BufferAttribute(positions, 3));
  g.setIndex(index);
  g.computeVertexNormals();
  return g;
}

function edgesOf(geom: THREE.BufferGeometry, mat: THREE.LineBasicMaterial, threshold = 20): THREE.LineSegments {
  const e = new THREE.EdgesGeometry(geom, threshold);
  const ls = new THREE.LineSegments(e, mat);
  geom.dispose();
  return ls;
}

function segments(pts: number[], mat: THREE.LineBasicMaterial): THREE.LineSegments {
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute(pts, 3));
  return new THREE.LineSegments(g, mat);
}

// Star-class motor yacht: ~159 m long, five deck superstructure, single funnel
// positioned aft-of-center, bridge wings, communications mast, foremast.
function buildStar(ship: THREE.Group, mat: THREE.LineBasicMaterial) {
  const hl = 4.5;
  const beam = 1.3;
  ship.add(edgesOf(buildHull(beam, hl), mat));

  // Five stacked deck boxes, each progressively narrower and shifted forward,
  // reflecting the stepped cruise-ship silhouette when viewed from the side.
  // [width, height, beam-fraction, x-center, y-base]
  const decks: [number, number, number, number, number][] = [
    [7.0, 0.42, 0.93, -0.50, 1.00],  // main deck
    [5.8, 0.40, 0.85, -0.10, 1.42],  // promenade
    [4.6, 0.38, 0.76,  0.30, 1.82],  // lido
    [3.6, 0.36, 0.66,  0.60, 2.20],  // observation
    [2.6, 0.34, 0.54,  0.90, 2.56],  // bridge deck
  ];
  for (const [w, h, bf, x, y] of decks) {
    const box = edgesOf(new THREE.BoxGeometry(w, h, beam * bf), mat);
    box.position.set(x, y + h / 2, 0);
    ship.add(box);
  }

  // Bridge wings — thin horizontal platforms at the forward ends of the bridge
  const bwX  = 0.90 + 2.6 / 2;         // bow edge of bridge deck (x = 2.2)
  const bwY  = 2.56 + 0.17;             // mid-height of bridge
  const bwHB = (beam * 0.54) / 2;       // half-beam of bridge deck
  ship.add(segments([bwX, bwY, bwHB,  bwX, bwY, bwHB + 0.26], mat));
  ship.add(segments([bwX, bwY, -bwHB, bwX, bwY, -bwHB - 0.26], mat));

  // Single funnel, aft of centre, rising above the lido deck
  const funnel = edgesOf(new THREE.CylinderGeometry(0.17, 0.23, 0.80, 8), mat);
  funnel.position.set(-1.65, 2.20 + 0.40, 0);
  ship.add(funnel);

  // Radar/comms mast above the bridge
  const mX   = 1.50;
  const mBase = 2.56 + 0.34;
  ship.add(segments([mX, mBase, 0, mX, mBase + 0.92, 0], mat));
  ship.add(segments([mX, mBase + 0.72, -0.34, mX, mBase + 0.72, 0.34], mat));

  // Foremast at the bow
  ship.add(segments([2.85, 1.10, 0, 2.85, 2.55, 0], mat));
}

// Wind-class sailing yacht: 4 or 5 Dynarig masts, each with a triangular sail
// outline (mast, boom, leeches). Running stays connect masthead to next mast
// base. Long bowsprit forward with a forestay to the first mast.
function buildWind(ship: THREE.Group, mat: THREE.LineBasicMaterial, mastCount: number) {
  const hl  = 4.5;
  const beam = 0.88;
  ship.add(edgesOf(buildHull(beam, hl), mat));

  // Low deckhouse
  const house = edgesOf(new THREE.BoxGeometry(4.0, 0.38, beam * 0.84), mat);
  house.position.set(-0.2, 1.19, 0);
  ship.add(house);

  const xs = mastCount === 5
    ? [-3.2, -1.6, 0.0, 1.6, 3.2]
    : [-2.8, -0.95, 0.95, 2.8];

  const mastH  = 3.9;  // masthead y
  const boomY  = 1.12; // boom / foot-of-sail height
  const boomHW = 0.78; // half-span of boom and crossyard

  const pts: number[] = [];
  for (const x of xs) {
    // Mast (vertical spar)
    pts.push(x, boomY, 0,  x, mastH, 0);
    // Boom (athwartships spar at foot of sail)
    pts.push(x, boomY, -boomHW,  x, boomY, boomHW);
    // Crossyard (athwartships spar at head of sail, slightly inboard)
    pts.push(x, mastH - 0.18, -boomHW * 0.9,  x, mastH - 0.18, boomHW * 0.9);
    // Port leech (diagonal sail edge: masthead to boom port end)
    pts.push(x, mastH, 0,  x, boomY, -boomHW);
    // Stbd leech
    pts.push(x, mastH, 0,  x, boomY, boomHW);
  }

  // Running stays: masthead of each forward mast down to deck of the next aft mast
  for (let i = 0; i < xs.length - 1; i++) {
    pts.push(xs[i], mastH, 0,  xs[i + 1], boomY + 0.05, 0);
  }

  // Bowsprit (angled forward and slightly down from the stem)
  const bowX = hl - 0.1;
  const spritTip = [bowX + 1.1, 0.72, 0];
  pts.push(bowX, 1.12, 0,  ...spritTip);
  // Forestay from bowsprit tip to first mast
  pts.push(...spritTip,  xs[0], mastH, 0);
  // Bobstay (from bowsprit tip down to forefoot)
  pts.push(...spritTip,  bowX, 0.28, 0);

  ship.add(segments(pts, mat));
}

// Build the ship once with Three.js, then extract every wireframe segment as a
// flat list of local-space coordinates (x,y,z, x,y,z, …) — each consecutive
// pair of vertices is one line segment. Model axes: +X = bow, +Y = up (masts),
// +Z = starboard, keel at y = 0. Reused by the Cesium globe layer that places
// the same model on the water during the pins screensaver. Cached per variant.
const _segCache = new Map<string, number[]>();
export function shipWireframeSegments(variant: 'star' | 'wind', masts = 4): number[] {
  const key = `${variant}-${masts}`;
  const cached = _segCache.get(key);
  if (cached) return cached;

  const mat = new THREE.LineBasicMaterial();
  const ship = new THREE.Group();
  if (variant === 'star') buildStar(ship, mat);
  else buildWind(ship, mat, masts);
  ship.updateMatrixWorld(true);

  const out: number[] = [];
  const v = new THREE.Vector3();
  ship.traverse((o) => {
    const ls = o as THREE.LineSegments;
    if (!ls.isLineSegments || !ls.geometry) return;
    const pos = ls.geometry.getAttribute('position') as THREE.BufferAttribute | undefined;
    if (!pos) return;
    for (let i = 0; i < pos.count; i++) {
      v.set(pos.getX(i), pos.getY(i), pos.getZ(i));
      ls.localToWorld(v); // bake in each child's position offset
      out.push(v.x, v.y, v.z);
    }
    ls.geometry.dispose();
  });
  mat.dispose();

  _segCache.set(key, out);
  return out;
}

// Wind Surf is the fleet's only 5-masted vessel; the rest carry 4.
export function mastCountForShip(name?: string): number {
  return name && /surf/i.test(name) ? 5 : 4;
}

interface Props {
  variant: 'star' | 'wind';
  color: string;
  masts?: number;
  width?: number;
  height?: number;
}

export function ShipModel3D({ variant, color, masts = 4, width = 190, height = 118 }: Props) {
  const mountRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const mount = mountRef.current;
    if (!mount) return;

    const scene = new THREE.Scene();
    const camera = new THREE.PerspectiveCamera(35, width / height, 0.1, 100);
    camera.position.set(0, 3.2, 11.5);
    camera.lookAt(0, 1.6, 0);

    const renderer = new THREE.WebGLRenderer({ alpha: true, antialias: true });
    renderer.setSize(width, height);
    renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
    mount.appendChild(renderer.domElement);

    const mat = new THREE.LineBasicMaterial({ color });
    const ship = new THREE.Group();
    if (variant === 'star') buildStar(ship, mat);
    else buildWind(ship, mat, masts);
    ship.position.y = -0.6;
    scene.add(ship);

    let raf = 0;
    let last = performance.now();
    const animate = () => {
      const now = performance.now();
      ship.rotation.y += ((now - last) / 1000) * 0.65;
      last = now;
      renderer.render(scene, camera);
      raf = requestAnimationFrame(animate);
    };
    animate();

    return () => {
      cancelAnimationFrame(raf);
      ship.traverse((o) => {
        const ls = o as THREE.LineSegments;
        if (ls.geometry) ls.geometry.dispose();
      });
      mat.dispose();
      renderer.dispose();
      if (renderer.domElement.parentNode === mount) mount.removeChild(renderer.domElement);
    };
  }, [variant, color, masts, width, height]);

  return <div ref={mountRef} style={{ width, height }} />;
}
