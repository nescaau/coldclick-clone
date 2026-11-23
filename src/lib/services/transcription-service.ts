/**
 * Transcrição da fala de um vídeo como um TRABALHO próprio ("Transcrição · video.mp4", "Prévia pronta"):
 * transcreve (tempos por palavra), divide em cenas de até 8 s e registra cada etapa.
 *
 * Roda de forma síncrona dentro da requisição — o trabalho já existe como "em andamento" enquanto
 * isso, então aparece na lista de Trabalhos desde o início. Enquanto roda, o `AbortController` fica em
 * `inFlight`: cancelar/excluir o trabalho aborta a chamada de verdade (ffmpeg + HTTP) e a conclusão só é
 * gravada se o trabalho ainda estiver "em andamento" (nunca ressuscita um trabalho cancelado/excluído).
 *
 * Se o servidor cair no meio, o trabalho ficaria "em andamento" para sempre: `recoverStuckTranscriptions`
 * (chamada no bootstrap) o marca como falho; `sweepStuckTranscriptions` repete isso periodicamente no tick
 * do worker, para o caso de o servidor voltar antes do prazo de 15 min.
 */
import { randomUUID } from 'node:crypto';
import { DEFAULT_MODEL } from '../catalog';
import { transaction } from '../db';
import { AppError } from '../errors';
import { addJobEvent } from '../repo/job-events';
import {
  cancelTranscriptionJob,
  completeTranscriptionJob,
  failTranscriptionJob,
  insertTranscriptionJob,
  listRunningTranscriptionIds,
} from '../repo/jobs';
import { findVideoRow, updateVideoTranscript } from '../repo/videos';
import { TRANSCRIPTION_STEP_LABELS as L } from '../transcription-steps';
import { alignWordsToSegments, estimateUnitsFromText, segmentsToUnits, splitScenes, wordsToUnits, type Scene, type SceneUnit } from '../scenes';
import { transcribeVideoFile, TranscriptionConfigError, type TranscriptionResult, type TranscriptionStep } from '../transcribe';

const STEP_LABEL: Record<TranscriptionStep, string> = {
  'audio-prepared': L.audioPrepared,
  sent: L.sent,
  received: L.received,
};

export const CANCELLED_MESSAGE = 'Transcrição cancelada';

export interface TranscriptionOutcome {
  jobId: string;
  text: string;
  scenes: Scene[];
}

/** Controladores das transcrições em andamento NESTE processo (globalThis: sobrevive ao hot-reload). */
declare global {
  // eslint-disable-next-line no-var
  var __coldclickTranscriptions: Map<string, AbortController> | undefined;
}
const inFlight = (): Map<string, AbortController> => (globalThis.__coldclickTranscriptions ??= new Map());

/** Prefere palavras alinhadas aos segmentos (pontuação + fins de frase); cai para segmentos e, por fim, para o texto. */
export function resultToUnits(result: Pick<TranscriptionResult, 'text' | 'words' | 'segments'>): SceneUnit[] {
  if (result.words.length) return result.segments.length ? alignWordsToSegments(result.words, result.segments) : wordsToUnits(result.words);
  if (result.segments.length) return segmentsToUnits(result.segments);
  return estimateUnitsFromText(result.text);
}

