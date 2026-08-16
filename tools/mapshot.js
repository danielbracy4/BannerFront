// Render a map preset straight to a PNG, so the geography can be looked at
// rather than argued about. The client draws the same terrain array with the
// same six bands, so what comes out here is what a player sees under the
// territory paint.
//
//   node tools/mapshot.js [preset] [out.png] [seed]
//
// Writes the PNG by hand — zlib is in Node, and a map preview is not worth a
// dependency.
const zlib = require('zlib');
const fs = require('fs');
const c = require('../shared/core.js');

const PRESET = process.argv[2] || 'europe';
const OUT    = process.argv[3] || 'map-' + PRESET + '.png';
const SEED   = +(process.argv[4] || 3);
const SCALE  = 2;

// The client's vellum palette, so this reads like the game and not like a
// heightmap: sea, shoal, wheat plain, sage wood, ochre hill, bare peak.
const BAND = [
  [ 74, 96,114],   // sea
  [108,132,146],   // shoal
  [216,201,160],   // plain — wheat
  [143,160,113],   // wood  — sage
  [178,142, 92],   // hill  — ochre, kept well clear of plain so the two do not
  [156,146,138],   // peak  — read as one mass at a glance
];

function crc32(buf){
  let t = crc32.t;
  if (!t){
    t = crc32.t = new Int32Array(256);
    for (let n = 0; n < 256; n++){
      let x = n;
      for (let k = 0; k < 8; k++) x = x & 1 ? 0xedb88320 ^ (x >>> 1) : x >>> 1;
      t[n] = x;
    }
  }
  let crc = -1;
  for (let i = 0; i < buf.length; i++) crc = (crc >>> 8) ^ t[(crc ^ buf[i]) & 0xff];
  return (crc ^ -1) >>> 0;
}

function chunk(type, data){
  const len = Buffer.alloc(4); len.writeUInt32BE(data.length);
  const td = Buffer.concat([Buffer.from(type, 'ascii'), data]);
  const crc = Buffer.alloc(4); crc.writeUInt32BE(crc32(td));
  return Buffer.concat([len, td, crc]);
}

function png(width, height, rgb){
  const raw = Buffer.alloc((width * 3 + 1) * height);
  let o = 0;
  for (let y = 0; y < height; y++){
    raw[o++] = 0;                                   // filter: none
    rgb.copy(raw, o, y * width * 3, (y + 1) * width * 3);
    o += width * 3;
  }
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(width, 0); ihdr.writeUInt32BE(height, 4);
  ihdr[8] = 8; ihdr[9] = 2; ihdr[10] = 0; ihdr[11] = 0; ihdr[12] = 0;
  return Buffer.concat([
    Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    chunk('IHDR', ihdr),
    chunk('IDAT', zlib.deflateSync(raw, { level: 9 })),
    chunk('IEND', Buffer.alloc(0)),
  ]);
}

const g = c.makeMatch({ bots: 0, preset: PRESET, seed: SEED });
const W = g.W, H = g.H, SW = W * SCALE, SH = H * SCALE;
const rgb = Buffer.alloc(SW * SH * 3);
for (let y = 0; y < SH; y++){
  for (let x = 0; x < SW; x++){
    const t = g.terrain[((y / SCALE) | 0) * W + ((x / SCALE) | 0)];
    const col = BAND[t] || BAND[0];
    const o = (y * SW + x) * 3;
    rgb[o] = col[0]; rgb[o + 1] = col[1]; rgb[o + 2] = col[2];
  }
}
fs.writeFileSync(OUT, png(SW, SH, rgb));

// The mix matters as much as the outline: terrain sets what ground costs to
// take, so a map that has quietly become half upland is a balance change.
const NAME = ['sea', 'shoal', 'plain', 'wood', 'hill', 'peak'];
const n = [0, 0, 0, 0, 0, 0];
for (let i = 0; i < g.N; i++) n[g.terrain[i]]++;
const land = n[2] + n[3] + n[4] + n[5];
console.log(OUT + '  ' + SW + '×' + SH + '  land ' + (land / g.N * 100).toFixed(1) + '% of map');
console.log('  of that land: ' + [2, 3, 4, 5]
  .map(t => NAME[t] + ' ' + (n[t] / land * 100).toFixed(1) + '%').join(' · '));
