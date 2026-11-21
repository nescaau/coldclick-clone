/** Casos de uso de trabalhos: criar/estimar, consultar, cancelar, reexecutar falhas e excluir. */
import { randomUUID } from 'node:crypto';
import { DEFAULT_AXES, type AxesChoice } from '../catalog';
import { transaction } from '../db';
import { AppError, conflict, notFound } from '../errors';
import { estimateGenerations, MAX_ATTEMPTS_PER_ITEM } from '../estimate';
import { fileUrl } from '../format';
import { findAvatarRow } from '../repo/avatars';
import { addJobEvent, listJobEventRows } from '../repo/job-events';
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
import { deriveCopyText, type Scene } from '../scenes';
import type { CreateJobInput } from '../schemas';
import { deleteDir } from '../storage';
import type { JobAvatarDTO, JobDetailDTO, JobDTO, JobItemDTO, JobPhase, JobPreviewDTO } from '../types';
import { countEligibleAccounts } from './account-service';
import { cancelTranscription } from './transcription-service';

/** Nome do "avatar" quando o trabalho mantém a pessoa original do vídeo. */
export const ORIGINAL_PERSON_NAME = 'Pessoa original';

/** Etapas registradas esperadas em uma transcrição (denominador do "Falhou · 35%"). */
export const TRANSCRIPTION_STEPS = 5;

function parseJson<T>(raw: string, fallback: T): T {
  try {
    return JSON.parse(raw) as T;
  } catch {
    return fallback;
  }
}

/** Fase atual do trabalho de geração: imagens-base pendentes → vídeos → concluído. */
function phaseOf(r: JobRow): JobPhase {
  if (r.kind === 'transcription') return r.status === 'running' || r.status === 'queued' ? 'images' : 'done';
  if (r.images_open > 0) return 'images';
  return r.items_open > 0 ? 'videos' : 'done';
}

const toJobDTO = (r: JobRow): JobDTO => ({
  id: r.id,
  kind: r.kind,
  title: r.title,
  product: r.product,
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
  stepsDone: r.steps_done,
  stepsTotal: r.kind === 'transcription' ? TRANSCRIPTION_STEPS : 0,
  stepsPercent: r.kind === 'transcription' ? Math.min(100, r.steps_weight) : 0,
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
  const started = new Date(row.started_at ?? row.created_at).getTime();
  const ended = row.finished_at ? new Date(row.finished_at).getTime() : Date.now();
  return {
    ...toJobDTO(row),
    avatarDescription: row.avatar_description,
    creativeFormat: row.creative_format as JobDetailDTO['creativeFormat'],
    scriptMode: row.script_mode as JobDetailDTO['scriptMode'],
    imageModel: row.image_model as JobDetailDTO['imageModel'],
    cta: row.cta,
    avatars: parseJson<JobAvatarDTO[]>(row.avatars_json, []),
    axes: { ...DEFAULT_AXES, ...parseJson<Partial<AxesChoice>>(row.axes_json, {}) },
    scenes: parseJson<Scene[]>(row.scenes_json, []),
    events: listJobEventRows(id).map((e) => ({ id: e.id, label: e.label, status: e.status, createdAt: e.created_at })),
    elapsedSec: Math.max(0, Math.round((ended - started) / 1000)),
    transcript: row.transcript,
    transcriptSource: row.transcript_source,
    copyText: row.copy_text,
    items: listItemRows(id).map(toItemDTO),
  };
}

/** Dados já resolvidos de um pedido de trabalho (avatares reais, nº de saídas, estimativa). */
function resolveRequest(input: CreateJobInput) {
  const video = findVideoRow(input.videoId);
  if (!video) throw new AppError(400, 'Vídeo não encontrado');

  const avatars: JobAvatarDTO[] = input.avatarIds.map((id) => {
    const a = findAvatarRow(id);
    if (!a) throw new AppError(400, 'Avatar não encontrado');
    return { id: a.id, name: a.name, description: a.description, voice: a.voice };
  });

  // Cada avatar gera 1 saída; sem avatar ("Pessoa original") há 1 saída.
  const variations = Math.max(1, avatars.length);
  return { video, avatars, variations, estimate: estimateGenerations(variations) };
}

/** "Preparar geração": valida o pedido e calcula as saídas e a estimativa, sem gravar nada. */
export function previewJob(input: CreateJobInput): JobPreviewDTO {
  const { avatars, variations, estimate } = resolveRequest(input);
  return {
    variations,
    estimate,
    eligibleAccounts: countEligibleAccounts(),
    avatarNames: avatars.length ? avatars.map((a) => a.name) : [ORIGINAL_PERSON_NAME],
  };
}

const stripExtension = (name: string) => name.replace(/\.[^.]+$/, '');

/** Cria o trabalho (já validado pelo esquema) com todos os itens, em uma transação. */
export function createJob(input: CreateJobInput): JobDetailDTO {
  const { video, avatars, variations, estimate } = resolveRequest(input);
  const first = avatars[0];
  const id = randomUUID();

  transaction(() => {
    insertJobWithItems(
      {
        id,
        title: input.title?.trim() || stripExtension(video.original_name),
        product: input.product,
        videoId: input.videoId,
        // Cópia dos avatares: o histórico não muda se eles forem editados/excluídos depois.
        avatarId: first?.id ?? null,
        avatarName: avatars.length ? avatars.map((a) => a.name).join(', ') : ORIGINAL_PERSON_NAME,
        avatarDescription: first?.description ?? '',
        transcript: input.transcript,
        transcriptSource: input.transcriptSource,
        copyText: deriveCopyText(input.scenes, input.copyText),
        language: input.outputLanguage,
        format: '9:16', // o formato de tela é decidido pelo "Formato criativo"
        variations,
        model: input.model,
        resolution: input.resolution,
        maxGenerations: estimate.maxGenerations,
        creativeFormat: input.creativeFormat,
        scriptMode: input.scriptMode,
        imageModel: input.imageModel,
        cta: input.cta,
        avatarsJson: JSON.stringify(avatars),
        axesJson: JSON.stringify(input.axes),
        scenesJson: JSON.stringify(input.scenes),
      },
      randomUUID,
    );
    addJobEvent(id, 'Trabalho criado');
  });
  return getJob(id);
}

/** Cancela um trabalho em fila/andamento (e os itens que ainda não terminaram). */
export function cancelJob(id: string): JobDetailDTO {
  const row = findJobRow(id);
  if (!row) throw notFound('Trabalho');
  if (row.kind === 'transcription') {
    // Aborta a chamada em andamento; o evento "Transcrição cancelada" é registrado lá.
    if (!cancelTranscription(id)) throw conflict('Só é possível cancelar transcrições em andamento');
    return getJob(id);
  }
  transaction(() => {
    if (!cancelJobRow(id)) throw conflict('Só é possível cancelar trabalhos na fila ou em andamento');
    addJobEvent(id, 'Trabalho cancelado');
  });
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
    addJobEvent(id, `${retried} ${retried === 1 ? 'item com falha reenviado' : 'itens com falha reenviados'} à fila`);
  });
  return getJob(id);
}

export function removeJob(id: string): void {
  if (!findJobRow(id)) throw notFound('Trabalho');
  // Transcrição em andamento: aborta antes de apagar (a conclusão tardia não grava em trabalho excluído).
  cancelTranscription(id);
  if (!deleteJobRow(id)) throw notFound('Trabalho');
  deleteDir(`outputs/${id}`);
}
