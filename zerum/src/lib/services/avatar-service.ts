/**
 * Avatares (biblioteca local). A foto é guardada em data/avatares/<sha256>.<ext>, validada pelo CONTEÚDO.
 * "✨ Gerar", "Mesma pessoa, outro visual" e "Pessoa nova parecida" precisam de IA/Flow (fase futura): aqui "Gerar"
 * cria o cartão SEM foto (marcado "gerado") e as variações respondem com um aviso claro.
 */
import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import { AVATARS_DIR } from '../config';
import { transaction } from '../db';
import { AppError, badRequest, notFound } from '../errors';
import { MAX_AVATAR_NAME } from '../limits';
import { photoFileName, validatePhoto, type Gender } from '../domain/avatar';
import { safeZipName, uniqueNames, type ZipEntry } from '../domain/zip';
import {
  countAvatars,
  countPhotoUsers,
  deleteAvatar,
  getAvatar,
  getAvatarRow,
  insertAvatar,
  listAvatarRows,
  listAvatars,
  setAvatarPhoto,
  updateAvatar,
} from '../repo/avatars';
import { logEvent, APP_LOG_REF } from '../repo/events';
import type { AvatarDTO } from '../types';

export const listAllAvatars = (): AvatarDTO[] => listAvatars();
export const avatarCount = (): number => countAvatars();

const photoPath = (hash: string, mime: string | null) => path.join(AVATARS_DIR, `${hash}.${mime === 'image/png' ? 'png' : mime === 'image/webp' ? 'webp' : 'jpg'}`);

function storePhoto(bytes: Uint8Array): { hash: string; mime: string } {
  const check = validatePhoto(bytes);
  if (!check.ok) throw new AppError(400, check.error);
  const hash = crypto.createHash('sha256').update(bytes).digest('hex');
  const dest = photoPath(hash, check.kind.mime);
  fs.mkdirSync(AVATARS_DIR, { recursive: true });
  if (!fs.existsSync(dest)) {
    const tmp = `${dest}.${process.pid}.tmp`;
    fs.writeFileSync(tmp, bytes);
    fs.renameSync(tmp, dest);
  }
  return { hash, mime: check.kind.mime };
}

/** Apaga a foto do disco só se nenhum outro avatar a usa. */
function dropPhotoIfOrphan(hash: string | null, mime: string | null): void {
  if (hash && countPhotoUsers(hash) === 0) fs.rmSync(photoPath(hash, mime), { force: true });
}

export interface AvatarInput {
  name: string;
  description: string;
  gender: Gender;
}

/** "Preencher à mão" / "Salvar sem foto mesmo": cartão sem foto. */
export function createAvatar(input: AvatarInput): AvatarDTO {
  const a = insertAvatar({ ...input, origin: 'manual' });
  logEvent('app', APP_LOG_REF, `Avatar “${a.name}” criado (sem foto).`);
  return a;
}

/** "Enviar minha foto": cria o avatar já com a foto. O nome vem do arquivo (dá pra trocar no lápis). */
export function createAvatarFromPhoto(input: { fileName: string; bytes: Uint8Array }): AvatarDTO {
  const { hash, mime } = storePhoto(input.bytes);
  const base = input.fileName.replace(/\.[A-Za-z0-9]{2,5}$/, '').replace(/[_-]+/g, ' ').trim().slice(0, MAX_AVATAR_NAME);
  const a = insertAvatar({ name: base || `Avatar ${countAvatars() + 1}`, description: '', gender: '', origin: 'foto', photoHash: hash, photoMime: mime });
  logEvent('app', APP_LOG_REF, `Avatar “${a.name}” criado a partir da sua foto (guardada só neste computador).`);
  return a;
}

