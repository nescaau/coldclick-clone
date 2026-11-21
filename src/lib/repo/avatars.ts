/** Repositório de avatares e fotos de referência. Só SQL: arquivos e seed ficam nos serviços. */
import { getDb, nowIso } from '../db';

export interface AvatarRow {
  id: string;
  name: string;
  description: string;
  voice: string;
  created_at: string;
  updated_at: string;
}

export interface AvatarPhotoRow {
  id: string;
  avatar_id: string;
  file_path: string;
  original_name: string;
  position: number;
}

export interface NewPhotoRow {
  id: string;
  filePath: string;
  originalName: string;
}

export const listAvatarRows = (): AvatarRow[] =>
  getDb().prepare('SELECT * FROM avatars ORDER BY created_at, name').all() as AvatarRow[];

export const findAvatarRow = (id: string): AvatarRow | null =>
  (getDb().prepare('SELECT * FROM avatars WHERE id = ?').get(id) as AvatarRow | undefined) ?? null;

export const listPhotoRows = (): AvatarPhotoRow[] =>
  getDb().prepare('SELECT * FROM avatar_photos ORDER BY position, created_at').all() as AvatarPhotoRow[];

export const countAvatars = (): number =>
  (getDb().prepare('SELECT COUNT(*) AS n FROM avatars').get() as { n: number }).n;

export function insertAvatarRow(id: string, name: string, description: string, voice: string): void {
  getDb().prepare('INSERT INTO avatars (id, name, description, voice) VALUES (?, ?, ?, ?)').run(id, name, description, voice);
}

export function updateAvatarRow(id: string, name: string, description: string, voice: string): void {
  getDb()
    .prepare('UPDATE avatars SET name = ?, description = ?, voice = ?, updated_at = ? WHERE id = ?')
    .run(name, description, voice, nowIso(), id);
}

/** Acrescenta fotos ao final da ordem do avatar. */
export function insertPhotoRows(avatarId: string, photos: NewPhotoRow[]): void {
  const db = getDb();
  const next = (
    db.prepare('SELECT COALESCE(MAX(position), -1) + 1 AS n FROM avatar_photos WHERE avatar_id = ?').get(avatarId) as {
      n: number;
    }
  ).n;
  const stmt = db.prepare(
    'INSERT INTO avatar_photos (id, avatar_id, file_path, original_name, position) VALUES (?, ?, ?, ?, ?)',
  );
  photos.forEach((p, i) => stmt.run(p.id, avatarId, p.filePath, p.originalName, next + i));
}

/** Remove as fotos indicadas (só as do avatar) e devolve os caminhos dos arquivos removidos. */
export function deletePhotoRows(avatarId: string, photoIds: string[]): string[] {
  const db = getDb();
  const removed: string[] = [];
  for (const photoId of photoIds) {
    const row = db.prepare('SELECT file_path FROM avatar_photos WHERE id = ? AND avatar_id = ?').get(photoId, avatarId) as
      | { file_path: string }
      | undefined;
    if (row) {
      removed.push(row.file_path);
      db.prepare('DELETE FROM avatar_photos WHERE id = ?').run(photoId);
    }
  }
  return removed;
}

export const listPhotoPathsOf = (avatarId: string): string[] =>
  (getDb().prepare('SELECT file_path FROM avatar_photos WHERE avatar_id = ?').all(avatarId) as { file_path: string }[]).map(
    (r) => r.file_path,
  );

export const deleteAvatarRow = (id: string): boolean => getDb().prepare('DELETE FROM avatars WHERE id = ?').run(id).changes > 0;
