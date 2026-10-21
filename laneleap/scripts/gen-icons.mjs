// Generates the PWA PNG icons (original pixel-art of Sprout) with no dependencies.
import { deflateSync } from 'node:zlib';
import { writeFileSync, mkdirSync } from 'node:fs';

const crcTable = new Uint32Array(256).map((_, n) => {
  let c = n;
  for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
  return c >>> 0;
});
const crc32 = (buf) => {
  let c = 0xffffffff;
  for (const b of buf) c = crcTable[(c ^ b) & 0xff] ^ (c >>> 8);
  return (c ^ 0xffffffff) >>> 0;
};
const chunk = (type, data) => {
  const len = Buffer.alloc(4);
  len.writeUInt32BE(data.length);
  const td = Buffer.concat([Buffer.from(type), data]);
  const crc = Buffer.alloc(4);
  crc.writeUInt32BE(crc32(td));
  return Buffer.concat([len, td, crc]);
};
function png(size, pixel) {
  const raw = Buffer.alloc((size * 4 + 1) * size);
  for (let y = 0; y < size; y++) {
    raw[y * (size * 4 + 1)] = 0;
    for (let x = 0; x < size; x++) {
      const [r, g, b, a] = pixel(x / size, y / size);
      const o = y * (size * 4 + 1) + 1 + x * 4;
      raw[o] = r;
      raw[o + 1] = g;
      raw[o + 2] = b;
      raw[o + 3] = a;
    }
  }
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(size, 0);
  ihdr.writeUInt32BE(size, 4);
  ihdr[8] = 8;
  ihdr[9] = 6;
  return Buffer.concat([
    Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]),
    chunk('IHDR', ihdr),
    chunk('IDAT', deflateSync(raw)),
    chunk('IEND', Buffer.alloc(0)),
  ]);
}
const hex = (h) => [parseInt(h.slice(1, 3), 16), parseInt(h.slice(3, 5), 16), parseInt(h.slice(5, 7), 16), 255];
// 32x32 art, drawn as rectangles [x, y, w, h, color] in grid units.
const art = [
  [0, 0, 32, 32, '#3fa7d6'],
  [0, 21, 32, 11, '#4f5560'],
  [2, 26, 6, 1, '#f2f2f2'],
  [13, 26, 6, 1, '#f2f2f2'],
  [24, 26, 6, 1, '#f2f2f2'],
  [0, 20, 32, 1, '#8fd16a'],
  [8, 8, 16, 14, '#1f2a44'],
  [9, 9, 14, 12, '#8ee05a'],
  [11, 16, 10, 5, '#5fb83a'],
  [11, 11, 3, 3, '#ffffff'],
  [18, 11, 3, 3, '#ffffff'],
  [12, 12, 2, 2, '#15151b'],
  [19, 12, 2, 2, '#15151b'],
  [15, 3, 2, 6, '#3d8a25'],
  [16, 3, 6, 2, '#5fb83a'],
  [10, 21, 4, 1, '#3d8a25'],
  [18, 21, 4, 1, '#3d8a25'],
];
function draw(gx, gy) {
  let c = [0, 0, 0, 0];
  for (const [x, y, w, h, col] of art) if (gx >= x && gx < x + w && gy >= y && gy < y + h) c = hex(col);
  return c;
}
mkdirSync('public/icons', { recursive: true });
const write = (name, size, inset = 0, round = 0.18) => {
  const buf = png(size, (u, v) => {
    // Rounded square mask for "any" icons; maskable icons fill the canvas.
    const r = round;
    const dx = Math.max(r - u, 0, u - (1 - r));
    const dy = Math.max(r - v, 0, v - (1 - r));
    if (round > 0 && dx * dx + dy * dy > r * r) return [0, 0, 0, 0];
    const s = 1 - inset * 2;
    const gu = (u - inset) / s;
    const gv = (v - inset) / s;
    if (gu < 0 || gu >= 1 || gv < 0 || gv >= 1) return hex('#3fa7d6');
    return draw(Math.floor(gu * 32), Math.floor(gv * 32));
  });
  writeFileSync(`public/icons/${name}`, buf);
};
write('icon-192.png', 192);
write('icon-512.png', 512);
write('maskable-512.png', 512, 0.1, 0);
write('apple-touch-icon.png', 180, 0, 0);
console.log('icons written');
