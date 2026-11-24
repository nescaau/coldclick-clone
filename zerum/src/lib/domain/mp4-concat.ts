/**
 * Junta clipes MP4 numa única arquivo SEM recodificar (remux): é como as cenas de 8 s geradas no Flow viram o vídeo final.
 *
 * Funciona quando os clipes têm o MESMO layout — mesma quantidade de faixas, mesmo codec/parâmetros (`stsd` idêntico) e
 * mesma escala de tempo —, o que é o caso de clipes do mesmo modelo do Flow. Do contrário recusa com um motivo claro
 * (nunca produz um arquivo "meio certo").
 *
 * Como: lê as tabelas de amostras de cada faixa (stts/ctts/stss/stsz/stsc/stco), copia os dados de mídia clipe a clipe
 * (mantendo a intercalação áudio/vídeo original) e reescreve as tabelas já somadas, com o `moov` ANTES do `mdat`
 * (pronto para tocar sem baixar tudo). Fica de fora o que não é essencial para tocar: grupos de amostras (sgpd/sbgp),
 * metadados (udta) e a lista de edição dos clipes seguintes (vale a do primeiro, que traz o atraso inicial correto).
 */

export class Mp4ConcatError extends Error {
  constructor(
    readonly code: 'VAZIO' | 'SEM_MOOV' | 'FRAGMENTADO' | 'FAIXAS_DIFERENTES' | 'CODEC_DIFERENTE' | 'TABELAS_AUSENTES' | 'CORROMPIDO',
    message: string,
  ) {
    super(message);
    this.name = 'Mp4ConcatError';
  }
}

interface Box {
  type: string;
  start: number;
  /** Início do corpo (depois do cabeçalho de 8 ou 16 bytes). */
  body: number;
  end: number;
}

const cc = (b: Uint8Array, o: number) => String.fromCharCode(b[o], b[o + 1], b[o + 2], b[o + 3]);

/**
 * Cópia REAL de um trecho (um `Uint8Array` novo, dono do próprio ArrayBuffer). Não usa `.slice()`: no `Buffer` do Node
 * (o que `fs.readFileSync` devolve) `slice` é só uma janela sobre a mesma memória — e mexer nela corromperia o arquivo de entrada.
 */
const copy = (b: Uint8Array, start: number, end: number): Uint8Array => {
  const out = new Uint8Array(end - start);
  out.set(b.subarray(start, end));
  return out;
};

function children(b: Uint8Array, dv: DataView, from: number, to: number): Box[] {
  const out: Box[] = [];
  let o = from;
  while (o + 8 <= to) {
    let size = dv.getUint32(o);
    let hdr = 8;
    if (size === 1) {
      if (o + 16 > to) break;
      size = dv.getUint32(o + 8) * 2 ** 32 + dv.getUint32(o + 12);
      hdr = 16;
    } else if (size === 0) size = to - o;
    if (size < hdr || o + size > to) throw new Mp4ConcatError('CORROMPIDO', 'caixa do MP4 truncada ou corrompida');
    out.push({ type: cc(b, o + 4), start: o, body: o + hdr, end: o + size });
    o += size;
  }
  return out;
}

const pick = (list: Box[], type: string): Box | undefined => list.find((x) => x.type === type);

// ─── leitura de uma faixa ────────────────────────────────────────────────────────────────────────────────────────────

interface Track {
  id: number;
  handler: string;
  width: number;
  height: number;
  mediaTs: number;
  tkhd: Uint8Array;
  mdhd: Uint8Array;
  hdlr: Uint8Array;
  /** Caixas de `minf` que não são `stbl` (vmhd/smhd/dinf…), cruas. */
  minfExtras: Uint8Array[];
  stsd: Uint8Array;
  edit: { mediaTime: number } | null;
  sizes: number[];
  /** [count, delta] */
  stts: [number, number][];
  /** [count, offset] */
  ctts: { version: number; runs: [number, number][] } | null;
  /** números de amostra (base 1) */
  stss: number[] | null;
  /** por chunk: nº de amostras e offset absoluto no arquivo de origem */
  chunkSamples: number[];
  chunkOffsets: number[];
}

interface Clip {
  bytes: Uint8Array;
  ftyp: Uint8Array;
  mvhd: Uint8Array;
  movieTs: number;
  tracks: Track[];
}

