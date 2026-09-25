// Minimal PNG decoder for radar tiles: exact RGBA bytes with no colour
// management and no premultiplication — a canvas round-trip can nudge
// translucent pixels' RGB, and the radar decode matches colours exactly.
// Inflates with the platform's DecompressionStream (browsers, workers and
// Node 18+), so it needs no dependency. Handles 8-bit truecolour/grey (with
// or without alpha, and tRNS colour keys) and 1/2/4/8-bit palette/grey;
// interlaced images throw and the caller falls back to the browser's decoder.

export interface DecodedImage {
  width: number;
  height: number;
  data: Uint8Array; // RGBA, row-major, top row first
}

const SIGNATURE = [137, 80, 78, 71, 13, 10, 26, 10];

async function inflate(data: Uint8Array): Promise<Uint8Array> {
  const stream = new Blob([data as Uint8Array<ArrayBuffer>]).stream().pipeThrough(new DecompressionStream('deflate'));
  return new Uint8Array(await new Response(stream).arrayBuffer());
}

function paeth(a: number, b: number, c: number): number {
  const p = a + b - c;
  const pa = Math.abs(p - a);
  const pb = Math.abs(p - b);
  const pc = Math.abs(p - c);
  return pa <= pb && pa <= pc ? a : pb <= pc ? b : c;
}

export async function decodePng(bytes: Uint8Array): Promise<DecodedImage> {
  for (let i = 0; i < 8; i++) {
    if (bytes[i] !== SIGNATURE[i]) throw new Error('not a PNG');
  }
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  let width = 0;
  let height = 0;
  let bitDepth = 0;
  let colorType = 0;
  let interlace = 0;
  let palette: Uint8Array | null = null;
  let trns: Uint8Array | null = null;
  const idat: Uint8Array[] = [];
  let idatLength = 0;

  for (let p = 8; p + 8 <= bytes.length; ) {
    const len = view.getUint32(p);
    const type = String.fromCharCode(bytes[p + 4], bytes[p + 5], bytes[p + 6], bytes[p + 7]);
    const start = p + 8;
    if (start + len > bytes.length) throw new Error('truncated PNG');
    const body = bytes.subarray(start, start + len);
    if (type === 'IHDR') {
      width = view.getUint32(start);
      height = view.getUint32(start + 4);
      bitDepth = body[8];
      colorType = body[9];
      interlace = body[12];
    } else if (type === 'PLTE') {
      palette = body;
    } else if (type === 'tRNS') {
      trns = body;
    } else if (type === 'IDAT') {
      idat.push(body);
      idatLength += len;
    } else if (type === 'IEND') {
      break;
    }
    p = start + len + 4; // skip CRC
  }

  if (!width || !height) throw new Error('PNG has no IHDR');
  if (interlace !== 0) throw new Error('interlaced PNG');
  const channels = { 0: 1, 2: 3, 3: 1, 4: 2, 6: 4 }[colorType];
  if (!channels) throw new Error(`unsupported PNG colour type ${colorType}`);
  if (bitDepth !== 8 && !(bitDepth < 8 && (colorType === 3 || colorType === 0))) {
    throw new Error(`unsupported PNG bit depth ${bitDepth}`);
  }
  if (colorType === 3 && !palette) throw new Error('palette PNG without PLTE');

  const compressed = new Uint8Array(idatLength);
  let off = 0;
  for (const chunk of idat) {
    compressed.set(chunk, off);
    off += chunk.length;
  }
  const raw = await inflate(compressed);

  const bpp = Math.max(1, (channels * bitDepth) >> 3); // filter byte distance
  const stride = Math.ceil((width * channels * bitDepth) / 8);
  if (raw.length < (stride + 1) * height) throw new Error('truncated PNG data');

  // Unfilter in place into `lines` (height × stride).
  const lines = new Uint8Array(stride * height);
  for (let y = 0; y < height; y++) {
    const filter = raw[y * (stride + 1)];
    const src = y * (stride + 1) + 1;
    const dst = y * stride;
    const prev = dst - stride;
    for (let x = 0; x < stride; x++) {
      const v = raw[src + x];
      const a = x >= bpp ? lines[dst + x - bpp] : 0;
      const b = y > 0 ? lines[prev + x] : 0;
      const c = x >= bpp && y > 0 ? lines[prev + x - bpp] : 0;
      let out: number;
      switch (filter) {
        case 0: out = v; break;
        case 1: out = v + a; break;
        case 2: out = v + b; break;
        case 3: out = v + ((a + b) >> 1); break;
        case 4: out = v + paeth(a, b, c); break;
        default: throw new Error(`bad PNG filter ${filter}`);
      }
      lines[dst + x] = out & 0xff;
    }
  }

  const data = new Uint8Array(width * height * 4);
  if (colorType === 6 && bitDepth === 8) {
    data.set(lines);
    return { width, height, data };
  }
  const maxSample = (1 << bitDepth) - 1;
  // Grey and RGB images mark one colour transparent through tRNS (16-bit
  // big-endian samples; at 8 bits only the low byte matters).
  const keyGrey = colorType === 0 && trns && trns.length >= 2 ? ((trns[0] << 8) | trns[1]) & maxSample : -1;
  const keyRgb =
    colorType === 2 && trns && trns.length >= 6 ? [trns[1], trns[3], trns[5]] : null;
  for (let y = 0; y < height; y++) {
    const row = y * stride;
    for (let x = 0; x < width; x++) {
      const o = (y * width + x) * 4;
      if (bitDepth < 8) {
        const bit = x * bitDepth;
        const sample = (lines[row + (bit >> 3)] >> (8 - bitDepth - (bit & 7))) & maxSample;
        if (colorType === 3) {
          data[o] = palette![sample * 3];
          data[o + 1] = palette![sample * 3 + 1];
          data[o + 2] = palette![sample * 3 + 2];
          data[o + 3] = trns && sample < trns.length ? trns[sample] : 255;
        } else {
          const g = Math.round((sample * 255) / maxSample);
          data[o] = data[o + 1] = data[o + 2] = g;
          data[o + 3] = sample === keyGrey ? 0 : 255;
        }
        continue;
      }
      const i = row + x * channels;
      switch (colorType) {
        case 0:
          data[o] = data[o + 1] = data[o + 2] = lines[i];
          data[o + 3] = lines[i] === keyGrey ? 0 : 255;
          break;
        case 2:
          data[o] = lines[i];
          data[o + 1] = lines[i + 1];
          data[o + 2] = lines[i + 2];
          data[o + 3] =
            keyRgb && lines[i] === keyRgb[0] && lines[i + 1] === keyRgb[1] && lines[i + 2] === keyRgb[2] ? 0 : 255;
          break;
        case 3: {
          const s = lines[i];
          data[o] = palette![s * 3];
          data[o + 1] = palette![s * 3 + 1];
          data[o + 2] = palette![s * 3 + 2];
          data[o + 3] = trns && s < trns.length ? trns[s] : 255;
          break;
        }
        case 4:
          data[o] = data[o + 1] = data[o + 2] = lines[i];
          data[o + 3] = lines[i + 1];
          break;
      }
    }
  }
  return { width, height, data };
}
