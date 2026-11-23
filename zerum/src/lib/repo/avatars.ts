import { getDb, newId, nowIso } from '../db';
import type { AvatarDTO } from '../types';

interface AvatarRow {
  id: string;
  name: string;
  description: string;
  created_at: string;
}

const toDTO = (r: AvatarRow): AvatarDTO => ({ id: r.id, name: r.name, description: r.description, createdAt: r.created_at });

export const listAvatars = (): AvatarDTO[] =>
  (getDb().prepare('SELECT * FROM avatars ORDER BY created_at DESC, rowid DESC').all() as AvatarRow[]).map(toDTO);

export const getAvatar = (id: string): AvatarDTO | undefined => {
  const r = getDb().prepare('SELECT * FROM avatars WHERE id = ?').get(id) as AvatarRow | undefined;
  return r ? toDTO(r) : undefined;
};

export function insertAvatar(a: { name: string; description: string }): AvatarDTO {
  const id = newId();
  const now = nowIso();
  getDb().prepare('INSERT INTO avatars (id, name, description, created_at, updated_at) VALUES (?, ?, ?, ?, ?)').run(id, a.name, a.description, now, now);
  return getAvatar(id)!;
}

export function updateAvatar(id: string, a: { name: string; description: string }): void {
  getDb().prepare('UPDATE avatars SET name = ?, description = ?, updated_at = ? WHERE id = ?').run(a.name, a.description, nowIso(), id);
}

export const deleteAvatar = (id: string): void => {
  getDb().prepare('DELETE FROM avatars WHERE id = ?').run(id);
};
