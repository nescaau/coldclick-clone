/**
 * Monta MP4 de teste com a ESTRUTURA de um arquivo de verdade (vídeo + áudio, `stts`/`ctts`/`stss`/`stsc`/`stsz`/`stco`,
 * `edts/elst`, mídia intercalada em chunks, `moov` depois do `mdat`), com amostras de bytes conhecidos — para provar que
 * a junção (mp4-concat.ts) preserva cada amostra. Não é reproduzível por um player (os dados não são H.264/AAC).
 */

const u8 = (...n: number[]) => Uint8Array.from(n);
const u16 = (v: number) => u8((v >>> 8) & 255, v & 255);
const u32 = (v: number) => u8((v >>> 24) & 255, (v >>> 16) & 255, (v >>> 8) & 255, v & 255);
const ascii = (s: string) => Uint8Array.from(s, (c) => c.charCodeAt(0));
const zeros = (n: number) => new Uint8Array(n);
const cat = (...parts: Uint8Array[]) => {
  const out = new Uint8Array(parts.reduce((n, p) => n + p.length, 0));
  let at = 0;
  for (const p of parts) {
    out.set(p, at);
    at += p.length;
  }
  return out;
};
const box = (type: string, ...parts: Uint8Array[]) => {
  const body = cat(...parts);
  return cat(u32(8 + body.length), ascii(type), body);
};
const tbl = (type: string, entries: number[][], version = 0) => box(type, u8(version, 0, 0, 0), u32(entries.length), ...entries.map((e) => cat(...e.map(u32))));

export interface ClipSpec {
  videoFrames: number;
  audioFrames: number;
  /** Muda o conteúdo das amostras (clipes diferentes têm bytes diferentes). */
  seed: number;
  width?: number;
  height?: number;
  /** Muda o `stsd` (codec/parâmetros diferentes). */
  codecSalt?: number;
  /** false = clipe só de vídeo. */
  audio?: boolean;
  /** Com `ctts` (B-frames) e `edts/elst` na faixa de vídeo (padrão: sim). */
  withCtts?: boolean;
  withEdit?: boolean;
  /** Escala de tempo do vídeo (padrão 12288, a do clipe real de referência). */
  videoTs?: number;
}

export interface BuiltClip {
  bytes: Uint8Array;
  video: Uint8Array[];
  audio: Uint8Array[];
  videoDelta: number;
  audioDelta: number;
}

const VIDEO_TS = 12288;
const VIDEO_DELTA = 512;
const AUDIO_TS = 44100;
const AUDIO_DELTA = 1024;

const sample = (track: number, seed: number, i: number, size: number) => Uint8Array.from({ length: size }, (_, j) => (track * 53 + seed * 31 + i * 7 + j) & 255);

