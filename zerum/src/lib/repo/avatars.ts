import { getDb, newId, nowIso } from '../db';
import type { Gender } from '../domain/avatar';
import type { AvatarDTO } from '../types';

export interface AvatarRow {
  id: string;
  name: string;
  description: string;
  gender: Gender;
  photo_hash: string | null;
  photo_mime: string | null;
  origin: AvatarDTO['origin'];
  created_at: string;
}

const toDTO = (r: AvatarRow): AvatarDTO => ({
  id: r.id,
  name: r.name,
  description: r.description,
  gender: r.gender,
  hasPhoto: !!r.photo_hash,
  origin: r.origin,
  createdAt: r.created_at,
});

const rows = (): AvatarRow[] => getDb().prepare('SELECT * FROM avatars ORDER BY created_at DESC, rowid DESC').all() as AvatarRow[];
export const listAvatars = (): AvatarDTO[] => rows().map(toDTO);
export const listAvatarRows = rows;
export const countAvatars = (): number => (getDb().prepare('SELECT COUNT(*) AS n FROM avatars').get() as { n: number }).n;

export const getAvatarRow = (id: string): AvatarRow | undefined => getDb().prepare('SELECT * FROM avatars WHERE id = ?').get(id) as AvatarRow | undefined;
export const getAvatar = (id: string): AvatarDTO | undefined => {
  const r = getAvatarRow(id);
  return r ? toDTO(r) : undefined;
};

export interface NewAvatar {
  name: string;
  description: string;
  gender: Gender;
  origin: AvatarDTO['origin'];
  photoHash?: string | null;
  photoMime?: string | null;
}

export function insertAvatar(a: NewAvatar): AvatarDTO {
  const id = newId();
  const now = nowIso();
  getDb()
    .prepare('INSERT INTO avatars (id, name, description, gender, origin, photo_hash, photo_mime, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)')
    .run(id, a.name, a.description, a.gender, a.origin, a.photoHash ?? null, a.photoMime ?? null, now, now);
  return getAvatar(id)!;
}

export function updateAvatar(id: string, a: { name: string; description: string; gender: Gender }): void {
  getDb().prepare('UPDATE avatars SET name = ?, description = ?, gender = ?, updated_at = ? WHERE id = ?').run(a.name, a.description, a.gender, nowIso(), id);
}

export function setAvatarPhoto(id: string, hash: string | null, mime: string | null): void {
  getDb().prepare('UPDATE avatars SET photo_hash = ?, photo_mime = ?, updated_at = ? WHERE id = ?').run(hash, mime, nowIso(), id);
}

/** Quantos avatares usam esta foto (a foto em disco só some quando ninguém mais a usa). */
export const countPhotoUsers = (hash: string): number =>
  (getDb().prepare('SELECT COUNT(*) AS n FROM avatars WHERE photo_hash = ?').get(hash) as { n: number }).n;

export const deleteAvatar = (id: string): void => {
  getDb().prepare('DELETE FROM avatars WHERE id = ?').run(id);
};
