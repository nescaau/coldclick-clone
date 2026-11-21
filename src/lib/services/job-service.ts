/** Casos de uso de trabalhos: criar, consultar, cancelar, reexecutar falhas e excluir. */
import { randomUUID } from 'node:crypto';
import { transaction } from '../db';
import { AppError, conflict, notFound } from '../errors';
import { estimateGenerations, MAX_ATTEMPTS_PER_ITEM } from '../estimate';
import { fileUrl } from '../format';
import { findAvatarRow } from '../repo/avatars';
import {
  cancelJobRow,
  deleteJobRow,
  findJobRow,
  getJobStatus,
  insertJobWithItems,
  listItemRows,
  listJobRows,
  requeueJob,
  resetFailedItems,
  type JobItemRow,
  type JobRow,
} from '../repo/jobs';
import { findVideoRow } from '../repo/videos';
import type { CreateJobInput } from '../schemas';
import { deleteDir } from '../storage';
import type { JobDetailDTO, JobDTO, JobItemDTO, JobPhase } from '../types';

/** Nome do "avatar" quando o trabalho mantém a pessoa original do vídeo. */
export const ORIGINAL_PERSON_NAME = 'Pessoa original';

/** Fase atual do trabalho: imagens-base pendentes → vídeos → concluído. */
function phaseOf(r: JobRow): JobPhase {
  if (r.images_open > 0) return 'images';
  return r.items_open > 0 ? 'videos' : 'done';
}

const toJobDTO = (r: JobRow): JobDTO => ({
  id: r.id,
  title: r.title,
  status: r.status,
  phase: phaseOf(r),
  videoId: r.video_id,
  videoName: r.video_name,
  avatarId: r.avatar_id,
  avatarName: r.avatar_name,
  format: r.format,
  variations: r.variations,
  model: r.model,
  resolution: r.resolution,
  language: r.language,
  maxGenerations: r.max_generations,
  generationsUsed: r.generations_used,
  videosDone: r.videos_done,
  videosFailed: r.videos_failed,
  imagesDone: r.images_done,
  imagesFailed: r.images_failed,
  failedAttempts: r.failed_attempts,
  itemsOpen: r.items_open,
  error: r.error,
  createdAt: r.created_at,
  startedAt: r.started_at,
  finishedAt: r.finished_at,
  thumbnailUrl: r.thumbnail_path ? fileUrl(r.thumbnail_path) : null,
});

const toItemDTO = (r: JobItemRow): JobItemDTO => ({
  id: r.id,
  kind: r.kind,
  variation: r.variation,
  status: r.status,
  attempts: r.attempts,
  url: r.file_path ? fileUrl(r.file_path) : null,
  isPlaceholder: r.is_placeholder === 1,
  error: r.error,
});

export const listJobs = (): JobDTO[] => listJobRows().map(toJobDTO);

export function getJob(id: string): JobDetailDTO {
  const row = findJobRow(id);
  if (!row) throw notFound('Trabalho');
  return {
    ...toJobDTO(row),
    avatarDescription: row.avatar_description,
    transcript: row.transcript,
    transcriptSource: row.transcript_source,
    copyText: row.copy_text,
    items: listItemRows(id).map(toItemDTO),
  };
}

/** Cria o trabalho (já validado pelo esquema) com todos os itens, em uma transação. */
export function createJob(input: CreateJobInput): JobDetailDTO {
  const video = findVideoRow(input.videoId);
  if (!video) throw new AppError(400, 'Vídeo não encontrado');

  // "Pessoa original" não tem avatar: o trabalho guarda esse nome e uma descrição vazia.
  let avatarName = ORIGINAL_PERSON_NAME;
  let avatarDescription = '';
  if (input.avatarId) {
    const avatar = findAvatarRow(input.avatarId);
    if (!avatar) throw new AppError(400, 'Avatar não encontrado');
    avatarName = avatar.name;
    avatarDescription = avatar.description;
  }

  const estimate = estimateGenerations(input.variations);
  const id = randomUUID();
  transaction(() =>
    insertJobWithItems(
      {
        id,
        title: input.title?.trim() || video.original_name,
        videoId: input.videoId,
        avatarId: input.avatarId,
        // Cópia do avatar: o histórico não muda se o avatar for editado/excluído depois.
        avatarName,
        avatarDescription,
        transcript: input.transcript,
        transcriptSource: input.transcriptSource,
        copyText: input.copyText,
        language: input.language,
        format: input.format,
        variations: input.variations,
        model: input.model,
        resolution: input.resolution,
        maxGenerations: estimate.maxGenerations,
      },
      randomUUID,
    ),
  );
  return getJob(id);
}

/** Cancela um trabalho em fila/andamento (e os itens que ainda não terminaram). */
export function cancelJob(id: string): JobDetailDTO {
  if (!findJobRow(id)) throw notFound('Trabalho');
  if (!cancelJobRow(id)) throw conflict('Só é possível cancelar trabalhos na fila ou em andamento');
  return getJob(id);
}

/**
 * Reexecuta apenas os itens que falharam em definitivo. Cada um ganha tentativas novas e o teto
 * de gerações passa a ser "o já usado + tentativas dos itens reexecutados".
 */
export function retryFailedItems(id: string): JobDetailDTO {
  transaction(() => {
    const job = getJobStatus(id);
    if (!job) throw notFound('Trabalho');
    if (job.status !== 'partial' && job.status !== 'failed') {
      throw conflict('Só trabalhos parciais ou com falha podem ser reexecutados');
    }
    const retried = resetFailedItems(id);
    if (retried === 0) throw conflict('Este trabalho não tem itens com falha para reexecutar');
    requeueJob(id, job.generations_used + retried * MAX_ATTEMPTS_PER_ITEM);
  });
  return getJob(id);
}

export function removeJob(id: string): void {
  if (!deleteJobRow(id)) throw notFound('Trabalho');
  deleteDir(`outputs/${id}`);
}
