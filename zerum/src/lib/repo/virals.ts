import { getDb, newId, nowIso } from '../db';
import type { ViralDTO } from '../types';

export interface ViralRow {
  id: string;
  hash: string;
  name: string;
  mime: string;
  size_bytes: number;
  state: 'preparando' | 'analisado';
  created_at: string;
}

export const toViralDTO = (r: ViralRow): ViralDTO => ({
  id: r.id,
  name: r.name,
  sizeBytes: r.size_bytes,
  state: r.state,
  createdAt: r.created_at,
});

export const listVirals = (): ViralRow[] =>
  getDb().prepare('SELECT * FROM virals ORDER BY created_at DESC, rowid DESC').all() as ViralRow[];

export const getViral = (id: string): ViralRow | undefined =>
  getDb().prepare('SELECT * FROM virals WHERE id = ?').get(id) as ViralRow | undefined;

export const getViralByHash = (hash: string): ViralRow | undefined =>
  getDb().prepare('SELECT * FROM virals WHERE hash = ?').get(hash) as ViralRow | undefined;

export function insertViral(v: { hash: string; name: string; mime: string; sizeBytes: number }): ViralRow {
  const id = newId();
  getDb()
    .prepare('INSERT INTO virals (id, hash, name, mime, size_bytes, created_at) VALUES (?, ?, ?, ?, ?, ?)')
    .run(id, v.hash, v.name, v.mime, v.sizeBytes, nowIso());
  return getViral(id)!;
}

export const deleteViral = (id: string): void => {
  getDb().prepare('DELETE FROM virals WHERE id = ?').run(id);
};
