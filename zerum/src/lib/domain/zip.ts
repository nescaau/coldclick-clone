/**
 * ZIP "stored" (sem compressão) em streaming, sem dependências: usado em "⬇ Baixar todos (zip)" (avatares) e
 * "Baixar todos os prontos" (lote). MP4/JPG já são comprimidos — armazenar é o certo e mantém a memória baixa:
 * cada arquivo passa por pedaços (o CRC é calculado no caminho e vai num "data descriptor" depois dos dados).
 */

const TABLE = (() => {
  const t = new Uint32Array(256);
  for (let n = 0; n < 256; n++) {
    let c = n;
    for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    t[n] = c >>> 0;
  }
  return t;
})();

/** CRC-32 incremental: `crc32(b, crc32(a))` = `crc32(a+b)`. */
export function crc32(buf: Uint8Array, prev = 0): number {
  let c = ~prev >>> 0;
  for (let i = 0; i < buf.length; i++) c = TABLE[(c ^ buf[i]) & 0xff] ^ (c >>> 8);
  return ~c >>> 0;
}

export interface ZipEntry {
  name: string;
  /** Bytes inteiros ou uma fábrica de pedaços (ex.: `fs.createReadStream`). */
  data: Uint8Array | (() => AsyncIterable<Uint8Array>);
}

/** Nome seguro dentro do zip: sem caminho, sem controle, nunca vazio. */
export function safeZipName(raw: string, fallback: string): string {
  // eslint-disable-next-line no-control-regex
  const base = (String(raw ?? '').split(/[\\/]/).pop() ?? '').replace(/[\u0000-\u001f\u007f]/g, '').replace(/^\.+/, '').trim();
  return (base || fallback).slice(0, 180);
}

/** Torna os nomes únicos ("a.jpg", "a (2).jpg"…): dois avatares com o mesmo nome não se sobrescrevem. */
export function uniqueNames(names: string[]): string[] {
  const seen = new Map<string, number>();
  return names.map((n) => {
    const k = n.toLowerCase();
    const c = (seen.get(k) ?? 0) + 1;
    seen.set(k, c);
    if (c === 1) return n;
    const dot = n.lastIndexOf('.');
    return dot > 0 ? `${n.slice(0, dot)} (${c})${n.slice(dot)}` : `${n} (${c})`;
  });
}

function dosDateTime(d: Date): { time: number; date: number } {
  const y = Math.max(1980, d.getFullYear());
  return {
    time: (d.getHours() << 11) | (d.getMinutes() << 5) | (d.getSeconds() >> 1),
    date: ((y - 1980) << 9) | ((d.getMonth() + 1) << 5) | d.getDate(),
  };
}

const u16 = (v: number) => new Uint8Array([v & 0xff, (v >>> 8) & 0xff]);
const u32 = (v: number) => new Uint8Array([v & 0xff, (v >>> 8) & 0xff, (v >>> 16) & 0xff, (v >>> 24) & 0xff]);
const cat = (...parts: Uint8Array[]): Uint8Array => {
  const out = new Uint8Array(parts.reduce((n, p) => n + p.length, 0));
  let o = 0;
  for (const p of parts) {
    out.set(p, o);
    o += p.length;
  }
  return out;
};

const MAX32 = 0xffffffff;

export async function* zipChunks(entries: ZipEntry[], now = new Date()): AsyncGenerator<Uint8Array> {
  const enc = new TextEncoder();
  const { time, date } = dosDateTime(now);
  const central: Uint8Array[] = [];
  let offset = 0;

  for (const e of entries) {
    const name = enc.encode(e.name);
    const flags = 0x0808; // bit 3: tamanhos/CRC no descriptor · bit 11: nome em UTF-8
    const header = cat(u32(0x04034b50), u16(20), u16(flags), u16(0), u16(time), u16(date), u32(0), u32(0), u32(0), u16(name.length), u16(0), name);
    yield header;
    const localOffset = offset;
    offset += header.length;

    let crc = 0;
    let size = 0;
    const feed = async function* (): AsyncGenerator<Uint8Array> {
      if (e.data instanceof Uint8Array) yield e.data;
      else for await (const chunk of e.data()) yield chunk;
    };
    for await (const chunk of feed()) {
      crc = crc32(chunk, crc);
      size += chunk.length;
      offset += chunk.length;
      yield chunk;
    }
    if (size > MAX32 || offset > MAX32) throw new Error('Arquivo grande demais para zip simples (4 GB).');
    const desc = cat(u32(0x08074b50), u32(crc), u32(size), u32(size));
    yield desc;
    offset += desc.length;

    central.push(cat(u32(0x02014b50), u16(20), u16(20), u16(flags), u16(0), u16(time), u16(date), u32(crc), u32(size), u32(size), u16(name.length), u16(0), u16(0), u16(0), u16(0), u32(0), u32(localOffset), name));
  }

  const cdStart = offset;
  let cdSize = 0;
  for (const c of central) {
    yield c;
    cdSize += c.length;
  }
  yield cat(u32(0x06054b50), u16(0), u16(0), u16(central.length), u16(central.length), u32(cdSize), u32(cdStart), u16(0));
}

/** Zip inteiro em memória (só para conjuntos pequenos e testes). */
export async function zipToBuffer(entries: ZipEntry[], now?: Date): Promise<Uint8Array> {
  const parts: Uint8Array[] = [];
  for await (const c of zipChunks(entries, now)) parts.push(c);
  return cat(...parts);
}
