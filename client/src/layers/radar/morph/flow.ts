// Motion-field estimation between two consecutive radar mosaics, used by the
// morph sheet to advect shapes instead of cross-fading them. Classic coarse
// block matching: downsample both mosaics, slide each block of A over B
// looking for the minimum sum-of-absolute-differences, then smooth the vector
// grid. Precision is deliberately modest — the goal is the *feel* of motion
// (zoom.earth's morph), not meteorologically exact advection.

interface Grid {
  w: number;
  h: number;
  data: Float32Array; // intensity per pixel (alpha-weighted)
}

const DOWN = 4; // downsample factor for matching
const BLOCK = 24; // block size in downsampled px
const SEARCH = 12; // ± search radius in downsampled px

function toGrid(mosaic: HTMLCanvasElement): Grid {
  const w = Math.max(1, Math.round(mosaic.width / DOWN));
  const h = Math.max(1, Math.round(mosaic.height / DOWN));
  const c = document.createElement('canvas');
  c.width = w;
  c.height = h;
  const ctx = c.getContext('2d', { willReadFrequently: true });
  if (!ctx) return { w, h, data: new Float32Array(w * h) };
  ctx.drawImage(mosaic, 0, 0, w, h);
  const d = ctx.getImageData(0, 0, w, h).data;
  const g = new Float32Array(w * h);
  for (let i = 0; i < w * h; i++) {
    // Alpha carries echo presence/strength after recoloring; fold in a touch
    // of luminance so intense cores anchor the match.
    g[i] = d[i * 4 + 3] + d[i * 4] * 0.25;
  }
  return { w, h, data: g };
}

function sad(a: Grid, b: Grid, ax: number, ay: number, bx: number, by: number, size: number): number {
  let sum = 0;
  for (let y = 0; y < size; y += 2) {
    const ar = (ay + y) * a.w + ax;
    const br = (by + y) * b.w + bx;
    for (let x = 0; x < size; x += 2) {
      sum += Math.abs(a.data[ar + x] - b.data[br + x]);
    }
  }
  return sum;
}

export interface FlowField {
  cols: number;
  rows: number;
  // displacement in FULL-RESOLUTION mosaic pixels, A → B
  dx: Float32Array;
  dy: Float32Array;
  // canvas encoding for the shader: RG = dx,dy mapped to 0..255 around 128
  texture: HTMLCanvasElement;
  // full-res pixels per encoded unit step of 1/255
  maxDisp: number;
}

// Whole-field SAD between the grids for a candidate shift — coarse but
// unambiguous, unlike per-block matching over flat stratiform texture.
function globalSad(a: Grid, b: Grid, sx: number, sy: number): number {
  let sum = 0;
  let n = 0;
  const step = 3;
  for (let y = Math.max(0, -sy); y < a.h && y + sy < b.h; y += step) {
    const ar = y * a.w;
    const br = (y + sy) * b.w;
    for (let x = Math.max(0, -sx); x < a.w && x + sx < b.w; x += step) {
      sum += Math.abs(a.data[ar + x] - b.data[br + x + sx]);
      n++;
    }
  }
  return n ? sum / n : Infinity;
}

