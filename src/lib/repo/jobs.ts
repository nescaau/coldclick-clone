/**
 * Repositório de trabalhos. Só SQL e mapeamento de linhas: validações, estimativas e
 * regras de transição de estado ficam em services/job-service.ts.
 */
import type { FormatId, ModelId, ResolutionId } from '../catalog';
import { getDb, nowIso } from '../db';
import { TRANSCRIPTION_STEP_WEIGHTS } from '../transcription-steps';
import type { ItemKind, ItemStatus, JobKind, JobStatus, TranscriptSource } from '../types';

export interface JobRow {
  id: string;
  kind: JobKind;
  title: string;
  product: string | null;
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
  creative_format: string;
  script_mode: string;
  image_model: string;
  cta: string;
  avatars_json: string; // JSON: snapshot dos avatares
  axes_json: string; // JSON: eixos de variação
  scenes_json: string; // JSON: cenas da fala
  error: string | null;
  created_at: string;
  queued_at: string;
  started_at: string | null;
  finished_at: string | null;
  // contagens derivadas (calculadas na leitura — nunca armazenadas, para não divergirem dos itens)
  videos_done: number;
  videos_failed: number;
  images_done: number;
  images_failed: number;
  items_open: number;
  images_open: number;
  steps_done: number;
  steps_failed: number;
  /** Soma dos pesos das etapas concluídas (0–100), ver lib/transcription-steps.ts. */
  steps_weight: number;
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

/** Marca (no campo `error` do item) os itens parados por esgotar o teto de gerações — não são falhas. */
export const INTERRUPTED_ERROR = 'Interrompido: teto de gerações do trabalho atingido';

const STEP_WEIGHT_CASE = Object.entries(TRANSCRIPTION_STEP_WEIGHTS)
  .map(([label, weight]) => `WHEN '${label.replace(/'/g, "''")}' THEN ${weight}`)
  .join(' ');

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
    (SELECT COUNT(*) FROM job_events e WHERE e.job_id = j.id AND e.status = 'done')   AS steps_done,
    (SELECT COUNT(*) FROM job_events e WHERE e.job_id = j.id AND e.status = 'failed') AS steps_failed,
    (SELECT COALESCE(SUM(CASE e.label ${STEP_WEIGHT_CASE} ELSE 0 END), 0) FROM job_events e WHERE e.job_id = j.id AND e.status = 'done') AS steps_weight,
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
  product: string | null;
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
  creativeFormat: string;
  scriptMode: string;
  imageModel: string;
  cta: string;
  avatarsJson: string;
  axesJson: string;
  scenesJson: string;
}