/** "✨ Gerar 1/4": sem IA, cria N cartões SEM foto (origem "gerado"). O rosto gerado pelo Flow é a fase futura. */
export function generateAvatars(count: number): AvatarDTO[] {
  const n = Math.max(1, Math.min(4, Math.floor(count)));
  return transaction(() => {
    const start = countAvatars();
    const out: AvatarDTO[] = [];
    for (let i = 0; i < n; i++) out.push(insertAvatar({ name: `Avatar ${start + i + 1}`, description: '', gender: '', origin: 'gerado' }));
    logEvent('app', APP_LOG_REF, `${n} avatar${n === 1 ? '' : 'es'} criado${n === 1 ? '' : 's'} sem foto: o rosto gerado pelo Flow é fase futura (nada foi enviado). Abra o lápis para mandar uma foto.`, 'aviso');
    return out;
  });
}

export function editAvatar(id: string, input: AvatarInput): AvatarDTO {
  if (!getAvatar(id)) throw notFound('Avatar');
  updateAvatar(id, input);
  return getAvatar(id)!;
}

/** Foto nova no lápis do cartão (substitui a anterior). */
export function replacePhoto(id: string, bytes: Uint8Array): AvatarDTO {
  const row = getAvatarRow(id);
  if (!row) throw notFound('Avatar');
  const { hash, mime } = storePhoto(bytes);
  setAvatarPhoto(id, hash, mime);
  if (row.photo_hash && row.photo_hash !== hash) dropPhotoIfOrphan(row.photo_hash, row.photo_mime);
  return getAvatar(id)!;
}

export function removeAvatar(id: string): void {
  const row = getAvatarRow(id);
  if (!row) throw notFound('Avatar');
  deleteAvatar(id);
  dropPhotoIfOrphan(row.photo_hash, row.photo_mime);
  logEvent('app', APP_LOG_REF, `Avatar “${row.name}” apagado.`);
}

/** "🗑 Apagar N selecionados". */
export function removeAvatars(ids: string[]): number {
  if (ids.length === 0) throw badRequest('Marque pelo menos um avatar.');
  let n = 0;
  transaction(() => {
    for (const id of new Set(ids)) {
      const row = getAvatarRow(id);
      if (!row) continue;
      deleteAvatar(id);
      dropPhotoIfOrphan(row.photo_hash, row.photo_mime);
      n++;
    }
    logEvent('app', APP_LOG_REF, `${n} avatar${n === 1 ? '' : 'es'} apagado${n === 1 ? '' : 's'}.`);
  });
  return n;
}

export function avatarPhoto(id: string): { path: string; mime: string } {
  const row = getAvatarRow(id);
  if (!row?.photo_hash) throw notFound('Foto', true);
  const p = photoPath(row.photo_hash, row.photo_mime);
  if (!fs.existsSync(p)) throw notFound('Foto', true);
  return { path: p, mime: row.photo_mime ?? 'image/jpeg' };
}

/** Nomes (um por avatar) usados no rodízio dos vídeos. Ids inexistentes são ignorados. */
export function namesOf(ids: string[]): string[] {
  return ids.map((id) => getAvatar(id)?.name).filter((n): n is string => !!n);
}

/** "⬇ Baixar todos (zip)": a foto de cada avatar (arquivo = nome do avatar) + avatares.json. */
export function avatarsZipEntries(): ZipEntry[] {
  const rows = listAvatarRows();
  if (rows.length === 0) throw new AppError(404, 'Nenhum avatar salvo pra baixar.');
  const withPhoto = rows.filter((r) => r.photo_hash);
  const names = uniqueNames(withPhoto.map((r) => safeZipName(photoFileName(r.name, r.photo_mime === 'image/png' ? 'png' : r.photo_mime === 'image/webp' ? 'webp' : 'jpg'), 'avatar.jpg')));
  const entries: ZipEntry[] = withPhoto.map((r, i) => ({ name: names[i], data: () => fs.createReadStream(photoPath(r.photo_hash as string, r.photo_mime)) }));
  const json = JSON.stringify(
    rows.map((r) => ({ nome: r.name, sexo: r.gender, descricao: r.description, foto: r.photo_hash ? names[withPhoto.indexOf(r)] : null })),
    null,
    2,
  );
  entries.push({ name: 'avatares.json', data: new TextEncoder().encode(json) });
  return entries;
}
