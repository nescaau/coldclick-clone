/** Monta MP4 sintético MÍNIMO (ftyp + moov com mvhd/tkhd/hdlr + mdat) para testes. Não é reproduzível: só tem as caixas lidas pelo parser. */

const u32 = (v: number) => [(v >>> 24) & 255, (v >>> 16) & 255, (v >>> 8) & 255, v & 255];
const ascii = (s: string) => Array.from(s).map((c) => c.charCodeAt(0));
const zeros = (n: number) => new Array<number>(n).fill(0);

export function box(type: string, ...parts: (number[] | Uint8Array)[]): number[] {
  const body = parts.flatMap((p) => Array.from(p));
  return [...u32(8 + body.length), ...ascii(type), ...body];
}

const mvhd = (timescale: number, duration: number, version = 0) =>
  version === 1
    ? box('mvhd', [1, 0, 0, 0], zeros(16), u32(timescale), u32(0), u32(duration), zeros(80))
    : box('mvhd', [0, 0, 0, 0], u32(0), u32(0), u32(timescale), u32(duration), zeros(80));

const trak = (handler: 'vide' | 'soun', w: number, h: number) =>
  box(
    'trak',
    box('tkhd', [0, 0, 0, 0], zeros(72 - 0), u32(w * 65536), u32(h * 65536)),
    box('mdia', box('hdlr', [0, 0, 0, 0], u32(0), ascii(handler), zeros(13))),
  );

export interface FixtureOpts {
  durationS?: number;
  width?: number;
  height?: number;
  audio?: boolean;
  /** mvhd versão 1 (duração em 64 bits). */
  v1?: boolean;
  /** moov depois do mdat (arquivo "sem faststart"). */
  moovLast?: boolean;
  /** Preenchimento extra em bytes (muda o hash). */
  salt?: number;
}

export function buildMp4(o: FixtureOpts = {}): Uint8Array {
  const timescale = 1000;
  const duration = Math.round((o.durationS ?? 32) * timescale);
  const moov = box('moov', mvhd(timescale, duration, o.v1 ? 1 : 0), trak('vide', o.width ?? 1080, o.height ?? 1920), ...(o.audio === false ? [] : [trak('soun', 0, 0)]));
  const ftyp = box('ftyp', ascii('isom'), u32(512), ascii('isom'), ascii('mp41'));
  const mdat = box('mdat', zeros(16), u32(o.salt ?? 0));
  return Uint8Array.from(o.moovLast ? [...ftyp, ...mdat, ...moov] : [...ftyp, ...moov, ...mdat]);
}
