/**
 * Junção de clipes MP4 (as cenas do Flow viram o vídeo final). A prova é por AMOSTRA: cada amostra de cada faixa de cada
 * clipe tem de estar, byte a byte e na ordem, no arquivo juntado — com o tempo contínuo nas emendas.
 */
import { describe, expect, it } from 'vitest';
import { PLACEHOLDER_MP4 } from '../services/placeholder-clip';
import { parseMp4Meta } from './mp4';
import { Mp4ConcatError, concatMp4, readMp4Tracks } from './mp4-concat';
import { buildClip, type ClipSpec } from './mp4-concat-fixture';

const spec = (seed: number, o: Partial<ClipSpec> = {}): ClipSpec => ({ videoFrames: 25, audioFrames: 40, seed, ...o });
const same = (a: Uint8Array, b: Uint8Array) => a.length === b.length && a.every((x, i) => x === b[i]);

describe('concatMp4', () => {
  it('um clipe só: devolve o próprio arquivo; nenhum clipe: erro', () => {
    const c = buildClip(spec(1)).bytes;
    expect(concatMp4([c])).toBe(c);
    expect(() => concatMp4([])).toThrow(Mp4ConcatError);
  });

  it('3 clipes: cada amostra (vídeo e áudio) preservada, na ordem, com o tempo contínuo nas emendas', () => {
    const clips = [buildClip(spec(1)), buildClip(spec(2, { videoFrames: 30, audioFrames: 52 })), buildClip(spec(3, { videoFrames: 7, audioFrames: 9 }))];
    const out = concatMp4(clips.map((c) => c.bytes));
    const [v, a] = readMp4Tracks(out);
    expect([v.handler, a.handler]).toEqual(['vide', 'soun']);

    const wantV = clips.flatMap((c) => c.video);
    const wantA = clips.flatMap((c) => c.audio);
    expect(v.samples).toHaveLength(wantV.length);
    expect(a.samples).toHaveLength(wantA.length);
    v.samples.forEach((s, i) => expect(same(s.data, wantV[i]), `vídeo ${i}`).toBe(true));
    a.samples.forEach((s, i) => expect(same(s.data, wantA[i]), `áudio ${i}`).toBe(true));

    // tempo: dts contínuo (delta fixo) e duração total = soma
    v.samples.forEach((s, i) => expect(s.dts).toBe(i * 512));
    a.samples.forEach((s, i) => expect(s.dts).toBe(i * 1024));
    expect(v.duration).toBe(wantV.length * 512);
    expect(a.duration).toBe(wantA.length * 1024);
  });

  it('pontos de sincronismo (stss) e deslocamentos (ctts) continuam corretos depois de cada emenda', () => {
    const a = buildClip(spec(1, { videoFrames: 25 })); // sync nas amostras 1, 13, 25
    const b = buildClip(spec(2, { videoFrames: 14 })); // sync nas amostras 1, 13
    const out = concatMp4([a.bytes, b.bytes]);
    const [v] = readMp4Tracks(out);
    const syncs = v.samples.flatMap((s, i) => (s.sync ? [i + 1] : []));
    expect(syncs).toEqual([1, 13, 25, 26, 38]);
  });

  it('estrutura do resultado: moov ANTES do mdat, tamanhos coerentes e metadados legíveis pelo leitor do app', () => {
    const clips = [buildClip(spec(1)), buildClip(spec(2))];
    const out = concatMp4(clips.map((c) => c.bytes));
    const dv = new DataView(out.buffer, out.byteOffset, out.byteLength);
    const tops: string[] = [];
    for (let o = 0; o < out.length; ) {
      const size = dv.getUint32(o);
      tops.push(String.fromCharCode(...out.subarray(o + 4, o + 8)));
      o += size;
    }
    expect(tops).toEqual(['ftyp', 'moov', 'mdat']); // faststart; sem `free`/`udta` sobrando
    const meta = parseMp4Meta(out);
    expect(meta).toMatchObject({ width: 720, height: 1280, hasVideo: true, hasAudio: true });
    const total = (25 * 512 * 2) / 12288; // ≈ 4,17 s de vídeo (o filme dura o da faixa mais longa)
    expect(meta!.durationS).toBeGreaterThanOrEqual(Math.floor(total * 100) / 100 - 0.05);
  });

  it('a lista de edição (atraso inicial) do primeiro clipe vale para o arquivo inteiro', () => {
    const out = concatMp4([buildClip(spec(1)).bytes, buildClip(spec(2)).bytes]);
    const text = Buffer.from(out).toString('latin1');
    expect(text.split('elst').length - 1).toBe(2); // uma por faixa (vídeo e áudio), não uma por clipe
  });

  it('o resultado é um MP4 válido: dá para juntar de novo (junção de junção) sem perder amostra', () => {
    const [a, b, c] = [buildClip(spec(1)), buildClip(spec(2)), buildClip(spec(3))];
    const ab = concatMp4([a.bytes, b.bytes]);
    const abc = concatMp4([ab, c.bytes]);
    const direct = concatMp4([a.bytes, b.bytes, c.bytes]);
    const x = readMp4Tracks(abc);
    const y = readMp4Tracks(direct);
    expect(x[0].samples.map((s) => Array.from(s.data))).toEqual(y[0].samples.map((s) => Array.from(s.data)));
    expect(x[1].samples).toHaveLength(y[1].samples.length);
    expect(x[0].duration).toBe(y[0].duration);
  });

  it('clipes só de vídeo e sem ctts/edts também juntam', () => {
    const clips = [buildClip(spec(1, { audio: false, withCtts: false, withEdit: false })), buildClip(spec(2, { audio: false, withCtts: false, withEdit: false }))];
    const out = concatMp4(clips.map((c) => c.bytes));
    const tracks = readMp4Tracks(out);
    expect(tracks).toHaveLength(1);
    expect(tracks[0].samples).toHaveLength(50);
  });

  it('recusa clipes DIFERENTES com o motivo (nunca gera arquivo meio certo)', () => {
    const base = buildClip(spec(1)).bytes;
    const code = (other: Uint8Array) => {
      try {
        concatMp4([base, other]);
      } catch (e) {
        return (e as Mp4ConcatError).code;
      }
      return 'NAO_LANCOU';
    };
    expect(code(buildClip(spec(2, { width: 1080, height: 1920 })).bytes)).toBe('FAIXAS_DIFERENTES'); // tamanho de imagem
    expect(code(buildClip(spec(2, { codecSalt: 9 })).bytes)).toBe('CODEC_DIFERENTE'); // parâmetros do codec
    expect(code(buildClip(spec(2, { audio: false })).bytes)).toBe('FAIXAS_DIFERENTES'); // sem faixa de áudio
    expect(code(buildClip(spec(2, { videoTs: 24000 })).bytes)).not.toBe('NAO_LANCOU'); // outra escala de tempo
  });

  it('entrada como Buffer do Node (o que fs.readFileSync devolve): nada é alterado no arquivo de origem e o resultado é idêntico', () => {
    // No Buffer, `.slice()` é uma janela sobre a mesma memória: já houve um bug em que a junção reescrevia os bytes de entrada.
    const clips = [buildClip(spec(1)).bytes, buildClip(spec(2)).bytes];
    const plain = concatMp4(clips);
    const bufs = clips.map((c) => Buffer.from(c)); // Buffers vindos do "pool" do Node (byteOffset ≠ 0 em geral)
    const pool = Buffer.concat([Buffer.alloc(13), ...bufs]); // força deslocamentos diferentes de zero
    const views = [pool.subarray(13, 13 + bufs[0].length), pool.subarray(13 + bufs[0].length)];
    const before = views.map((v) => Buffer.from(v));
    const out = concatMp4(views);
    expect(Buffer.from(out).equals(Buffer.from(plain))).toBe(true);
    views.forEach((v, i) => expect(v.equals(before[i]), `entrada ${i} intacta`).toBe(true));
    expect(Object.getPrototypeOf(out)).toBe(Uint8Array.prototype);
  });

  it('recusa o que não dá para juntar: fragmentado, sem moov, truncado', () => {
    const base = buildClip(spec(1)).bytes;
    const frag = Uint8Array.from([...base, 0, 0, 0, 8, 0x6d, 0x6f, 0x6f, 0x66]); // um `moof` no fim
    expect(() => concatMp4([base, frag])).toThrow(/fragmentado/);
    const noMoov = base.subarray(0, base.length - 200);
    expect(() => concatMp4([base, noMoov])).toThrow(Mp4ConcatError);
    expect(() => concatMp4([base, Uint8Array.of(1, 2, 3)])).toThrow(Mp4ConcatError);
  });
});