function parseTrack(b: Uint8Array, dv: DataView, trak: Box): Track {
  const k = children(b, dv, trak.body, trak.end);
  const tkhd = pick(k, 'tkhd');
  const mdia = pick(k, 'mdia');
  if (!tkhd || !mdia) throw new Mp4ConcatError('TABELAS_AUSENTES', 'faixa sem tkhd/mdia');
  const m = children(b, dv, mdia.body, mdia.end);
  const mdhd = pick(m, 'mdhd');
  const hdlr = pick(m, 'hdlr');
  const minf = pick(m, 'minf');
  if (!mdhd || !hdlr || !minf) throw new Mp4ConcatError('TABELAS_AUSENTES', 'faixa sem mdhd/hdlr/minf');
  const mi = children(b, dv, minf.body, minf.end);
  const stbl = pick(mi, 'stbl');
  if (!stbl) throw new Mp4ConcatError('TABELAS_AUSENTES', 'faixa sem tabela de amostras');
  const s = children(b, dv, stbl.body, stbl.end);
  const need = (t: string) => {
    const x = pick(s, t);
    if (!x) throw new Mp4ConcatError('TABELAS_AUSENTES', `faixa sem ${t}`);
    return x;
  };
  const stsd = need('stsd');
  const stts = need('stts');
  const stsc = need('stsc');
  const stsz = pick(s, 'stsz') ?? need('stz2');
  const stco = pick(s, 'stco') ?? pick(s, 'co64');
  if (!stco) throw new Mp4ConcatError('TABELAS_AUSENTES', 'faixa sem stco/co64');
  if (stsz.type === 'stz2') throw new Mp4ConcatError('TABELAS_AUSENTES', 'stz2 (tamanhos compactos) não é suportado');

  const tv = b[tkhd.body];
  const mv = b[mdhd.body];
  const sizeCount = dv.getUint32(stsz.body + 8);
  const fixed = dv.getUint32(stsz.body + 4);
  const sizes = Array.from({ length: sizeCount }, (_, i) => (fixed ? fixed : dv.getUint32(stsz.body + 12 + i * 4)));

  const sttsRuns: [number, number][] = [];
  for (let i = 0, n = dv.getUint32(stts.body + 4); i < n; i++) sttsRuns.push([dv.getUint32(stts.body + 8 + i * 8), dv.getUint32(stts.body + 12 + i * 8)]);

  const cttsBox = pick(s, 'ctts');
  const ctts = cttsBox
    ? {
        version: b[cttsBox.body],
        runs: Array.from({ length: dv.getUint32(cttsBox.body + 4) }, (_, i): [number, number] => [dv.getUint32(cttsBox.body + 8 + i * 8), b[cttsBox.body] === 1 ? dv.getInt32(cttsBox.body + 12 + i * 8) : dv.getUint32(cttsBox.body + 12 + i * 8)]),
      }
    : null;

  const stssBox = pick(s, 'stss');
  const stss = stssBox ? Array.from({ length: dv.getUint32(stssBox.body + 4) }, (_, i) => dv.getUint32(stssBox.body + 8 + i * 4)) : null;

  const chunkCount = dv.getUint32(stco.body + 4);
  const chunkOffsets = Array.from({ length: chunkCount }, (_, i) => (stco.type === 'co64' ? dv.getUint32(stco.body + 8 + i * 8) * 2 ** 32 + dv.getUint32(stco.body + 12 + i * 8) : dv.getUint32(stco.body + 8 + i * 4)));
  const runs: [number, number, number][] = [];
  for (let i = 0, n = dv.getUint32(stsc.body + 4); i < n; i++) runs.push([dv.getUint32(stsc.body + 8 + i * 12), dv.getUint32(stsc.body + 12 + i * 12), dv.getUint32(stsc.body + 16 + i * 12)]);
  const chunkSamples = new Array<number>(chunkCount).fill(0);
  runs.forEach(([first, spc, sdi], i) => {
    if (sdi !== 1) throw new Mp4ConcatError('CODEC_DIFERENTE', 'faixa com mais de uma descrição de amostra');
    const last = i + 1 < runs.length ? runs[i + 1][0] - 1 : chunkCount;
    for (let c = first; c <= last; c++) chunkSamples[c - 1] = spc;
  });
  if (chunkSamples.reduce((n, x) => n + x, 0) !== sizes.length) throw new Mp4ConcatError('CORROMPIDO', 'tabelas de amostras inconsistentes');

  const edts = pick(k, 'edts');
  let edit: Track['edit'] = null;
  if (edts) {
    const elst = pick(children(b, dv, edts.body, edts.end), 'elst');
    if (elst && dv.getUint32(elst.body + 4) === 1) {
      const v1 = b[elst.body] === 1;
      const mediaTime = v1 ? dv.getInt32(elst.body + 8 + 8 + 4) : dv.getInt32(elst.body + 8 + 4);
      if (mediaTime >= 0) edit = { mediaTime };
    }
  }

  const hd = b.subarray(hdlr.body + 8, hdlr.body + 12);
  return {
    id: dv.getUint32(tkhd.body + (tv ? 20 : 12)),
    handler: cc(hd, 0),
    width: Math.round(dv.getUint32(tkhd.body + (tv ? 88 : 76)) / 65536),
    height: Math.round(dv.getUint32(tkhd.body + (tv ? 92 : 80)) / 65536),
    mediaTs: dv.getUint32(mdhd.body + (mv ? 20 : 12)),
    tkhd: copy(b, tkhd.start, tkhd.end),
    mdhd: copy(b, mdhd.start, mdhd.end),
    hdlr: copy(b, hdlr.start, hdlr.end),
    minfExtras: mi.filter((x) => x.type !== 'stbl').map((x) => copy(b, x.start, x.end)),
    stsd: copy(b, stsd.start, stsd.end),
    edit,
    sizes,
    stts: sttsRuns,
    ctts,
    stss,
    chunkSamples,
    chunkOffsets,
  };
}

