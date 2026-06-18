import { useEffect, useRef } from 'react';
import * as THREE from 'three';

// Genuine 3D wireframe rendered with Three.js, slowly rotating on its vertical
// axis. Two hull builds: a multi-deck motor yacht (Star class) and a
// multi-masted sailing yacht (Wind class), each shaped to match Windstar's
// actual vessels.

// Low-poly hull shared by both classes. `halfLen` sets the bow-to-stern
// half-length; `beam` sets the max breadth. The stem rakes forward over a
// tucked-under forefoot (clipper-ish bow) and narrows to a single point.
function buildHull(beam: number, halfLen = 3.5): THREE.BufferGeometry {
  const hl = halfLen;
  const hb = beam / 2;
  const dY = 1.0;          // freeboard (deck height above keel)
  const kY = 0;
  const positions = new Float32Array([
    // deck edge ─ port then stbd, stern to mid, bow
    -hl,      dY,       -hb,          // 0 stern deck port
    -hl,      dY,        hb,          // 1 stern deck stbd
     hl*0.42, dY*1.05, -hb,          // 2 mid deck port  (gentle sheer)
     hl*0.42, dY*1.05,  hb,          // 3 mid deck stbd
     hl+0.35, dY*1.16,   0,          // 4 bow stem (raked forward)
    // keel/bilge
    -hl,      kY,       -hb*0.40,    // 5 stern keel port
    -hl,      kY,        hb*0.40,    // 6 stern keel stbd
     hl*0.42, kY,       -hb*0.34,    // 7 mid keel port
     hl*0.42, kY,        hb*0.34,    // 8 mid keel stbd
     hl-0.05, kY+0.46,   0,          // 9 forefoot (tucked under the raked stem)
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

// Star-class mega-yacht (stretched ex-Seabourn, ~160 m): a long, low, sleek
// hull with a fairly level superstructure, a terraced stern stepping down to
// the aft marina, and a single low rounded funnel set aft of midships.
function buildStar(ship: THREE.Group, mat: THREE.LineBasicMaterial) {
  const hl = 4.7;
  const beam = 1.2;
  ship.add(edgesOf(buildHull(beam, hl), mat));

  // Superstructure decks as boxes spanning [xAft .. xFwd]. Each higher deck
  // stops further forward at the stern → terraced stern; the bridge deck juts
  // forward at the top. Long and low rather than a stepped wedding-cake.
  // [xAft, xFwd, yBase, height, beam-fraction]
  const decks: [number, number, number, number, number][] = [
    [-3.95, 3.05, 1.00, 0.52, 0.92],  // main superstructure deck
    [-3.55, 2.65, 1.52, 0.46, 0.84],  // upper deck
    [-2.95, 1.85, 1.98, 0.42, 0.70],  // lido / sun deck
    [ 0.15, 2.25, 2.40, 0.40, 0.56],  // bridge deck (forward)
  ];
  for (const [xa, xf, y, h, bf] of decks) {
    const box = edgesOf(new THREE.BoxGeometry(xf - xa, h, beam * bf), mat);
    box.position.set((xa + xf) / 2, y + h / 2, 0);
    ship.add(box);
  }

  // Bridge wings — thin platforms either side of the bridge front.
  const bwX  = 2.05;
  const bwY  = 2.62;
  const bwHB = (beam * 0.56) / 2;
  ship.add(segments([bwX, bwY, bwHB,  bwX, bwY, bwHB + 0.24], mat));
  ship.add(segments([bwX, bwY, -bwHB, bwX, bwY, -bwHB - 0.24], mat));

  // Single low rounded funnel, aft of midships, rising off the lido deck.
  const funnel = edgesOf(new THREE.CylinderGeometry(0.20, 0.27, 0.80, 10), mat);
  funnel.position.set(-1.95, 2.40 + 0.40, 0);
  ship.add(funnel);
  // Funnel cap ring + short exhaust spoiler.
  ship.add(segments([-2.18, 2.80, 0, -1.72, 2.80, 0], mat));

  // Signal mast above the bridge.
  ship.add(segments([1.65, 2.80, 0, 1.55, 3.78, 0], mat));      // raked mast
  ship.add(segments([1.58, 3.50, -0.30, 1.58, 3.50, 0.30], mat)); // radar yard

  // Short foremast on the foredeck.
  ship.add(segments([3.15, 1.18, 0, 3.10, 2.35, 0], mat));
}

// Wind-class staysail schooner (4 or 5 masts): tall raked masts carrying
// triangular fore-and-aft sails — a jib off the bowsprit, a staysail filling
// each gap between masts (luff on the forestay, tall at the aft mast), and a
// spanker set aft of the last mast. Low sleek hull with a modest deckhouse.
function buildWind(ship: THREE.Group, mat: THREE.LineBasicMaterial, mastCount: number) {
  const hl  = 4.7;
  const beam = 0.9;
  ship.add(edgesOf(buildHull(beam, hl), mat));

  // Long low deckhouse amidships + a slightly raised bridge/uptake aft of centre.
  const house = edgesOf(new THREE.BoxGeometry(5.4, 0.34, beam * 0.8), mat);
  house.position.set(-0.3, 1.16, 0);
  ship.add(house);
  const bridge = edgesOf(new THREE.BoxGeometry(1.3, 0.30, beam * 0.66), mat);
  bridge.position.set(-1.7, 1.50, 0);
  ship.add(bridge);

  // Masts ordered bow → stern (descending x), evenly spaced.
  const xs = mastCount === 5
    ? [3.5, 1.75, 0.0, -1.75, -3.5]
    : [3.1, 1.05, -1.05, -3.1];

  const deckY = 1.18;   // tack / foot height
  const mastH = 4.7;    // masthead height
  const rake  = 0.24;   // masthead offset aft (masts rake aft)
  const top   = (x: number) => x - rake;

  const bowTip = hl + 0.7; // bowsprit tip x

  const pts: number[] = [];

  // Masts
  for (const x of xs) pts.push(x, deckY, 0,  top(x), mastH, 0);

  // Triangular sail outline helper: head, tack, clew (all in the centre plane).
  const sail = (hx: number, hy: number, tx: number, ty: number, cx: number, cy: number) => {
    pts.push(hx, hy, 0,  tx, ty, 0);   // luff
    pts.push(tx, ty, 0,  cx, cy, 0);   // foot
    pts.push(hx, hy, 0,  cx, cy, 0);   // leech
    // faint mid-seam for a little cloth detail
    pts.push((hx + tx) / 2, (hy + ty) / 2, 0,  cx, cy, 0);
  };

  // Jib: bowsprit tip → foremast.
  sail(top(xs[0]), mastH,  bowTip, 0.78,  xs[0], deckY);

  // Staysails: between each pair of masts, luff on the forestay (aft masthead
  // down to the forward mast base), tall at the aft mast.
  for (let i = 0; i < xs.length - 1; i++) {
    const fwd = xs[i], aft = xs[i + 1];
    sail(top(aft), mastH,  fwd, deckY,  aft, deckY);
  }

  // Spanker: aft of the last mast.
  const last = xs[xs.length - 1];
  sail(top(last), mastH,  last, deckY,  last - 1.5, deckY + 0.06);

  // Bowsprit + bobstay.
  pts.push(hl - 0.5, 1.05, 0,  bowTip, 0.78, 0);
  pts.push(bowTip, 0.78, 0,  hl - 0.05, 0.30, 0);

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

    const renderer = new THREE.WebGLRenderer({ alpha: true, antialias: true });
    renderer.setSize(width, height);
    renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
    mount.appendChild(renderer.domElement);

    const mat = new THREE.LineBasicMaterial({ color });
    const ship = new THREE.Group();
    if (variant === 'star') buildStar(ship, mat);
    else buildWind(ship, mat, masts);
    scene.add(ship);

    // Frame the camera to the model's bounds so nothing clips the canvas edge
    // at any rotation (the ship spins about its vertical axis, so the limiting
    // horizontal reach is the max radius from that axis).
    ship.updateMatrixWorld(true);
    const box = new THREE.Box3().setFromObject(ship);
    const horizR = Math.hypot(
      Math.max(Math.abs(box.min.x), Math.abs(box.max.x)),
      Math.max(Math.abs(box.min.z), Math.abs(box.max.z))
    );
    const centerY = (box.min.y + box.max.y) / 2;
    const vertHalf = (box.max.y - box.min.y) / 2;
    const vtan = Math.tan(((camera.fov * Math.PI) / 180) / 2);
    const margin = 1.2;
    const dist = Math.max(
      (horizR * margin) / (vtan * (width / height)), // fit length within the wide canvas
      (vertHalf * margin) / vtan                     // fit masts within the height
    );
    camera.position.set(0, centerY + vertHalf * 0.22, dist);
    camera.lookAt(0, centerY, 0);

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