/**
 * Um MP4 de VERDADE (H.264 + AAC codificado pelo x264/ffmpeg, com edts/ctts/stss/sgpd, `moov` depois do `mdat`): o clipe de
 * teste embutido no app. Prova que a junção entende o arquivo que um encoder real produz, não só os fixtures daqui.
 */
describe('com um MP4 de verdade (o clipe de teste embutido)', () => {
  it('2 e 3 cópias: todas as amostras de vídeo e áudio preservadas, duração somada', () => {
    const one = PLACEHOLDER_MP4;
    const [rv, ra] = readMp4Tracks(one);
    for (const n of [2, 3]) {
      const out = concatMp4(Array.from({ length: n }, () => one));
      const [v, a] = readMp4Tracks(out);
      expect(v.samples).toHaveLength(rv.samples.length * n);
      expect(a.samples).toHaveLength(ra.samples.length * n);
      v.samples.forEach((s, i) => expect(same(s.data, rv.samples[i % rv.samples.length].data)).toBe(true));
      a.samples.forEach((s, i) => expect(same(s.data, ra.samples[i % ra.samples.length].data)).toBe(true));
      expect(v.duration).toBe(rv.duration * n);
      expect(a.duration).toBe(ra.duration * n);
      expect(parseMp4Meta(out)).toMatchObject({ hasVideo: true, hasAudio: true, width: parseMp4Meta(one)!.width });
      // o filme dura o da faixa mais longa (o áudio do clipe tem ~20 ms a mais que o vídeo a cada cópia)
      expect(parseMp4Meta(out)!.durationS).toBeGreaterThanOrEqual(parseMp4Meta(one)!.durationS! * n - 0.01);
      expect(parseMp4Meta(out)!.durationS).toBeLessThan(parseMp4Meta(one)!.durationS! * n + 0.1);
    }
  });

  it('o mesmo clipe lido do disco como Buffer (fs.readFileSync) junta igual — e mantém a duração somada', async () => {
    const fs = await import('node:fs');
    const os = await import('node:os');
    const path = await import('node:path');
    const file = path.join(os.tmpdir(), `zerum-concat-${process.pid}.mp4`);
    fs.writeFileSync(file, PLACEHOLDER_MP4);
    try {
      const a = fs.readFileSync(file);
      const b = fs.readFileSync(file);
      const out = concatMp4([a, b]);
      expect(parseMp4Meta(out)!.durationS).toBeGreaterThan(parseMp4Meta(PLACEHOLDER_MP4)!.durationS! * 2 - 0.01);
      expect(Buffer.from(concatMp4([PLACEHOLDER_MP4, PLACEHOLDER_MP4])).equals(Buffer.from(out))).toBe(true);
      expect(a.equals(Buffer.from(PLACEHOLDER_MP4))).toBe(true); // a entrada não foi tocada
    } finally {
      fs.rmSync(file, { force: true });
    }
  });
});