function parseClip(bytes: Uint8Array): Clip {
  const dv = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  const top = children(bytes, dv, 0, bytes.length);
  if (top.some((x) => x.type === 'moof')) throw new Mp4ConcatError('FRAGMENTADO', 'MP4 fragmentado (moof) não é suportado');
  const ftyp = pick(top, 'ftyp');
  const moov = pick(top, 'moov');
  if (!moov || !ftyp) throw new Mp4ConcatError('SEM_MOOV', 'MP4 sem ftyp/moov');
  const mk = children(bytes, dv, moov.body, moov.end);
  if (pick(mk, 'mvex')) throw new Mp4ConcatError('FRAGMENTADO', 'MP4 fragmentado (mvex) não é suportado');
  const mvhd = pick(mk, 'mvhd');
  if (!mvhd) throw new Mp4ConcatError('TABELAS_AUSENTES', 'sem mvhd');
  const v1 = bytes[mvhd.body] === 1;
  const tracks = mk.filter((x) => x.type === 'trak').map((t) => parseTrack(bytes, dv, t));
  if (tracks.length === 0) throw new Mp4ConcatError('TABELAS_AUSENTES', 'sem faixas');
  return { bytes, ftyp: copy(bytes, ftyp.start, ftyp.end), mvhd: copy(bytes, mvhd.start, mvhd.end), movieTs: dv.getUint32(mvhd.body + (v1 ? 20 : 12)), tracks };
}

// ─── escrita ─────────────────────────────────────────────────────────────────────────────────────────────────────────

const u32 = (v: number) => Uint8Array.of((v >>> 24) & 255, (v >>> 16) & 255, (v >>> 8) & 255, v & 255);
const ascii = (s: string) => Uint8Array.from(s, (c) => c.charCodeAt(0));
function join(parts: readonly Uint8Array[]): Uint8Array {
  const out = new Uint8Array(parts.reduce((n, p) => n + p.length, 0));
  let at = 0;
  for (const p of parts) {
    out.set(p, at);
    at += p.length;
  }
  return out;
}
const box = (type: string, ...parts: Uint8Array[]): Uint8Array => {
  const body = join(parts);
  return join([u32(8 + body.length), ascii(type), body]);
};
/** Caixa de tabela (versão/flags + nº de entradas + entradas de campos de 32 bits). */
const table = (type: string, version: number, entries: number[][]): Uint8Array => box(type, Uint8Array.of(version, 0, 0, 0), u32(entries.length), ...entries.map((e) => join(e.map(u32))));

/** Copia `src` mudando o campo de duração (32 ou 64 bits, conforme a versão da caixa). */
function withDuration(src: Uint8Array, off32: number, off64: number, dur: number): Uint8Array {
  const out = copy(src, 0, src.length);
  const dv = new DataView(out.buffer, out.byteOffset, out.byteLength);
  const body = 8; // as caixas guardadas aqui sempre têm cabeçalho de 8 bytes
  if (out[body] === 1) {
    dv.setUint32(body + off64, Math.floor(dur / 2 ** 32));
    dv.setUint32(body + off64 + 4, dur >>> 0);
  } else dv.setUint32(body + off32, dur >>> 0);
  return out;
}

const sttsTotal = (t: Track) => t.stts.reduce((n, [c, d]) => n + c * d, 0);

