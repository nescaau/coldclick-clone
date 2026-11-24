/** Avatares: validação da foto pelo CONTEÚDO (assinatura dos bytes) e rótulos. Regras puras. */

export const MAX_PHOTO_MB = 20;
export const MAX_PHOTO_BYTES = MAX_PHOTO_MB * 1024 * 1024;

export type Gender = '' | 'mulher' | 'homem';
export const GENDER_LABEL: Record<Exclude<Gender, ''>, string> = { mulher: 'MULHER', homem: 'HOMEM' };

export type ImageKind = { mime: 'image/jpeg' | 'image/png' | 'image/webp'; ext: 'jpg' | 'png' | 'webp' };

/** JPEG (FF D8 FF), PNG (89 'PNG') ou WEBP ('RIFF'…'WEBP'). O MIME/extensão do navegador não valem. */
export function sniffImage(b: Uint8Array): ImageKind | null {
  if (b.length >= 3 && b[0] === 0xff && b[1] === 0xd8 && b[2] === 0xff) return { mime: 'image/jpeg', ext: 'jpg' };
  if (b.length >= 8 && b[0] === 0x89 && b[1] === 0x50 && b[2] === 0x4e && b[3] === 0x47 && b[4] === 0x0d && b[5] === 0x0a && b[6] === 0x1a && b[7] === 0x0a) {
    return { mime: 'image/png', ext: 'png' };
  }
  if (b.length >= 12 && b[0] === 0x52 && b[1] === 0x49 && b[2] === 0x46 && b[3] === 0x46 && b[8] === 0x57 && b[9] === 0x45 && b[10] === 0x42 && b[11] === 0x50) {
    return { mime: 'image/webp', ext: 'webp' };
  }
  return null;
}

export type PhotoCheck = { ok: true; kind: ImageKind } | { ok: false; error: string };

/** Mensagens do original ("Foto grande demais… O limite é 20 MB." / "Isso não é uma foto…"); HEIC não é aceito aqui. */
export function validatePhoto(b: Uint8Array): PhotoCheck {
  if (b.length === 0) return { ok: false, error: 'O arquivo está vazio.' };
  if (b.length > MAX_PHOTO_BYTES) return { ok: false, error: `Foto grande demais (${(b.length / 1024 / 1024).toFixed(0)} MB). O limite é ${MAX_PHOTO_MB} MB.` };
  const kind = sniffImage(b);
  return kind ? { ok: true, kind } : { ok: false, error: 'Isso não é uma foto. Mande JPG, PNG ou WEBP.' };
}

/** Nome do arquivo dentro do zip: "<nome do avatar>.<ext>" (nome do arquivo = nome do avatar, como no original). */
export const photoFileName = (avatarName: string, ext: string): string => `${avatarName.replace(/[\\/:*?"<>|\u0000-\u001f]/g, '').trim() || 'avatar'}.${ext}`;