export async function transcribeVideoToScenes(videoId: string): Promise<TranscriptionOutcome> {
  const video = findVideoRow(videoId);
  if (!video) throw new AppError(404, 'Vídeo não encontrado');

  const jobId = randomUUID();
  const controller = new AbortController();
  transaction(() => {
    insertTranscriptionJob({
      id: jobId,
      title: `Transcrição · ${video.original_name}`,
      videoId,
      language: 'original',
      defaultModel: DEFAULT_MODEL,
    });
    addJobEvent(jobId, L.requested);
  });
  inFlight().set(jobId, controller);

  try {
    const result = await transcribeVideoFile(video.file_path, (step) => addJobEvent(jobId, STEP_LABEL[step]), controller.signal);
    controller.signal.throwIfAborted();

    const scenes = splitScenes(resultToUnits(result));
    if (!result.text || scenes.length === 0) throw new AppError(422, 'Nenhuma fala foi detectada neste vídeo.');

    const scenesJson = JSON.stringify(scenes);
    const text = scenes.map((s) => s.text).join('\n\n');
    const completed = transaction(() => {
      if (!completeTranscriptionJob(jobId, text, scenesJson)) return false; // cancelada/excluída no meio-tempo
      addJobEvent(jobId, L.split);
      updateVideoTranscript(videoId, text, result.language, scenesJson);
      return true;
    });
    if (!completed) throw new AppError(409, CANCELLED_MESSAGE);
    return { jobId, text, scenes };
  } catch (e) {
    if (controller.signal.aborted) throw new AppError(409, CANCELLED_MESSAGE);
    if (e instanceof AppError && e.status === 409) throw e;
    const error =
      e instanceof TranscriptionConfigError
        ? new AppError(412, e.message)
        : e instanceof AppError
          ? e
          : new AppError(502, e instanceof Error ? e.message : 'Falha na transcrição');
    transaction(() => {
      if (failTranscriptionJob(jobId, error.message)) addJobEvent(jobId, 'Falha na transcrição', 'failed');
    });
    throw error;
  } finally {
    inFlight().delete(jobId);
  }
}

/** Cancela uma transcrição em andamento (aborta a chamada de verdade). Retorna se havia o que cancelar. */
export function cancelTranscription(jobId: string): boolean {
  inFlight().get(jobId)?.abort();
  return transaction(() => {
    const cancelled = cancelTranscriptionJob(jobId);
    if (cancelled) addJobEvent(jobId, CANCELLED_MESSAGE, 'failed');
    return cancelled;
  });
}

/**
 * Prazo máximo de uma transcrição viva: a chamada HTTP tem teto de 10 min (+ extração do áudio). Passado isso,
 * uma transcrição "em andamento" só pode estar órfã.
 */
export const TRANSCRIPTION_STALE_MS = 15 * 60_000;

/**
 * Bootstrap: transcrições "em andamento" sem controlador neste processo ficaram órfãs (o servidor caiu
 * ou foi reiniciado durante a chamada). Marca como falhas, com evento, para não ficarem girando para sempre.
 *
 * Só recupera as iniciadas há mais de `TRANSCRIPTION_STALE_MS`: se outro processo usa o mesmo banco e acabou de
 * iniciar uma transcrição, ela não é derrubada por este boot. (`staleMs = 0` recupera todas — uso em testes.)
 */
export function recoverStuckTranscriptions(staleMs = TRANSCRIPTION_STALE_MS, now: number = Date.now()): number {
  let recovered = 0;
  for (const id of listRunningTranscriptionIds(new Date(now - staleMs + 1).toISOString())) {
    if (inFlight().has(id)) continue;
    transaction(() => {
      if (failTranscriptionJob(id, 'Interrompida: o servidor foi reiniciado durante a transcrição.')) {
        addJobEvent(id, 'Transcrição interrompida (servidor reiniciado)', 'failed');
        recovered++;
      }
    });
  }
  return recovered;
}

/** Intervalo mínimo entre varreduras periódicas (o tick do worker roda a cada segundo; a consulta não precisa). */
export const TRANSCRIPTION_SWEEP_INTERVAL_MS = 60_000;

declare global {
  // eslint-disable-next-line no-var
  var __coldclickTranscriptionSweepAt: number | undefined;
}

/**
 * Varredura PERIÓDICA (chamada pelo tick do worker): se o servidor cair e voltar em menos de
 * `TRANSCRIPTION_STALE_MS`, a órfã não seria pega pelo bootstrap — esta varredura a recupera assim que
 * passar do prazo, com o mesmo TTL e a mesma guarda de status (só `running`, nunca uma que tenha controlador
 * neste processo nem uma iniciada há menos que o prazo). Limitada a uma execução por intervalo.
 * Retorna quantas recuperou (0 se ainda não era hora de varrer).
 */
export function sweepStuckTranscriptions(now: number = Date.now()): number {
  const last = globalThis.__coldclickTranscriptionSweepAt;
  if (last !== undefined && now - last < TRANSCRIPTION_SWEEP_INTERVAL_MS) return 0;
  globalThis.__coldclickTranscriptionSweepAt = now;
  return recoverStuckTranscriptions(TRANSCRIPTION_STALE_MS, now);
}
