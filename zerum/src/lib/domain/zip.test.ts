import zlib from 'node:zlib';
import { describe, expect, it } from 'vitest';
import { crc32, safeZipName, uniqueNames, zipToBuffer } from './zip';

/** Leitor mínimo de zip "stored": confere central directory, CRC e conteúdo (sem libs). */
function readZip(buf: Uint8Array): { name: string; data: Uint8Array; crc: number }[] {
  const dv = new DataView(buf.buffer, buf.byteOffset, buf.byteLength);
  const eocd = buf.length - 22;
  expect(dv.getUint32(eocd, true)).toBe(0x06054b50);
  const count = dv.getUint16(eocd + 10, true);
  let p = dv.getUint32(eocd + 16, true);
  const out: { name: string; data: Uint8Array; crc: number }[] = [];
  for (let i = 0; i < count; i++) {
    expect(dv.getUint32(p, true)).toBe(0x02014b50);
    const crc = dv.getUint32(p + 16, true);
    const size = dv.getUint32(p + 24, true);
    const nameLen = dv.getUint16(p + 28, true);
    const off = dv.getUint32(p + 42, true);
    const name = new TextDecoder().decode(buf.subarray(p + 46, p + 46 + nameLen));
    const lhNameLen = dv.getUint16(off + 26, true);
    const start = off + 30 + lhNameLen;
    out.push({ name, data: buf.subarray(start, start + size), crc });
    p += 46 + nameLen;
  }
  return out;
}

describe('zip (stored, streaming)', () => {
  it('crc32 bate com o do zlib e é incremental', () => {
    const a = new TextEncoder().encode('Zerum 001 ');
    const b = new TextEncoder().encode('avatares');
    const whole = new TextEncoder().encode('Zerum 001 avatares');
    expect(crc32(whole)).toBe(zlib.crc32(whole));
    expect(crc32(b, crc32(a))).toBe(crc32(whole));
  });

  it('gera um zip legível: nomes, conteúdo e CRC corretos (bytes e fábrica de pedaços)', async () => {
    const png = Uint8Array.from([0x89, 0x50, 0x4e, 0x47, 1, 2, 3]);
    const zip = await zipToBuffer([
      { name: 'Ana.png', data: png },
      {
        name: 'avatares.json',
        data: async function* () {
          yield new TextEncoder().encode('[{"nome":');
          yield new TextEncoder().encode('"Ana"}]');
        },
      },
      { name: 'vazio.txt', data: new Uint8Array(0) },
    ]);
    const files = readZip(zip);
    expect(files.map((f) => f.name)).toEqual(['Ana.png', 'avatares.json', 'vazio.txt']);
    expect(files[0].data).toEqual(png);
    expect(new TextDecoder().decode(files[1].data)).toBe('[{"nome":"Ana"}]');
    expect(files[1].crc).toBe(zlib.crc32(files[1].data));
    expect(files[2].data.length).toBe(0);
  });

  it('nomes seguros e únicos (sem caminho, sem controle; duplicados ganham "(2)")', () => {
    expect(safeZipName('../../etc/passwd', 'x')).toBe('passwd');
    expect(safeZipName('..', 'fallback.mp4')).toBe('fallback.mp4');
    expect(safeZipName('a\u0000b.jpg', 'x')).toBe('ab.jpg');
    expect(uniqueNames(['a.jpg', 'A.jpg', 'b.jpg', 'a.jpg'])).toEqual(['a.jpg', 'A (2).jpg', 'b.jpg', 'a (3).jpg']);
  });
});