/** Junta `clips` num só MP4. Com um único clipe devolve o próprio arquivo. */
export function concatMp4(clips: readonly Uint8Array[]): Uint8Array {
  if (clips.length === 0) throw new Mp4ConcatError('VAZIO', 'nenhum clipe para juntar');
  if (clips.length === 1) return clips[0];
  const parsed = clips.map(parseClip);
  const first = parsed[0];

  // Compatibilidade: mesmas faixas, mesmo codec, mesma escala de tempo e tamanho de imagem.
  for (const [i, c] of parsed.entries()) {
    if (c.tracks.length !== first.tracks.length) throw new Mp4ConcatError('FAIXAS_DIFERENTES', `a cena ${i + 1} tem ${c.tracks.length} faixa(s) e a primeira tem ${first.tracks.length}`);
    c.tracks.forEach((t, ti) => {
      const f = first.tracks[ti];
      if (t.handler !== f.handler) throw new Mp4ConcatError('FAIXAS_DIFERENTES', `a faixa ${ti + 1} da cena ${i + 1} é ${t.handler} e na primeira é ${f.handler}`);
      if (t.mediaTs !== f.mediaTs) throw new Mp4ConcatError('FAIXAS_DIFERENTES', `escala de tempo diferente na faixa ${ti + 1} da cena ${i + 1}`);
      if (t.width !== f.width || t.height !== f.height) throw new Mp4ConcatError('FAIXAS_DIFERENTES', `tamanho de imagem diferente na cena ${i + 1} (${t.width}×${t.height} ≠ ${f.width}×${f.height})`);
      if (t.stsd.length !== f.stsd.length || t.stsd.some((x, k) => x !== f.stsd[k])) throw new Mp4ConcatError('CODEC_DIFERENTE', `codec/parâmetros diferentes na faixa ${ti + 1} da cena ${i + 1}`);
      if ((t.ctts?.version ?? 0) !== (f.ctts?.version ?? 0)) throw new Mp4ConcatError('FAIXAS_DIFERENTES', 'versões de ctts diferentes');
    });
  }

  // 1) tabelas somadas por faixa + plano de cópia dos dados de mídia
  const nTracks = first.tracks.length;
  interface Out {
    sizes: number[];
    stts: [number, number][];
    ctts: [number, number][];
    stss: number[];
    anyStss: boolean;
    anyCtts: boolean;
    /** [first_chunk, samples_per_chunk, sdi] */
    stsc: [number, number, number][];
    chunks: number;
    samples: number;
  }
  const out: Out[] = Array.from({ length: nTracks }, () => ({ sizes: [], stts: [], ctts: [], stss: [], anyStss: false, anyCtts: false, stsc: [], chunks: 0, samples: 0 }));
  const copies: { track: number; chunk: number; src: number; clip: number; length: number }[] = [];
  let totalData = 0;

  parsed.forEach((clip, ci) => {
    clip.tracks.forEach((t, ti) => {
      const o = out[ti];
      const sampleBase = o.samples;
      const chunkBase = o.chunks;
      // stts (mescla corridas iguais na emenda)
      for (const [count, delta] of t.stts) {
        const last = o.stts[o.stts.length - 1];
        if (last && last[1] === delta) last[0] += count;
        else o.stts.push([count, delta]);
      }
      // ctts (clipe sem ctts entra com deslocamento 0)
      if (t.ctts) o.anyCtts = true;
      for (const [count, off] of t.ctts?.runs ?? [[t.sizes.length, 0] as [number, number]]) {
        const last = o.ctts[o.ctts.length - 1];
        if (last && last[1] === off) last[0] += count;
        else o.ctts.push([count, off]);
      }
      // stss (clipe sem stss: todas as amostras são sincronas)
      if (t.stss) o.anyStss = true;
      for (const n of t.stss ?? t.sizes.map((_, i) => i + 1)) o.stss.push(n + sampleBase);
      // stsc/stco: os chunks do clipe seguem como estavam; só a numeração continua
      t.chunkSamples.forEach((spc, c) => {
        const prev = o.stsc[o.stsc.length - 1];
        if (!prev || prev[1] !== spc) o.stsc.push([chunkBase + c + 1, spc, 1]);
      });
      let sample = 0;
      t.chunkSamples.forEach((spc, c) => {
        let length = 0;
        for (let i = 0; i < spc; i++) length += t.sizes[sample + i];
        sample += spc;
        copies.push({ track: ti, chunk: chunkBase + c, src: t.chunkOffsets[c], clip: ci, length });
        totalData += length;
      });
      o.sizes.push(...t.sizes);
      o.samples += t.sizes.length;
      o.chunks += t.chunkSamples.length;
    });
  });

  // 2) dados de mídia: clipe a clipe, na ordem original dos arquivos (preserva a intercalação áudio/vídeo)
  copies.sort((a, b) => a.clip - b.clip || a.src - b.src);
  const mdatPayload = new Uint8Array(totalData);
  const newOffsets: number[][] = out.map((o) => new Array<number>(o.chunks).fill(0));
  let at = 0;
  for (const c of copies) {
    const src = parsed[c.clip].bytes;
    if (c.src + c.length > src.length) throw new Mp4ConcatError('CORROMPIDO', 'chunk fora do arquivo');
    mdatPayload.set(src.subarray(c.src, c.src + c.length), at);
    newOffsets[c.track][c.chunk] = at; // relativo ao início do mdat; vira absoluto abaixo
    at += c.length;
  }

  // 3) moov novo
  const movieTs = first.movieTs;
  const trackDurations = first.tracks.map((t, ti) => Math.round((sttsTotal({ ...t, stts: out[ti].stts }) * movieTs) / t.mediaTs));
  const movieDur = Math.max(...trackDurations);
  const buildMoov = (mdatStart: number): Uint8Array => {
    const traks = first.tracks.map((t, ti) => {
      const o = out[ti];
      const mediaDur = sttsTotal({ ...t, stts: o.stts });
      const stbl = box(
        'stbl',
        t.stsd,
        table('stts', 0, o.stts),
        ...(o.anyCtts ? [table('ctts', t.ctts?.version ?? 0, o.ctts)] : []),
        ...(o.anyStss ? [table('stss', 0, o.stss.map((n) => [n]))] : []),
        table('stsc', 0, o.stsc),
        box('stsz', Uint8Array.of(0, 0, 0, 0), u32(0), u32(o.sizes.length), ...o.sizes.map(u32)),
        table('stco', 0, newOffsets[ti].map((x) => [mdatStart + x])),
      );
      const edts = t.edit
        ? [box('edts', box('elst', Uint8Array.of(0, 0, 0, 0), u32(1), u32(Math.max(0, Math.round(((mediaDur - t.edit.mediaTime) * movieTs) / t.mediaTs))), u32(t.edit.mediaTime >>> 0), u32(0x00010000)))]
        : [];
      return box(
        'trak',
        withDuration(t.tkhd, 20, 28, trackDurations[ti]),
        ...edts,
        box('mdia', withDuration(t.mdhd, 16, 24, mediaDur), t.hdlr, box('minf', ...t.minfExtras, stbl)),
      );
    });
    return box('moov', withDuration(first.mvhd, 16, 24, movieDur), ...traks);
  };

  // O tamanho do moov não depende dos valores dos offsets (stco tem 4 bytes por chunk): mede com 0 e refaz com o valor certo.
  const ftyp = first.ftyp;
  const moovSize = buildMoov(0).length;
  if (totalData + 8 >= 2 ** 32) throw new Mp4ConcatError('CORROMPIDO', 'resultado grande demais (mais de 4 GB)');
  const mdatHeader = join([u32(totalData + 8), ascii('mdat')]);
  const moov = buildMoov(ftyp.length + moovSize + mdatHeader.length);
  return join([ftyp, moov, mdatHeader, mdatPayload]);
}

