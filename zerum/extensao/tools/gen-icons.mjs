/**
 * Gera os ícones da extensão (PNG RGBA, sem dependências): um "Z" branco num quadrado escuro arredondado.
 * Arte própria (não é o ícone da extensão original). Uso: node extensao/tools/gen-icons.mjs
 */
import fs from 'node:fs';
import path from 'node:path';
import zlib from 'node:zlib';
import { fileURLToPath } from 'node:url';

const SIZES = [16, 32, 48, 128];
const out = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', 'icons');

const crcTable = new Uint32Array(256).map((_, n) => {
  let c = n;
  for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
  return c >>> 0;
});
const crc32 = (buf) => {
  let c = 0xffffffff;
  for (const b of buf) c = crcTable[(c ^ b) & 255] ^ (c >>> 8);
  return (c ^ 0xffffffff) >>> 0;
};
const chunk = (type, data) => {
  const body = Buffer.concat([Buffer.from(type), data]);
  const len = Buffer.alloc(4);
  len.writeUInt32BE(data.length);
  const crc = Buffer.alloc(4);
  crc.writeUInt32BE(crc32(body));
  return Buffer.concat([len, body, crc]);
};

/** Distância de um ponto a um segmento (para a diagonal do Z). */
const distSeg = (px, py, ax, ay, bx, by) => {
  const dx = bx - ax;
  const dy = by - ay;
  const t = Math.max(0, Math.min(1, ((px - ax) * dx + (py - ay) * dy) / (dx * dx + dy * dy)));
  return Math.hypot(px - (ax + t * dx), py - (ay + t * dy));
};

/** Cor RGBA de um ponto (x,y em 0..1). */
function shade(x, y) {
  const r = 0.2; // raio dos cantos
  const cx = Math.min(Math.max(x, r), 1 - r);
  const cy = Math.min(Math.max(y, r), 1 - r);
  if (Math.hypot(x - cx, y - cy) > r) return [0, 0, 0, 0]; // fora do quadrado arredondado
  const inBar = (y0, y1) => x >= 0.24 && x <= 0.76 && y >= y0 && y <= y1;
  const z = inBar(0.25, 0.35) || inBar(0.65, 0.75) || distSeg(x, y, 0.73, 0.31, 0.27, 0.69) <= 0.055;
  if (z) return [255, 255, 255, 255];
  const edge = Math.hypot(x - cx, y - cy) > r - 0.03 || x < 0.03 || y < 0.03 || x > 0.97 || y > 0.97;
  return edge ? [63, 63, 70, 255] : [14, 14, 17, 255];
}

function png(size) {
  const SS = 3; // supersampling 3×3
  const rows = [];
  for (let py = 0; py < size; py++) {
    const row = Buffer.alloc(1 + size * 4);
    for (let px = 0; px < size; px++) {
      const acc = [0, 0, 0, 0];
      for (let sy = 0; sy < SS; sy++) {
        for (let sx = 0; sx < SS; sx++) {
          const [r, g, b, a] = shade((px + (sx + 0.5) / SS) / size, (py + (sy + 0.5) / SS) / size);
          acc[0] += r * a;
          acc[1] += g * a;
          acc[2] += b * a;
          acc[3] += a;
        }
      }
      const n = SS * SS;
      const a = acc[3] / n;
      row.set(a ? [acc[0] / acc[3], acc[1] / acc[3], acc[2] / acc[3], a].map((v) => Math.round(v)) : [0, 0, 0, 0], 1 + px * 4);
    }
    rows.push(row);
  }
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(size, 0);
  ihdr.writeUInt32BE(size, 4);
  ihdr.set([8, 6, 0, 0, 0], 8); // 8 bits, RGBA
  return Buffer.concat([Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]), chunk('IHDR', ihdr), chunk('IDAT', zlib.deflateSync(Buffer.concat(rows), { level: 9 })), chunk('IEND', Buffer.alloc(0))]);
}

fs.mkdirSync(out, { recursive: true });
for (const s of SIZES) {
  fs.writeFileSync(path.join(out, `icon-${s}.png`), png(s));
  console.log(`icons/icon-${s}.png`);
}