export function estimateFlow(a: HTMLCanvasElement, b: HTMLCanvasElement): FlowField {
  const ga = toGrid(a);
  const gb = toGrid(b);
  const cols = Math.max(1, Math.floor(ga.w / BLOCK));
  const rows = Math.max(1, Math.floor(ga.h / BLOCK));
  const dx = new Float32Array(cols * rows);
  const dy = new Float32Array(cols * rows);

  // Pass 1: the dominant advection vector for the whole field (coarse sweep,
  // then ±1 refinement). Flat regions can't vote against it, so a rigid
  // translation — the common case over one 10-minute step — is found exactly.
  let gBest = Infinity;
  let gdx = 0;
  let gdy = 0;
  for (let sy = -SEARCH; sy <= SEARCH; sy += 2) {
    for (let sx = -SEARCH; sx <= SEARCH; sx += 2) {
      const s = globalSad(ga, gb, sx, sy);
      if (s < gBest) {
        gBest = s;
        gdx = sx;
        gdy = sy;
      }
    }
  }
  for (let sy = gdy - 1; sy <= gdy + 1; sy++) {
    for (let sx = gdx - 1; sx <= gdx + 1; sx++) {
      const s = globalSad(ga, gb, sx, sy);
      if (s < gBest) {
        gBest = s;
        gdx = sx;
        gdy = sy;
      }
    }
  }

  // Pass 2: per-block refinement around the global vector. Ambiguous blocks
  // (little SAD improvement over the global answer) keep the global motion
  // instead of collapsing to zero.
  const LOCAL = 4;
  for (let cy = 0; cy < rows; cy++) {
    for (let cx = 0; cx < cols; cx++) {
      const ax = cx * BLOCK;
      const ay = cy * BLOCK;
      let energy = 0;
      for (let y = 0; y < BLOCK; y += 3) {
        for (let x = 0; x < BLOCK; x += 3) {
          energy += ga.data[(ay + y) * ga.w + ax + x];
        }
      }
      const base = cy * cols + cx;
      if (energy < 500) {
        // Empty block: carry the global motion so bilinear flow sampling
        // doesn't drag still air against moving echo at region borders.
        dx[base] = gdx * DOWN;
        dy[base] = gdy * DOWN;
        continue;
      }

      let best = Infinity;
      let bdx = gdx;
      let bdy = gdy;
      let atGlobal = Infinity;
      for (let sy = gdy - LOCAL; sy <= gdy + LOCAL; sy++) {
        for (let sx = gdx - LOCAL; sx <= gdx + LOCAL; sx++) {
          const bx = ax + sx;
          const by = ay + sy;
          if (bx < 0 || by < 0 || bx + BLOCK > gb.w || by + BLOCK > gb.h) continue;
          const s = sad(ga, gb, ax, ay, bx, by, BLOCK);
          if (sx === gdx && sy === gdy) atGlobal = s;
          if (s < best) {
            best = s;
            bdx = sx;
            bdy = sy;
          }
        }
      }
      // Require a meaningful improvement to deviate from the global vector.
      if (atGlobal !== Infinity && best > atGlobal * 0.85) {
        bdx = gdx;
        bdy = gdy;
      }
      dx[base] = bdx * DOWN;
      dy[base] = bdy * DOWN;
    }
  }

  // Fill empty blocks from their neighbors and lightly smooth, so the shader's
  // bilinear sampling doesn't drag still air against moving cells.
  smoothFill(dx, cols, rows);
  smoothFill(dy, cols, rows);

  const maxDisp = SEARCH * DOWN;
  const texture = document.createElement('canvas');
  texture.width = cols;
  texture.height = rows;
  const ctx = texture.getContext('2d');
  if (ctx) {
    const img = ctx.createImageData(cols, rows);
    for (let i = 0; i < cols * rows; i++) {
      img.data[i * 4] = Math.round(128 + (dx[i] / maxDisp) * 127);
      img.data[i * 4 + 1] = Math.round(128 + (dy[i] / maxDisp) * 127);
      img.data[i * 4 + 2] = 128;
      img.data[i * 4 + 3] = 255;
    }
    ctx.putImageData(img, 0, 0);
  }
  return { cols, rows, dx, dy, texture, maxDisp };
}

function smoothFill(v: Float32Array, cols: number, rows: number) {
  const out = new Float32Array(v.length);
  for (let y = 0; y < rows; y++) {
    for (let x = 0; x < cols; x++) {
      let sum = 0;
      let n = 0;
      for (let oy = -1; oy <= 1; oy++) {
        for (let ox = -1; ox <= 1; ox++) {
          const yy = y + oy;
          const xx = x + ox;
          if (yy < 0 || xx < 0 || yy >= rows || xx >= cols) continue;
          const w = ox === 0 && oy === 0 ? 2 : 1;
          sum += v[yy * cols + xx] * w;
          n += w;
        }
      }
      out[y * cols + x] = n ? sum / n : 0;
    }
  }
  v.set(out);
}