export function buildClip(spec: ClipSpec): BuiltClip {
  const w = spec.width ?? 720;
  const h = spec.height ?? 1280;
  const audio = spec.audio !== false;
  const video = Array.from({ length: spec.videoFrames }, (_, i) => sample(1, spec.seed, i, 100 + ((i * 37) % 50)));
  const sounds = audio ? Array.from({ length: spec.audioFrames }, (_, i) => sample(2, spec.seed, i, 20 + ((i * 11) % 7))) : [];

  // mídia intercalada: 2 amostras de vídeo, 3 de áudio, e assim por diante
  const vChunks: number[] = [];
  const aChunks: number[] = [];
  const payload: Uint8Array[] = [];
  const order: ['v' | 'a', number][] = []; // (faixa, nº de amostras) na ordem do arquivo
  let vi = 0;
  let ai = 0;
  while (vi < video.length || ai < sounds.length) {
    if (vi < video.length) {
      const n = Math.min(2, video.length - vi);
      order.push(['v', n]);
      vChunks.push(n);
      payload.push(...video.slice(vi, vi + n));
      vi += n;
    }
    if (ai < sounds.length) {
      const n = Math.min(3, sounds.length - ai);
      order.push(['a', n]);
      aChunks.push(n);
      payload.push(...sounds.slice(ai, ai + n));
      ai += n;
    }
  }
  const mdatBody = cat(...payload);

  const ftyp = box('ftyp', ascii('isom'), u32(512), ascii('isom'), ascii('iso2'), ascii('avc1'), ascii('mp41'));
  const free = box('free');
  const mdatStart = ftyp.length + free.length + 8;

  // offsets absolutos dos chunks de cada faixa
  const vOff: number[] = [];
  const aOff: number[] = [];
  let at = mdatStart;
  let vs = 0;
  let as = 0;
  for (const [t, n] of order) {
    if (t === 'v') {
      vOff.push(at);
      for (let k = 0; k < n; k++) at += video[vs++].length;
    } else {
      aOff.push(at);
      for (let k = 0; k < n; k++) at += sounds[as++].length;
    }
  }

  const runs = (chunks: number[]) => chunks.reduce<number[][]>((r, spc, i) => (r.length && r[r.length - 1][1] === spc ? r : [...r, [i + 1, spc, 1]]), []);
  const entryFor = (kind: 'vide' | 'soun') =>
    kind === 'vide'
      ? box('stsd', u8(0, 0, 0, 0), u32(1), box('avc1', zeros(6), u16(1), zeros(16), u16(w), u16(h), zeros(50), box('avcC', u8(1, 0x64, 0, 0x1f, spec.codecSalt ?? 0))))
      : box('stsd', u8(0, 0, 0, 0), u32(1), box('mp4a', zeros(6), u16(1), zeros(8), u16(2), u16(16), zeros(4), u32(AUDIO_TS * 65536), box('esds', u8(0, 0, 0, 0, spec.codecSalt ?? 0))));

  const tkhd = (id: number, dur: number, kind: 'vide' | 'soun') =>
    box('tkhd', u8(0, 0, 0, 3), u32(0), u32(0), u32(id), u32(0), u32(dur), zeros(8), u16(0), u16(0), u16(kind === 'soun' ? 0x0100 : 0), u16(0), zeros(36), u32(kind === 'vide' ? w * 65536 : 0), u32(kind === 'vide' ? h * 65536 : 0));
  const mdhd = (ts: number, dur: number) => box('mdhd', u8(0, 0, 0, 0), u32(0), u32(0), u32(ts), u32(dur), u16(0x55c4), u16(0));
  const hdlr = (kind: 'vide' | 'soun') => box('hdlr', u8(0, 0, 0, 0), u32(0), ascii(kind), zeros(12), ascii('Handler\0'));
  const dinf = box('dinf', box('dref', u8(0, 0, 0, 0), u32(1), box('url ', u8(0, 0, 0, 1))));
  const movieTs = 1000;

  const vTs = spec.videoTs ?? VIDEO_TS;
  const vDur = spec.videoFrames * VIDEO_DELTA;
  const aDur = spec.audioFrames * AUDIO_DELTA;
  const vMovie = Math.round((vDur * movieTs) / vTs);
  const aMovie = Math.round((aDur * movieTs) / AUDIO_TS);

  const vStbl = box(
    'stbl',
    entryFor('vide'),
    tbl('stts', [[spec.videoFrames, VIDEO_DELTA]]),
    ...(spec.withCtts !== false ? [tbl('ctts', spec.videoFrames > 1 ? [[1, 1024], [spec.videoFrames - 1, 512]] : [[1, 1024]])] : []),
    tbl('stss', Array.from({ length: Math.ceil(spec.videoFrames / 12) }, (_, i) => [i * 12 + 1])),
    tbl('stsc', runs(vChunks)),
    box('stsz', u8(0, 0, 0, 0), u32(0), u32(video.length), ...video.map((s) => u32(s.length))),
    tbl('stco', vOff.map((o) => [o])),
  );
  const aStbl = box(
    'stbl',
    entryFor('soun'),
    tbl('stts', [[spec.audioFrames, AUDIO_DELTA]]),
    tbl('stsc', runs(aChunks)),
    box('stsz', u8(0, 0, 0, 0), u32(0), u32(sounds.length), ...sounds.map((s) => u32(s.length))),
    tbl('stco', aOff.map((o) => [o])),
    box('sgpd', u8(1, 0, 0, 0), ascii('roll'), u32(1)), // grupo de amostras: a junção o descarta
  );
  const edts = (mediaTime: number, movieDur: number) => box('edts', box('elst', u8(0, 0, 0, 0), u32(1), u32(movieDur), u32(mediaTime), u32(0x00010000)));

  const vTrak = box('trak', tkhd(1, vMovie, 'vide'), ...(spec.withEdit !== false ? [edts(1024, vMovie)] : []), box('mdia', mdhd(vTs, vDur), hdlr('vide'), box('minf', box('vmhd', u8(0, 0, 0, 1), zeros(8)), dinf, vStbl)));
  const aTrak = box('trak', tkhd(2, aMovie, 'soun'), ...(spec.withEdit !== false ? [edts(1024, aMovie)] : []), box('mdia', mdhd(AUDIO_TS, aDur), hdlr('soun'), box('minf', box('smhd', u8(0, 0, 0, 0), zeros(4)), dinf, aStbl)));
  const mvhd = box('mvhd', u8(0, 0, 0, 0), u32(0), u32(0), u32(movieTs), u32(Math.max(vMovie, aMovie)), u32(0x00010000), u16(0x0100), zeros(10), u32(0x00010000), zeros(12), u32(0x00010000), zeros(12), u32(0x40000000), zeros(24), u32(audio ? 3 : 2));
  const moov = box('moov', mvhd, vTrak, ...(audio ? [aTrak] : []), box('udta', box('meta', u8(0, 0, 0, 0), ascii('xxxx'))));

  return { bytes: cat(ftyp, free, box('mdat', mdatBody), moov), video, audio: sounds, videoDelta: VIDEO_DELTA, audioDelta: AUDIO_DELTA };
}
