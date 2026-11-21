/**
 * Repositório de trabalhos. Só SQL e mapeamento de linhas: validações, estimativas e
 * regras de transição de estado ficam em services/job-service.ts.
 */
import type { FormatId, ModelId, ResolutionId } from '../catalog';
import { getDb, nowIso } from '../db';
import type { ItemKind, ItemStatus, JobStatus, TranscriptSource } from '../types';

export interface JobRow {
  id: string;
  title: string;
  status: JobStatus;
  video_id: string | null;
  video_name: string | null;
  avatar_id: string | null;
  avatar_name: string;
  avatar_description: string;
  transcript: string;
  transcript_source: TranscriptSource;
  copy_text: string;
  language: string;
  format: FormatId;
  variations: number;
  model: ModelId;
  resolution: ResolutionId;
  max_generations: number;
  generations_used: number;
  failed_attempts: number;
  error: string | null;
  created_at: string;
  started_at: string | null;
  finished_at: string | null;
  // contagens derivadas (calculadas na leitura — nunca armazenadas, para não divergirem dos itens)
  videos_done: number;
  videos_failed: number;
  images_done: number;
  images_failed: number;
  items_open: number;
  images_open: number;
  thumbnail_path: string | null;
}

export interface JobItemRow {
  id: string;
  kind: ItemKind;
  variation: number;
  status: ItemStatus;
  attempts: number;
  file_path: string | null;
  is_placeholder: number;
  error: string | null;
}

const COUNT = (where: string) => `(SELECT COUNT(*) FROM job_items i WHERE i.job_id = j.id AND ${where})`;

const JOB_SELECT = `
  SELECT j.*,
    v.original_name AS video_name,
    ${COUNT(`i.kind = 'video' AND i.status = 'done'`)}            AS videos_done,
    ${COUNT(`i.kind = 'video' AND i.status = 'failed'`)}          AS videos_failed,
    ${COUNT(`i.kind = 'image' AND i.status = 'done'`)}            AS images_done,
    ${COUNT(`i.kind = 'image' AND i.status = 'failed'`)}          AS images_failed,
    ${COUNT(`i.status IN ('pending','running')`)}                 AS items_open,
    ${COUNT(`i.kind = 'image' AND i.status IN ('pending','running')`)} AS images_open,
    (SELECT i.file_path FROM job_items i WHERE i.job_id = j.id AND i.kind = 'image' AND i.status = 'done'
       ORDER BY i.variation LIMIT 1)                              AS thumbnail_path
  FROM jobs j
  LEFT JOIN videos v ON v.id = j.video_id`;

export const listJobRows = (): JobRow[] => getDb().prepare(`${JOB_SELECT} ORDER BY j.created_at DESC`).all() as JobRow[];

export const findJobRow = (id: string): JobRow | null =>
  (getDb().prepare(`${JOB_SELECT} WHERE j.id = ?`).get(id) as JobRow | undefined) ?? null;

export const listItemRows = (jobId: string): JobItemRow[] =>
  getDb()
    .prepare(
      `SELECT id, kind, variation, status, attempts, file_path, is_placeholder, error
       FROM job_items WHERE job_id = ?
       ORDER BY variation, CASE kind WHEN 'image' THEN 0 ELSE 1 END`,
    )
    .all(jobId) as JobItemRow[];

export interface NewJobRow {
  id: string;
  title: string;
  videoId: string;
  avatarId: string | null;
  avatarName: string;
  avatarDescription: string;
  transcript: string;
  transcriptSource: TranscriptSource;
  copyText: string;
  language: string;
  format: FormatId;
  variations: number;
  model: ModelId;
  resolution: ResolutionId;
  maxGenerations: number;
}

/** Insere o trabalho e seus itens (1 imagem-base + 1 vídeo por variação). Chame dentro de uma transação. */
export function insertJobWithItems(job: NewJobRow, newItemId: () => string): void {
  const db = getDb();
  db.prepare(
    `INSERT INTO jobs (id, title, video_id, avatar_id, avatar_name, avatar_description, transcript, transcript_source,
                       copy_text, language, format, variations, model, resolution, max_generations)
     VALUES (@id, @title, @videoId, @avatarId, @avatarName, @avatarDescription, @transcript, @transcriptSource,
             @copyText, @language, @format, @variations, @model, @resolution, @maxGenerations)`,
  ).run(job);
  const insertItem = db.prepare('INSERT INTO job_items (id, job_id, kind, variation) VALUES (?, ?, ?, ?)');
  for (let v = 1; v <= job.variations; v++) {
    insertItem.run(newItemId(), job.id, 'image', v);
    insertItem.run(newItemId(), job.id, 'video', v);
  }
}

/** Marca como cancelado se (e só se) estiver em fila/andamento. Cancela também os itens abertos. */
export function cancelJobRow(id: string): boolean {
  const db = getDb();
  const res = db
    .prepare(`UPDATE jobs SET status = 'cancelled', finished_at = ? WHERE id = ? AND status IN ('queued','running')`)
    .run(nowIso(), id);
  if (res.changes === 0) return false;
  db.prepare(`UPDATE job_items SET status = 'cancelled', ready_at = NULL WHERE job_id = ? AND status IN ('pending','running')`).run(id);
  return true;
}

export const getJobStatus = (id: string): { status: JobStatus; generations_used: number } | null =>
  (getDb().prepare('SELECT status, generations_used FROM jobs WHERE id = ?').get(id) as
    | { status: JobStatus; generations_used: number }
    | undefined) ?? null;

/** Devolve os itens que falharam em definitivo ao estado "pendente", com tentativas novas. Retorna quantos. */
export function resetFailedItems(jobId: string): number {
  return getDb()
    .prepare(
      `UPDATE job_items SET status = 'pending', attempts = 0, error = NULL, ready_at = NULL, finished_at = NULL
       WHERE job_id = ? AND status = 'failed'`,
    )
    .run(jobId).changes;
}

/** Recoloca o trabalho na fila com um novo teto de gerações. */
export function requeueJob(jobId: string, maxGenerations: number): void {
  getDb()
    .prepare(`UPDATE jobs SET status = 'queued', finished_at = NULL, error = NULL, max_generations = ? WHERE id = ?`)
    .run(maxGenerations, jobId);
}

export const deleteJobRow = (id: string): boolean => getDb().prepare('DELETE FROM jobs WHERE id = ?').run(id).changes > 0;
