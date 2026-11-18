import fs from 'node:fs';
import path from 'node:path';
import zlib from 'node:zlib';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const root = path.resolve(__dirname, '..');
const outDir = path.join(root, 'public', 'icons');
fs.mkdirSync(outDir, { recursive: true });

const CRC_TABLE = new Uint32Array(256);
for (let n = 0; n < 256; n++) {
  let c = n;
  for (let k = 0; k < 8; k++) {
    c = (c & 1) ? (0xedb88320 ^ (c >>> 1)) : (c >>> 1);
  }
  CRC_TABLE[n] = c >>> 0;
}

function crc32(buf) {
  let c = 0xffffffff;
  for (let i = 0; i < buf.length; i++) {
    c = CRC_TABLE[(c ^ buf[i]) & 0xff] ^ (c >>> 8);
  }
  return (c ^ 0xffffffff) >>> 0;
}

function chunk(type, data) {
  const typeBuf = Buffer.from(type, 'ascii');
  const lenBuf = Buffer.alloc(4);
  lenBuf.writeUInt32BE(data.length, 0);
  const body = Buffer.concat([typeBuf, data]);
  const crcBuf = Buffer.alloc(4);
  crcBuf.writeUInt32BE(crc32(body), 0);
  return Buffer.concat([lenBuf, body, crcBuf]);
}

function encodePng(width, height, rgba) {
  const raw = Buffer.alloc(height * (width * 4 + 1));
  for (let y = 0; y < height; y++) {
    const rowOff = y * (width * 4 + 1);
    raw[rowOff] = 0;
    rgba.copy(raw, rowOff + 1, y * width * 4, (y + 1) * width * 4);
  }
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(width, 0);
  ihdr.writeUInt32BE(height, 4);
  ihdr[8] = 8; // bit depth
  ihdr[9] = 6; // RGBA
  ihdr[10] = 0;
  ihdr[11] = 0;
  ihdr[12] = 0;

  const compressed = zlib.deflateSync(raw, { level: 9 });
  return Buffer.concat([
    Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]),
    chunk('IHDR', ihdr),
    chunk('IDAT', compressed),
    chunk('IEND', Buffer.alloc(0))
  ]);
}

function distToSegment(px, py, x1, y1, x2, y2) {
  const dx = x2 - x1;
  const dy = y2 - y1;
  const lenSq = dx * dx + dy * dy;
  if (lenSq === 0) return Math.hypot(px - x1, py - y1);
  let t = ((px - x1) * dx + (py - y1) * dy) / lenSq;
  t = Math.max(0, Math.min(1, t));
  return Math.hypot(px - (x1 + t * dx), py - (y1 + t * dy));
}

function renderIconPng(size, { maskable = false } = {}) {
  const rgba = Buffer.alloc(size * size * 4);
  const bg = [10, 10, 12];
  const gold = [197, 160, 89];
  const scale = maskable ? 0.68 : 0.84;
  const cx = size / 2;
  const cy = size / 2;
  const ringCy = cy - size * 0.03 * scale;
  const R = size * 0.27 * scale;
  const stroke = Math.max(1.5, size * 0.014 * scale);

  const tri = [];
  for (let i = 0; i < 3; i++) {
    const a = -Math.PI / 2 + i * ((2 * Math.PI) / 3);
    tri.push([cx + Math.cos(a) * R * 0.92, ringCy + Math.sin(a) * R * 0.92]);
  }

  const boxMargin = size * (maskable ? 0.2 : 0.14);
  const xMin = boxMargin;
  const xMax = size - boxMargin;

  for (let y = 0; y < size; y++) {
    for (let x = 0; x < size; x++) {
      const idx = (y * size + x) * 4;
      const dRing = Math.abs(Math.hypot(x - cx, y - ringCy) - R);
      const dTri = Math.min(
        distToSegment(x, y, tri[0][0], tri[0][1], tri[1][0], tri[1][1]),
        distToSegment(x, y, tri[1][0], tri[1][1], tri[2][0], tri[2][1]),
        distToSegment(x, y, tri[2][0], tri[2][1], tri[0][0], tri[0][1])
      );
      const dCenterDot = Math.hypot(x - cx, y - ringCy) - size * 0.022 * scale;

      let dBox = Infinity;
      if (!maskable && x >= xMin - stroke && x <= xMax + stroke && y >= xMin - stroke && y <= xMax + stroke) {
        const dx = Math.min(Math.abs(x - xMin), Math.abs(x - xMax));
        const dy = Math.min(Math.abs(y - xMin), Math.abs(y - xMax));
        dBox = Math.min(dx, dy);
      }

      let alpha = 0;
      const aa = 1.25;
      const aRing = Math.max(0, Math.min(1, (stroke * 0.65 - dRing) / aa + 0.5));
      const aTri = Math.max(0, Math.min(1, (stroke * 0.58 - dTri) / aa + 0.5));
      const aDot = Math.max(0, Math.min(1, (0 - dCenterDot) / aa + 0.5));
      const aBox = Math.max(0, Math.min(0.45, (stroke * 0.42 - dBox) / aa + 0.25));
      alpha = Math.max(aRing, aTri, aDot, aBox);

      rgba[idx] = Math.round(bg[0] * (1 - alpha) + gold[0] * alpha);
      rgba[idx + 1] = Math.round(bg[1] * (1 - alpha) + gold[1] * alpha);
      rgba[idx + 2] = Math.round(bg[2] * (1 - alpha) + gold[2] * alpha);
      rgba[idx + 3] = 255;
    }
  }
  return encodePng(size, size, rgba);
}

const iconSvg = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 512 512">
  <rect width="512" height="512" fill="#0a0a0c"/>
  <g fill="none" stroke="#c5a059" stroke-width="6" stroke-linecap="round" stroke-linejoin="round">
    <rect x="72" y="72" width="368" height="368" stroke-opacity=".42"/>
    <circle cx="256" cy="242" r="118"/>
    <path d="M256 124 L358 302 L154 302 Z"/>
    <circle cx="256" cy="242" r="9" fill="#c5a059" stroke="none"/>
  </g>
</svg>`;

fs.writeFileSync(path.join(outDir, 'icon.svg'), iconSvg, 'utf8');
fs.writeFileSync(path.join(outDir, 'pwa-192x192.png'), renderIconPng(192));
fs.writeFileSync(path.join(outDir, 'pwa-512x512.png'), renderIconPng(512));
fs.writeFileSync(path.join(outDir, 'pwa-maskable-512x512.png'), renderIconPng(512, { maskable: true }));
fs.writeFileSync(path.join(outDir, 'apple-touch-icon.png'), renderIconPng(180));

console.log('Generated PWA icons in public/icons/');