// ─── leitura de amostras (para conferir o resultado) ─────────────────────────────────────────────────────────────────

export interface Mp4Sample {
  /** Tempo de decodificação, na escala da faixa. */
  dts: number;
  size: number;
  sync: boolean;
  data: Uint8Array;
}
export interface Mp4TrackInfo {
  handler: string;
  mediaTs: number;
  /** Duração total (soma do stts), na escala da faixa. */
  duration: number;
  samples: Mp4Sample[];
}

/** Lê as amostras de cada faixa de um MP4 não fragmentado. Serve para provar que a junção preservou tudo. */
export function readMp4Tracks(bytes: Uint8Array): Mp4TrackInfo[] {
  const clip = parseClip(bytes);
  return clip.tracks.map((t) => {
    const samples: Mp4Sample[] = [];
    let dts = 0;
    const deltas = t.stts.flatMap(([n, d]) => new Array<number>(n).fill(d));
    let sample = 0;
    t.chunkSamples.forEach((spc, c) => {
      let off = t.chunkOffsets[c];
      for (let i = 0; i < spc; i++, sample++) {
        const size = t.sizes[sample];
        samples.push({ dts, size, sync: t.stss ? t.stss.includes(sample + 1) : true, data: bytes.subarray(off, off + size) });
        off += size;
        dts += deltas[sample] ?? 0;
      }
    });
    return { handler: t.handler, mediaTs: t.mediaTs, duration: sttsTotal(t), samples };
  });
}
