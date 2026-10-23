// Rasterizes icons/icon.svg's shapes into PNGs (no dependencies). Run: node tools/make-icons.mjs
import { writeFileSync } from 'node:fs';
import { deflateSync } from 'node:zlib';

const hex = (h) => [1, 3, 5].map((i) => parseInt(h.slice(i, i + 2), 16));
const BG = hex('#0f766e');
const SW = 11; // half stroke width in 512-space

function ellipseDist(x, y, cx, cy, rx, ry, deg) {
  const a = (-deg * Math.PI) / 180;
  const dx = x - cx;
  const dy = y - cy;
  const u = dx * Math.cos(a) - dy * Math.sin(a);
  const v = dx * Math.sin(a) + dy * Math.cos(a);
  const f = (u * u) / (rx * rx) + (v * v) / (ry * ry) - 1;
  const g = 2 * Math.hypot(u / (rx * rx), v / (ry * ry));
  return Math.abs(f / g);
}

function segDist(x, y, x1, y1, x2, y2) {
  const dx = x2 - x1;
  const dy = y2 - y1;
  const t = Math.max(0, Math.min(1, ((x - x1) * dx + (y - y1) * dy) / (dx * dx + dy * dy)));
  return Math.hypot(x - (x1 + t * dx), y - (y1 + t * dy));
}

const shapes = [
  { c: hex('#ffffff'), hit: (x, y) => ellipseDist(x, y, 200, 200, 92, 110, -35) < SW },
  { c: hex('#ffffff'), hit: (x, y) => segDist(x, y, 262, 290, 330, 380) < SW },
  { c: hex('#99f6e4'), hit: (x, y) => ellipseDist(x, y, 312, 200, 92, 110, 35) < SW },
  { c: hex('#99f6e4'), hit: (x, y) => segDist(x, y, 250, 290, 182, 380) < SW },
  { c: hex('#fde047'), hit: (x, y) => Math.hypot(x - 256, y - 410) < 30 },
];

function render(size) {
  const ss = 4;
  const k = 512 / size;
  const raw = Buffer.alloc(size * (size * 3 + 1));
  for (let py = 0; py < size; py++) {
    raw[py * (size * 3 + 1)] = 0;
    for (let px = 0; px < size; px++) {
      const acc = [0, 0, 0];
      for (let sy = 0; sy < ss; sy++)
        for (let sx = 0; sx < ss; sx++) {
          const x = (px + (sx + 0.5) / ss) * k;
          const y = (py + (sy + 0.5) / ss) * k;
          let c = BG;
          for (const s of shapes) if (s.hit(x, y)) c = s.c;
          acc[0] += c[0];
          acc[1] += c[1];
          acc[2] += c[2];
        }
      const o = py * (size * 3 + 1) + 1 + px * 3;
      for (let i = 0; i < 3; i++) raw[o + i] = Math.round(acc[i] / (ss * ss));
    }
  }
  return png(size, size, raw);
}

function crc32(buf) {
  let c = ~0;
  for (const b of buf) {
    c ^= b;
    for (let i = 0; i < 8; i++) c = (c >>> 1) ^ (0xedb88320 & -(c & 1));
  }
  return ~c >>> 0;
}

function chunk(type, data) {
  const len = Buffer.alloc(4);
  len.writeUInt32BE(data.length);
  const td = Buffer.concat([Buffer.from(type), data]);
  const crc = Buffer.alloc(4);
  crc.writeUInt32BE(crc32(td));
  return Buffer.concat([len, td, crc]);
}

function png(w, h, raw) {
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(w, 0);
  ihdr.writeUInt32BE(h, 4);
  ihdr[8] = 8;
  ihdr[9] = 2;
  return Buffer.concat([
    Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    chunk('IHDR', ihdr),
    chunk('IDAT', deflateSync(raw)),
    chunk('IEND', Buffer.alloc(0)),
  ]);
}

for (const size of [192, 512])
  writeFileSync(new URL(`../icons/icon-${size}.png`, import.meta.url), render(size));
