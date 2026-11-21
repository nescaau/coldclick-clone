/**
 * Consultas e atualizações usadas pelo executor de trabalhos (services/job-runner.ts).
 * Só SQL; as regras da máquina de estados ficam no executor.
 */
import type { FormatId } from '../catalog';
import { getDb, nowIso } from '../db';
import type { ItemKind, JobStatus } from '../types';

export interface DueItemRow {
  id: string;
  job_id: string;
  kind: ItemKind;
  variation: number;
  attempts: number;
  format: FormatId;
  model: string;
  resolution: string;
  avatar_name: string;
  generations_used: number;
  max_generations: number;
}

export interface ActiveJobRow {
  id: string;
  generations_used: number;
  max_generations: number;
}

export interface PendingItemRow {
  id: string;
  kind: ItemKind;
  variation: number;
}

/** Itens "em andamento" cujo prazo (ready_at) já passou. */
export const listDueRunningItems = (now: number): DueItemRow[] =>
  getDb()
    .prepare(
      `SELECT i.id, i.job_id, i.kind, i.variation, i.attempts,
              j.format, j.model, j.resolution, j.avatar_name, j.generations_used, j.max_generations
       FROM job_items i JOIN jobs j ON j.id = i.job_id
       WHERE i.status = 'running' AND i.ready_at <= ?`,
    )
    .all(now) as DueItemRow[];

export function markItemDone(itemId: string, filePath: string): void {
  getDb()
    .prepare(
      `UPDATE job_items SET status = 'done', file_path = ?, is_placeholder = 1, error = NULL, ready_at = NULL, finished_at = ?
       WHERE id = ? AND status = 'running'`,
    )
    .run(filePath, nowIso(), itemId);
}

export function markItemPending(itemId: string): void {
  getDb().prepare(`UPDATE job_items SET status = 'pending', ready_at = NULL WHERE id = ? AND status = 'running'`).run(itemId);
}

/** Falha definitiva; `fromStatus` evita sobrescrever um item que mudou de estado (ex.: cancelado). */
export function markItemFailed(itemId: string, error: string, fromStatus: 'running' | 'pending'): void {
  getDb()
    .prepare(`UPDATE job_items SET status = 'failed', error = ?, ready_at = NULL, finished_at = ? WHERE id = ? AND status = ?`)
    .run(error, nowIso(), itemId, fromStatus);
}

export const incrementFailedAttempts = (jobId: string): void => {
  getDb().prepare('UPDATE jobs SET failed_attempts = failed_attempts + 1 WHERE id = ?').run(jobId);
};

export const findRunningJob = (): ActiveJobRow | null =>
  (getDb()
    .prepare(`SELECT id, generations_used, max_generations FROM jobs WHERE status = 'running' ORDER BY created_at LIMIT 1`)
    .get() as ActiveJobRow | undefined) ?? null;

export const findOldestQueuedJob = (): ActiveJobRow | null =>
  (getDb()
    .prepare(`SELECT id, generations_used, max_generations FROM jobs WHERE status = 'queued' ORDER BY created_at LIMIT 1`)
    .get() as ActiveJobRow | undefined) ?? null;

export const markJobRunning = (jobId: string): void => {
  getDb().prepare(`UPDATE jobs SET status = 'running', started_at = COALESCE(started_at, ?) WHERE id = ?`).run(nowIso(), jobId);
};

export const countRunningItems = (jobId: string): number =>
  (getDb().prepare(`SELECT COUNT(*) AS n FROM job_items WHERE job_id = ? AND status = 'running'`).get(jobId) as { n: number }).n;

/** Pendentes na ordem de execução: por variação, imagem antes do vídeo. */
export const listPendingItems = (jobId: string): PendingItemRow[] =>
  getDb()
    .prepare(
      `SELECT id, kind, variation FROM job_items WHERE job_id = ? AND status = 'pending'
       ORDER BY variation, CASE kind WHEN 'image' THEN 0 ELSE 1 END`,
    )
    .all(jobId) as PendingItemRow[];

export const getImageItemStatus = (jobId: string, variation: number): string | null =>
  (
    getDb().prepare(`SELECT status FROM job_items WHERE job_id = ? AND kind = 'image' AND variation = ?`).get(jobId, variation) as
      | { status: string }
      | undefined
  )?.status ?? null;

export const getGenerationBudget = (jobId: string): { used: number; max: number } =>
  getDb().prepare('SELECT generations_used AS used, max_generations AS max FROM jobs WHERE id = ?').get(jobId) as {
    used: number;
    max: number;
  };

/** Inicia uma tentativa: item → em andamento (com prazo) e consome 1 geração do teto do trabalho. */
export function startItemAttempt(itemId: string, jobId: string, readyAt: number): void {
  const db = getDb();
  db.prepare(`UPDATE job_items SET status = 'running', attempts = attempts + 1, ready_at = ? WHERE id = ?`).run(readyAt, itemId);
  db.prepare('UPDATE jobs SET generations_used = generations_used + 1 WHERE id = ?').run(jobId);
}

export const countOpenItems = (jobId: string): number =>
  (
    getDb().prepare(`SELECT COUNT(*) AS n FROM job_items WHERE job_id = ? AND status IN ('pending','running')`).get(jobId) as {
      n: number;
    }
  ).n;

export const getOutcomeCounts = (jobId: string): { videosDone: number; itemsDone: number; itemsTotal: number } => {
  const r = getDb()
    .prepare(
      `SELECT SUM(kind = 'video' AND status = 'done') AS videos_done,
              SUM(status = 'done')                    AS items_done,
              COUNT(*)                                AS items_total
       FROM job_items WHERE job_id = ?`,
    )
    .get(jobId) as { videos_done: number | null; items_done: number | null; items_total: number };
  return { videosDone: r.videos_done ?? 0, itemsDone: r.items_done ?? 0, itemsTotal: r.items_total };
};

export function finishJob(jobId: string, status: Extract<JobStatus, 'completed' | 'partial' | 'failed'>, error: string | null): void {
  getDb()
    .prepare(`UPDATE jobs SET status = ?, error = ?, finished_at = ? WHERE id = ? AND status = 'running'`)
    .run(status, error, nowIso(), jobId);
}
