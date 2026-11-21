/** Casos de uso da biblioteca de avatares (CRUD com fotos de referência + seed de exemplo). */
import { randomUUID } from 'node:crypto';
import path from 'node:path';
import { IMAGE_TYPES, MAX_IMAGE_BYTES } from '../config';
import { AppError, notFound } from '../errors';
import { fileUrl } from '../format';
import {
  deleteAvatarRow,
  deletePhotoRows,
  findAvatarRow,
  insertAvatarRow,
  insertPhotoRows,
  listAvatarRows,
  listPhotoPathsOf,
  listPhotoRows,
  updateAvatarRow,
  type AvatarRow,
  type NewPhotoRow,
} from '../repo/avatars';
import { getRawSetting, setRawSetting } from '../repo/settings';
import { portraitSvg, SEED_AVATARS, SEED_FLAG } from '../seed';
import { deleteFile, safeBaseName, saveBuffer, saveTextSync } from '../storage';
import { transaction } from '../db';
import type { AvatarDTO } from '../types';

const MAX_PHOTOS_PER_REQUEST = 10;
const MAX_NAME = 80;
const MAX_DESCRIPTION = 2000;
const MAX_VOICE = 600;

function toDTOs(rows: AvatarRow[]): AvatarDTO[] {
  if (rows.length === 0) return [];
  const photos = listPhotoRows();
  return rows.map((r) => ({
    id: r.id,
    name: r.name,
    description: r.description,
    voice: r.voice,
    createdAt: r.created_at,
    updatedAt: r.updated_at,
    photos: photos
      .filter((p) => p.avatar_id === r.id)
      .map((p) => ({ id: p.id, url: fileUrl(p.file_path), originalName: p.original_name })),
  }));
}

export const listAvatars = (): AvatarDTO[] => toDTOs(listAvatarRows());

export function getAvatar(id: string): AvatarDTO {
  const row = findAvatarRow(id);
  if (!row) throw notFound('Avatar');
  return toDTOs([row])[0];
}

export interface AvatarInput {
  name: string;
  description: string;
  /** Descrição da voz, em inglês (opcional). */
  voice?: string;
}

function validateInput(input: AvatarInput): Required<AvatarInput> {
  const name = input.name.trim();
  const description = input.description.trim();
  const voice = (input.voice ?? '').trim();
  if (!name) throw new AppError(400, 'Informe o nome do avatar');
  if (name.length > MAX_NAME) throw new AppError(400, `O nome deve ter no máximo ${MAX_NAME} caracteres`);
  if (!description) throw new AppError(400, 'Descreva o personagem (em inglês)');
  if (description.length > MAX_DESCRIPTION) {
    throw new AppError(400, `A descrição deve ter no máximo ${MAX_DESCRIPTION} caracteres`);
  }
  if (voice.length > MAX_VOICE) throw new AppError(400, `A descrição da voz deve ter no máximo ${MAX_VOICE} caracteres`);
  return { name, description, voice };
}

function validatePhotos(files: File[]): void {
  if (files.length > MAX_PHOTOS_PER_REQUEST) {
    throw new AppError(400, `Envie no máximo ${MAX_PHOTOS_PER_REQUEST} fotos por vez`);
  }
  for (const f of files) {
    if (!IMAGE_TYPES[path.extname(f.name).toLowerCase()]) throw new AppError(415, `"${f.name}": use fotos JPG, PNG ou WebP`);
    if (f.size > MAX_IMAGE_BYTES) throw new AppError(413, `"${f.name}" passa de ${MAX_IMAGE_BYTES / 1024 / 1024} MB`);
  }
}

/** Grava as fotos na pasta do avatar e devolve os registros para o banco. */
async function storePhotos(avatarId: string, files: File[]): Promise<NewPhotoRow[]> {
  const stored: NewPhotoRow[] = [];
  for (const f of files) {
    const filePath = `avatars/${avatarId}/${randomUUID()}${path.extname(f.name).toLowerCase()}`;
    await saveBuffer(filePath, Buffer.from(await f.arrayBuffer()));
    stored.push({ id: randomUUID(), filePath, originalName: safeBaseName(f.name) });
  }
  return stored;
}

export async function createAvatar(input: AvatarInput & { photos: File[] }): Promise<AvatarDTO> {
  const data = validateInput(input);
  validatePhotos(input.photos);
  const id = randomUUID();
  const photos = await storePhotos(id, input.photos);
  transaction(() => {
    insertAvatarRow(id, data.name, data.description, data.voice);
    insertPhotoRows(id, photos);
  });
  return getAvatar(id);
}

export async function updateAvatar(
  id: string,
  input: AvatarInput & { photos: File[]; removePhotoIds: string[] },
): Promise<AvatarDTO> {
  if (!findAvatarRow(id)) throw notFound('Avatar');
  const data = validateInput(input);
  validatePhotos(input.photos);
  const newPhotos = await storePhotos(id, input.photos);

  const removedPaths = transaction(() => {
    updateAvatarRow(id, data.name, data.description, data.voice);
    const removed = deletePhotoRows(id, input.removePhotoIds);
    insertPhotoRows(id, newPhotos);
    return removed;
  });
  // Arquivos só são apagados depois do commit, para não perder dado se a transação falhar.
  removedPaths.forEach(deleteFile);
  return getAvatar(id);
}

export function removeAvatar(id: string): void {
  if (!findAvatarRow(id)) throw notFound('Avatar');
  const paths = listPhotoPathsOf(id);
  deleteAvatarRow(id);
  paths.forEach(deleteFile);
}

/** Cria os avatares de exemplo na primeira execução. Idempotente. */
export function seedAvatarsOnce(): void {
  if (getRawSetting(SEED_FLAG)) return;

  // Arquivos primeiro; o marcador só é gravado se tudo der certo.
  const staged = SEED_AVATARS.map((a) => {
    const id = randomUUID();
    const photos: NewPhotoRow[] = [0, 1].map((variant) => {
      const filePath = `avatars/${id}/ref-${variant + 1}.svg`;
      saveTextSync(filePath, portraitSvg(a, variant));
      return { id: randomUUID(), filePath, originalName: `referencia-${variant + 1}.svg` };
    });
    return { id, a, photos };
  });

  transaction(() => {
    for (const { id, a, photos } of staged) {
      insertAvatarRow(id, a.name, a.description, a.voice);
      insertPhotoRows(id, photos);
    }
    setRawSetting(SEED_FLAG, '1');
  });
}
