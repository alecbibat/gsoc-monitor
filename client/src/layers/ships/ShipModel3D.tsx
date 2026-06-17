import { useEffect, useRef } from 'react';
import * as THREE from 'three';

// A genuine 3D wireframe of the vessel, rendered with Three.js and slowly
// rotating on its vertical axis. Two hull/​superstructure builds: a multi-deck
// motor yacht (Star class) and a tall-masted sailing ship (Wind class).

// Low-poly hull: a pointed-bow, transom-stern boat shape defined by hand so the
// wireframe reads as a ship from every angle (an extruded slab would not).
function buildHull(beam: number): THREE.BufferGeometry {
  const hl = 3; // half length
  const hb = beam / 2; // half beam
  const deckY = 1;
  const keelY = 0;
  const positions = new Float32Array([
    -hl, deckY, -hb,            // 0 stern deck port
    -hl, deckY, hb,             // 1 stern deck stbd
    hl * 0.45, deckY, -hb,      // 2 mid deck port
    hl * 0.45, deckY, hb,       // 3 mid deck stbd
    hl, deckY, 0,               // 4 bow deck point
    -hl, keelY, -hb * 0.45,     // 5 stern keel port
    -hl, keelY, hb * 0.45,      // 6 stern keel stbd
    hl * 0.45, keelY, -hb * 0.45, // 7 mid keel port
    hl * 0.45, keelY, hb * 0.45,  // 8 mid keel stbd
    hl, keelY + 0.35, 0,        // 9 bow forefoot (rises toward bow)
  ]);
  const index = [
    0, 2, 7, 0, 7, 5, 2, 4, 9, 2, 9, 7, // port side
    1, 6, 8, 1, 8, 3, 3, 8, 9, 3, 9, 4, // starboard side
    5, 7, 8, 5, 8, 6, 7, 9, 8,          // bottom
    0, 1, 3, 0, 3, 2, 2, 3, 4,          // deck
    0, 5, 6, 0, 6, 1,                   // transom
  ];
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.BufferAttribute(positions, 3));
  g.setIndex(index);
  g.computeVertexNormals();
  return g;
}

// Wrap a geometry's significant edges as line segments, then drop the source.
function edgesOf(geom: THREE.BufferGeometry, mat: THREE.LineBasicMaterial, threshold = 20): THREE.LineSegments {
  const e = new THREE.EdgesGeometry(geom, threshold);
  const ls = new THREE.LineSegments(e, mat);
  geom.dispose();
  return ls;
}

function segments(points: number[], mat: THREE.LineBasicMaterial): THREE.LineSegments {
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute(points, 3));
  return new THREE.LineSegments(g, mat);
}

function buildStar(ship: THREE.Group, mat: THREE.LineBasicMaterial) {
  const beam = 1.5;
  ship.add(edgesOf(buildHull(beam), mat));
  // Three stacked, tapering deck houses.
  const decks: [number, number, number, number, number][] = [
    // width(x), height, depth(z), x-offset, y
    [3.6, 0.5, beam * 0.92, -0.2, 1.25],
    [2.6, 0.45, beam * 0.78, -0.1, 1.7],
    [1.5, 0.4, beam * 0.6, 0.1, 2.1],
  ];
  for (const [w, h, d, x, y] of decks) {
    const box = edgesOf(new THREE.BoxGeometry(w, h, d), mat);
    box.position.set(x, y, 0);
    ship.add(box);
  }
  // Funnel.
  const funnel = edgesOf(new THREE.CylinderGeometry(0.18, 0.22, 0.5, 10), mat);
  funnel.position.set(0.15, 2.45, 0);
  ship.add(funnel);
  // Short radar mast above the bridge.
  ship.add(segments([0.1, 2.3, 0, 0.1, 3.0, 0, -0.1, 2.85, 0, 0.3, 2.85, 0], mat));
}

function buildWind(ship: THREE.Group, mat: THREE.LineBasicMaterial, mastCount: number) {
  const beam = 1.15;
  ship.add(edgesOf(buildHull(beam), mat));
  // One low deckhouse — sailing ships sit close to the water.
  const house = edgesOf(new THREE.BoxGeometry(2.6, 0.4, beam * 0.82), mat);
  house.position.set(-0.2, 1.2, 0);
  ship.add(house);

  const xs = mastCount === 5 ? [-2, -1, 0, 1, 2] : [-1.8, -0.6, 0.6, 1.8];
  const pts: number[] = [];
  for (const x of xs) {
    pts.push(x, 1, 0, x, 3.6, 0); // mast
    pts.push(x, 3.2, -0.95, x, 3.2, 0.95); // crossyard (athwartships)
    pts.push(x, 3.6, 0, x + 0.95, 1.05, 0); // forestay rigging
    pts.push(x, 3.6, 0, x - 0.95, 1.05, 0); // backstay rigging
  }
  // Bowsprit.
  pts.push(3, 1.05, 0, 3.9, 0.95, 0);
  ship.add(segments(pts, mat));
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
    const camera = new THREE.PerspectiveCamera(38, width / height, 0.1, 100);
    camera.position.set(0, 2.7, 8.6);
    camera.lookAt(0, 1.25, 0);

    const renderer = new THREE.WebGLRenderer({ alpha: true, antialias: true });
    renderer.setSize(width, height);
    renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
    mount.appendChild(renderer.domElement);

    const mat = new THREE.LineBasicMaterial({ color });
    const ship = new THREE.Group();
    if (variant === 'star') buildStar(ship, mat);
    else buildWind(ship, mat, masts);
    // Centre the hull vertically in frame.
    ship.position.y = -0.4;
    scene.add(ship);

    let raf = 0;
    let last = performance.now();
    const animate = () => {
      const now = performance.now();
      ship.rotation.y += ((now - last) / 1000) * 0.7; // ~9 s per revolution
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
