// Writes a brotli-11 `.br` sibling next to each compressible file in dist/, so
// the server can send them as-is instead of re-compressing multi-MB static
// files (Cesium.js) at quality 4 on every full response. Runs after
// `vite build` (see package.json), once vite-plugin-cesium has copied Cesium
// into dist/. Node built-ins only.
import { promises as fs } from 'node:fs';
import path from 'node:path';
import zlib from 'node:zlib';
import { promisify } from 'node:util';
import { fileURLToPath } from 'node:url';

const brotli = promisify(zlib.brotliCompress);
const dist = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../dist');
// Same set compression() would compress at runtime; html is excluded (index.html must stay as-is).
const COMPRESSIBLE = /\.(?:js|mjs|css|json|svg|wasm|txt|xml)$/;
const MIN_BYTES = 1024; // matches compression()'s default threshold

async function walk(dir) {
  const out = [];
  for (const e of await fs.readdir(dir, { withFileTypes: true })) {
    const p = path.join(dir, e.name);
    if (e.isDirectory()) out.push(...(await walk(p)));
    else if (COMPRESSIBLE.test(e.name)) out.push(p);
  }
  return out;
}

const files = await walk(dist);
await Promise.all(
  files.map(async (f) => {
    const buf = await fs.readFile(f);
    if (buf.length < MIN_BYTES) return;
    const out = await brotli(buf, {
      params: {
        [zlib.constants.BROTLI_PARAM_QUALITY]: 11,
        [zlib.constants.BROTLI_PARAM_SIZE_HINT]: buf.length,
      },
    });
    if (out.length < buf.length) await fs.writeFile(f + '.br', out);
  })
);
