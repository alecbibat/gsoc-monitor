// RainViewer's "Universal Blue" colour table (scheme 2): the only palette the
// free API tier serves since 2026-01-01 (the colour-scheme parameter is
// ignored). Read from https://www.rainviewer.com/files/rainviewer_api_colors_table.csv
// (2026-09); every pixel of real 2026 tiles matches it exactly, so a tile can
// be decoded back to reflectivity without loss.
//
// Packed as 8 hex digits (RRGGBBAA) per entry, index = dBZ + 32 for dBZ −32…95.
// Rain and snow are separate ramps (snow is only painted when the tile URL
// asks for the snow tint). Rain below 15 dBZ is a translucent tan band; 15…34
// runs light cyan → navy (darker = stronger), then yellow → red → pink → white.

export const UB_MIN_DBZ = -32;
export const UB_MAX_DBZ = 95;

const RAIN =
  '0000000000000000000000000000000000000000000000000000000000000000' +
  '0000000000000000000000000000000000000000000000000000000000000000' +
  '0000000000000000000000000000000000000000000000006361591466635a19' +
  '69665c1e6c685d246f6b5f29726e612e75706234787364397c75653e7f786744' +
  '827b6949857d6a4e88806c548b826d598e856f5e928871649e93756eaa9e7978' +
  'b6a97e82c2b4828ccec08796d2c48ba0d6c88faadacc93b4ded097be88ddeeff' +
  '6cd1ebff51c5e8ff36bae5ff1baee2ff00a3e0ff009ad5ff0091caff0088bfff' +
  '007fb4ff0077aaff0070a3ff00699cff006295ff005b8eff005588ff005180ff' +
  '004e78ff004a70ff004768ffffee00ffffe000ffffd200ffffc500ffffb700ff' +
  'ffaa00ffff9f00ffff9500ffff8b00ffff8100ffff4400fff23600ffe62800ff' +
  'd91b00ffcd0d00ffc10000ffa80000ff8f0000ff760000ff5d0000ffffaaffff' +
  'ff9fffffff95ffffff8bffffff81ffffff77ffffff6cffffff62ffffff58ffff' +
  'ff4effffffffffffffffffffffffffffffffffffffffffffffffffffffffffff' +
  'ffffffffffffffffffffffff00ff00ff00ff00ff00ff00ff00ff00ff00ff00ff' +
  '00ff00ff00ff00ff00ff00ff00ff00ff00ff00ff00ff00ff00ff00ff00ff00ff' +
  '00ff00ff00ff00ff00ff00ff00ff00ff00ff00ff00ff00ff00ff00ff00ff00ff';

const SNOW =
  '0000000000000000000000000000000000000000000000000000000000000000' +
  '0000000000000000000000000000000000000000000000000000000000000000' +
  '000000000000000000000000000000000000000000000000cfffff00ceffff0c' +
  'cdffff19ccffff26cbffff33cbffff3fcaffff4cc9ffff59c8ffff66c7ffff72' +
  'c7ffff7fc6ffff8cc5ffff99c4ffffa5c3ffffb2c3ffffbfc2ffffccc1ffffd8' +
  'c0ffffe5bffffff2bfffffffb8f8ffffb2f2ffffabebffffa5e5ffff9fdfffff' +
  '98d8ffff92d2ffff8bcbffff85c5ffff7fbfffff78b8ffff72b2ffff6babffff' +
  '65a5ffff5f9fffff5b9bffff5898ffff5595ffff5292ffff4f8fffff4b8bffff' +
  '4888ffff4585ffff4282ffff3f7fffff3b7bffff3878ffff3575ffff3272ffff' +
  '2f6fffff2b6bffff2868ffff2565ffff2262ffff1f5fffff1b5bffff1858ffff' +
  '1555ffff1252ffff0f4fffff0c4bffff0948ffff0645ffff0242ffff003fffff' +
  '003bffff0038ffff0035ffff0032ffff002fffff002bffff0028ffff0025ffff' +
  '0022ffff001fffff001bffff0018ffff0015ffff0012ffff000fffff000cffff' +
  '0009ffff0006ffff0002ffff0000ffff0000ffff0000ffff0000ffff0000ffff' +
  '0000ffff0000ffff0000ffff0000ffff0000ffff0000ffff0000ffff0000ffff' +
  '0000ffff0000ffff0000ffff0000ffff0000ffff0000ffff0000ffff0000ffff';

function unpack(hex: string): Uint8Array {
  const out = new Uint8Array(hex.length / 2);
  for (let i = 0; i < out.length; i++) out[i] = parseInt(hex.slice(i * 2, i * 2 + 2), 16);
  return out;
}

// RGBA bytes, 4 per dBZ step from UB_MIN_DBZ.
export const UB_RAIN_RGBA = unpack(RAIN);
export const UB_SNOW_RGBA = unpack(SNOW);
