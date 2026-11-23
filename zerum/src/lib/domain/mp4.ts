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

export type ViralCheck = { ok: true } | { ok: false; error: string };

export function validateViral(input: { name: string; size: number; head: Uint8Array }): ViralCheck {
  if (!input.size) return { ok: false, error: 'O arquivo está vazio.' };
  if (input.size > MAX_VIRAL_BYTES) return { ok: false, error: `O vídeo passa de ${MAX_VIRAL_MB} MB.` };
  if (!/\.mp4$/i.test(input.name)) return { ok: false, error: 'Envie um arquivo .mp4.' };
  if (!looksLikeMp4(input.head)) return { ok: false, error: 'Esse arquivo não parece um MP4 válido.' };
  return { ok: true };
}

/** Nome exibido do viral: sem caminho, sem controle, até 120 caracteres. */
export function displayName(raw: string): string {
  const base = String(raw ?? '').split(/[\\/]/).pop() ?? '';
  // eslint-disable-next-line no-control-regex
  const clean = base.replace(/[\u0000-\u001f\u007f]/g, '').trim();
  return (clean || 'viral.mp4').slice(0, 120);
}