/** Insere o trabalho e seus itens (1 imagem-base + 1 vídeo por variação). Chame dentro de uma transação. */
export function insertJobWithItems(job: NewJobRow, newItemId: () => string): void {
  const db = getDb();
  db.prepare(
    `INSERT INTO jobs (id, title, product, video_id, avatar_id, avatar_name, avatar_description, transcript, transcript_source,
                       copy_text, language, format, variations, model, resolution, max_generations,
                       creative_format, script_mode, image_model, cta, avatars_json, axes_json, scenes_json)
     VALUES (@id, @title, @product, @videoId, @avatarId, @avatarName, @avatarDescription, @transcript, @transcriptSource,
             @copyText, @language, @format, @variations, @model, @resolution, @maxGenerations,
             @creativeFormat, @scriptMode, @imageModel, @cta, @avatarsJson, @axesJson, @scenesJson)`,
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
  return db.transaction(() => {
    const res = db
      .prepare(`UPDATE jobs SET status = 'cancelled', finished_at = ? WHERE id = ? AND status IN ('queued','running')`)
      .run(nowIso(), id);
    if (res.changes === 0) return false;
    db.prepare(`UPDATE job_items SET status = 'cancelled', ready_at = NULL WHERE job_id = ? AND status IN ('pending','running')`).run(id);
    return true;
  })();
}

export const getJobStatus = (id: string): { status: JobStatus; generations_used: number } | null =>
  (getDb().prepare('SELECT status, generations_used FROM jobs WHERE id = ?').get(id) as
    | { status: JobStatus; generations_used: number }
    | undefined) ?? null;

/**
 * Devolve ao estado "pendente", com tentativas novas, os itens que falharam em definitivo E os que ficaram
 * interrompidos por esgotar o teto de gerações (marcados com `INTERRUPTED_ERROR`). Retorna quantos.
 */
export function resetFailedItems(jobId: string): number {
  return getDb()
    .prepare(
      `UPDATE job_items SET status = 'pending', attempts = 0, error = NULL, ready_at = NULL, finished_at = NULL
       WHERE job_id = ? AND (status = 'failed' OR (status = 'cancelled' AND error = ?))`,
    )
    .run(jobId, INTERRUPTED_ERROR).changes;
}

/** Recoloca o trabalho no FIM da fila (queued_at = agora) com um novo teto de gerações. */
export function requeueJob(jobId: string, maxGenerations: number): void {
  getDb()
    .prepare(`UPDATE jobs SET status = 'queued', queued_at = ?, finished_at = NULL, error = NULL, max_generations = ? WHERE id = ?`)
    .run(nowIso(), maxGenerations, jobId);
}

export const deleteJobRow = (id: string): boolean => getDb().prepare('DELETE FROM jobs WHERE id = ?').run(id).changes > 0;

/* ------------------------------------------------------------------ */
/* Trabalhos de transcrição ("prévia")                                 */
/* ------------------------------------------------------------------ */

/**
 * Cria um trabalho de TRANSCRIÇÃO já em andamento. As colunas específicas de geração recebem valores
 * neutros (variations = 0, sem itens): este tipo de trabalho não passa pelo executor da fila.
 */
export function insertTranscriptionJob(job: { id: string; title: string; videoId: string; language: string; defaultModel: string }): void {
  getDb()
    .prepare(
      `INSERT INTO jobs (id, kind, title, status, video_id, avatar_name, avatar_description, language, format, variations,
                         model, resolution, max_generations, started_at)
       VALUES (@id, 'transcription', @title, 'running', @videoId, 'Pessoa original', '', @language, '9:16', 0,
               @defaultModel, '720p', 0, @startedAt)`,
    )
    .run({ ...job, startedAt: nowIso() });
}

/** Conclui a transcrição SOMENTE se ainda estiver em andamento (cancelada/excluída no meio-tempo → false). */
export function completeTranscriptionJob(id: string, transcript: string, scenesJson: string): boolean {
  return (
    getDb()
      .prepare(
        `UPDATE jobs SET status = 'completed', transcript = ?, transcript_source = 'whisper', copy_text = ?, scenes_json = ?, finished_at = ?
         WHERE id = ? AND kind = 'transcription' AND status = 'running'`,
      )
      .run(transcript, transcript, scenesJson, nowIso(), id).changes > 0
  );
}

/** Marca a falha SOMENTE se ainda estiver em andamento (não sobrescreve "cancelada"). */
export function failTranscriptionJob(id: string, error: string): boolean {
  return (
    getDb()
      .prepare(`UPDATE jobs SET status = 'failed', error = ?, finished_at = ? WHERE id = ? AND kind = 'transcription' AND status = 'running'`)
      .run(error.slice(0, 500), nowIso(), id).changes > 0
  );
}

export function cancelTranscriptionJob(id: string): boolean {
  return (
    getDb()
      .prepare(`UPDATE jobs SET status = 'cancelled', finished_at = ? WHERE id = ? AND kind = 'transcription' AND status = 'running'`)
      .run(nowIso(), id).changes > 0
  );
}

export const listRunningTranscriptionIds = (): string[] =>
  (getDb().prepare(`SELECT id FROM jobs WHERE kind = 'transcription' AND status = 'running'`).all() as { id: string }[]).map((r) => r.id);

export const listTranscriptionJobIdsForVideo = (videoId: string): string[] =>
  (getDb().prepare(`SELECT id FROM jobs WHERE kind = 'transcription' AND video_id = ?`).all(videoId) as { id: string }[]).map((r) => r.id);
