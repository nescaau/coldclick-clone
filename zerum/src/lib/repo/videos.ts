import { getDb, newId, nowIso } from '../db';
import type { VideoPatch, VideoState } from '../domain/production';

export interface VideoRow {
  id: string;
  batch_id: string;
  idx: number;
  title: string;
  scenes: string;
  avatar_name: string;
  state: VideoState;
  scenes_total: number;
  scenes_done: number;
  fail_scene: number | null;
  error: string;
  attempt: number;
  started_at: number | null;
  finished_at: string | null;
  created_at: string;
}

export interface NewVideo {
  batchId: string;
  idx: number;
  title: string;
  scenes: { fala: string }[];
  avatarName: string;
}

export function insertVideo(v: NewVideo): string {
  const id = newId();
  getDb()
    .prepare('INSERT INTO videos (id, batch_id, idx, title, scenes, avatar_name, scenes_total, created_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?)')
    .run(id, v.batchId, v.idx, v.title, JSON.stringify(v.scenes), v.avatarName, v.scenes.length, nowIso());
  return id;
}

export const listVideoRows = (batchId: string): VideoRow[] =>
  getDb().prepare('SELECT * FROM videos WHERE batch_id = ? ORDER BY idx ASC').all(batchId) as VideoRow[];

export const getVideoRow = (id: string): VideoRow | undefined => getDb().prepare('SELECT * FROM videos WHERE id = ?').get(id) as VideoRow | undefined;

export const countVideos = (batchId: string): number =>
  (getDb().prepare('SELECT COUNT(*) AS n FROM videos WHERE batch_id = ?').get(batchId) as { n: number }).n;

/** Vídeos PRONTOS, do lote mais novo para o mais antigo ("MEUS VÍDEOS"). */
export const listReadyVideoRows = (): VideoRow[] =>
  getDb()
    .prepare(
      `SELECT v.* FROM videos v JOIN batches b ON b.id = v.batch_id
       WHERE v.state = 'pronto' ORDER BY b.created_at DESC, b.rowid DESC, v.idx ASC`,
    )
    .all() as VideoRow[];

export const countReadyVideos = (): number => (getDb().prepare("SELECT COUNT(*) AS n FROM videos WHERE state = 'pronto'").get() as { n: number }).n;

export function patchVideo(id: string, p: VideoPatch): void {
  const sets: string[] = [];
  const vals: unknown[] = [];
  if (p.state !== undefined) (sets.push('state = ?'), vals.push(p.state));
  if (p.scenesDone !== undefined) (sets.push('scenes_done = ?'), vals.push(p.scenesDone));
  if (p.failScene !== undefined) (sets.push('fail_scene = ?'), vals.push(p.failScene));
  if (p.error !== undefined) (sets.push('error = ?'), vals.push(p.error));
  if (p.attempt !== undefined) (sets.push('attempt = ?'), vals.push(p.attempt));
  if (p.startedAt !== undefined) (sets.push('started_at = ?'), vals.push(p.startedAt));
  if (p.finishedAt !== undefined) (sets.push('finished_at = ?'), vals.push(p.finishedAt === null ? null : new Date(p.finishedAt).toISOString()));
  if (sets.length === 0) return;
  getDb().prepare(`UPDATE videos SET ${sets.join(', ')} WHERE id = ?`).run(...vals, id);
}

export const deleteVideo = (id: string): void => {
  getDb().prepare('DELETE FROM videos WHERE id = ?').run(id);
};
