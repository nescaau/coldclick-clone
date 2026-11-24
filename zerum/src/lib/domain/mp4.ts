/**
 * Validação do viral enviado: só MP4 (caixa `ftyp` nos primeiros bytes) até MAX_VIRAL_MB.
 * O MIME/extensão informados pelo navegador não são confiáveis — o conteúdo manda.
 */
import { MAX_VIRAL_BYTES, MAX_VIRAL_MB } from '../limits';

/** MP4/ISO-BMFF: bytes 4..8 = "ftyp" (a caixa de tipo vem primeiro no arquivo). */
export function looksLikeMp4(head: Uint8Array): boolean {
  if (head.length < 12) return false;
  return head[4] === 0x66 && head[5] === 0x74 && head[6] === 0x79 && head[7] === 0x70;
}

const MAX_NAME_CHARS = 120;

export type ViralCheck = { ok: true } | { ok: false; error: string };

export function validateViral(input: { name: string; size: number; head: Uint8Array }): ViralCheck {
  if (!input.size) return { ok: false, error: 'O arquivo está vazio.' };
  if (input.size > MAX_VIRAL_BYTES) return { ok: false, error: `O vídeo passa de ${MAX_VIRAL_MB} MB.` };
  if (!/\.mp4$/i.test(input.name)) return { ok: false, error: 'Envie um arquivo .mp4.' };
  if (!looksLikeMp4(input.head)) return { ok: false, error: 'Esse arquivo não parece um MP4 válido.' };
  return { ok: true };
}

/**
 * Nome exibido do viral: sem caminho, sem controle, até 120 caracteres. Ao encurtar, preserva o sufixo ".mp4": a
 * extensão é validada sobre o nome COMPLETO (um nome longo válido não pode virar "não é .mp4" por causa do corte).
 */
export function displayName(raw: string): string {
  const base = String(raw ?? '').split(/[\\/]/).pop() ?? '';
  // eslint-disable-next-line no-control-regex
  const clean = base.replace(/[\u0000-\u001f\u007f]/g, '').trim();
  const full = clean || 'viral.mp4';
  if (full.length <= MAX_NAME_CHARS) return full;
  const ext = /\.mp4$/i.exec(full)?.[0] ?? '';
  return full.slice(0, MAX_NAME_CHARS - ext.length) + ext;
}

/** Metadados lidos do próprio arquivo (caixas `moov`/`mvhd`/`trak`). Nada é inventado: o que não achar vira null/false. */
export interface Mp4Meta {
  durationS: number | null;
  width: number | null;
  height: number | null;
  hasVideo: boolean;
  hasAudio: boolean;
}

const fourcc = (b: Uint8Array, o: number) => String.fromCharCode(b[o], b[o + 1], b[o + 2], b[o + 3]);

/** Percorre as caixas filhas de [start, end). Para quando `cb` devolve true. */
function walkBoxes(b: Uint8Array, dv: DataView, start: number, end: number, cb: (type: string, body: number, bodyEnd: number) => boolean | void): void {
  let o = start;
  while (o + 8 <= end) {
    let size = dv.getUint32(o);
    const type = fourcc(b, o + 4);
    let header = 8;
    if (size === 1) {
      if (o + 16 > end) return;
      const hi = dv.getUint32(o + 8);
      const lo = dv.getUint32(o + 12);
      size = hi * 2 ** 32 + lo;
      header = 16;
    } else if (size === 0) {
      size = end - o;
    }
    if (size < header || o + size > end) return; // caixa truncada/corrompida: para sem lançar
    if (cb(type, o + header, o + size) === true) return;
    o += size;
  }
}

/** Lê duração, dimensões e faixas de um MP4 inteiro em memória. Devolve null se não achar o `moov`. */
export function parseMp4Meta(bytes: Uint8Array): Mp4Meta | null {
  const dv = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  const meta: Mp4Meta = { durationS: null, width: null, height: null, hasVideo: false, hasAudio: false };
  let foundMoov = false;

  walkBoxes(bytes, dv, 0, bytes.length, (type, body, bodyEnd) => {
    if (type !== 'moov') return;
    foundMoov = true;
    walkBoxes(bytes, dv, body, bodyEnd, (t, b0, b1) => {
      if (t === 'mvhd' && b1 - b0 >= 20) {
        const v1 = bytes[b0] === 1;
        const timescale = v1 ? dv.getUint32(b0 + 20) : dv.getUint32(b0 + 12);
        const duration = v1 ? dv.getUint32(b0 + 24) * 2 ** 32 + dv.getUint32(b0 + 28) : dv.getUint32(b0 + 16);
        if (timescale > 0 && duration > 0) meta.durationS = Math.round((duration / timescale) * 100) / 100;
      } else if (t === 'trak') {
        let w: number | null = null;
        let h: number | null = null;
        let handler = '';
        walkBoxes(bytes, dv, b0, b1, (tt, c0, c1) => {
          if (tt === 'tkhd') {
            const v1 = bytes[c0] === 1;
            const off = v1 ? 88 : 76;
            if (c1 - c0 >= off + 8) {
              w = Math.round(dv.getUint32(c0 + off) / 65536);
              h = Math.round(dv.getUint32(c0 + off + 4) / 65536);
            }
          } else if (tt === 'mdia') {
            walkBoxes(bytes, dv, c0, c1, (t3, d0, d1) => {
              if (t3 === 'hdlr' && d1 - d0 >= 12) handler = fourcc(bytes, d0 + 8);
            });
          }
        });
        if (handler === 'vide') {
          meta.hasVideo = true;
          if (w && h && meta.width === null) {
            meta.width = w;
            meta.height = h;
          }
        } else if (handler === 'soun') meta.hasAudio = true;
      }
    });
    return true;
  });
  return foundMoov ? meta : null;
}
