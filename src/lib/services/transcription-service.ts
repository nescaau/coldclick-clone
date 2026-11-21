/**
 * Transcrição da fala de um vídeo como um TRABALHO próprio ("Transcrição · video.mp4", "Prévia pronta"):
 * transcreve (tempos por palavra), divide em cenas de até 8 s e registra cada etapa.
 *
 * Roda de forma síncrona dentro da requisição — o trabalho já existe como "em andamento" enquanto
 * isso, então aparece na lista de Trabalhos desde o início.
 */
import { randomUUID } from 'node:crypto';
import { DEFAULT_MODEL } from '../catalog';
import { transaction } from '../db';
import { AppError } from '../errors';
import { addJobEvent } from '../repo/job-events';
import { completeTranscriptionJob, failTranscriptionJob, insertTranscriptionJob } from '../repo/jobs';
import { findVideoRow, updateVideoTranscript } from '../repo/videos';
import { estimateUnitsFromText, segmentsToUnits, splitScenes, wordsToUnits, type Scene } from '../scenes';
import { transcribeVideoFile, TranscriptionConfigError, type TranscriptionStep } from '../transcribe';

const STEP_LABEL: Record<TranscriptionStep, string> = {
  'audio-prepared': 'Áudio preparado para envio',
  sent: 'Áudio enviado ao serviço de transcrição',
  received: 'Transcrição recebida com tempos',
};

export interface TranscriptionOutcome {
  jobId: string;
  text: string;
  scenes: Scene[];
}

export async function transcribeVideoToScenes(videoId: string): Promise<TranscriptionOutcome> {
  const video = findVideoRow(videoId);
  if (!video) throw new AppError(404, 'Vídeo não encontrado');

  const jobId = randomUUID();
  transaction(() => {
    insertTranscriptionJob({
      id: jobId,
      title: `Transcrição · ${video.original_name}`,
      videoId,
      language: 'original',
      defaultModel: DEFAULT_MODEL,
    });
    addJobEvent(jobId, 'Transcrição solicitada');
  });

  try {
    const result = await transcribeVideoFile(video.file_path, (step) => addJobEvent(jobId, STEP_LABEL[step]));

    // Prefere tempos por palavra; cai para segmentos e, por fim, para uma estimativa pelo texto.
    const units = result.words.length
      ? wordsToUnits(result.words)
      : result.segments.length
        ? segmentsToUnits(result.segments)
        : estimateUnitsFromText(result.text);
    const scenes = splitScenes(units);
    if (!result.text || scenes.length === 0) throw new AppError(422, 'Nenhuma fala foi detectada neste vídeo.');

    const scenesJson = JSON.stringify(scenes);
    const text = scenes.map((s) => s.text).join('\n\n');
    transaction(() => {
      addJobEvent(jobId, 'Fala dividida em cenas');
      completeTranscriptionJob(jobId, text, scenesJson);
      updateVideoTranscript(videoId, text, result.language, scenesJson);
    });
    return { jobId, text, scenes };
  } catch (e) {
    const error =
      e instanceof TranscriptionConfigError
        ? new AppError(412, e.message)
        : e instanceof AppError
          ? e
          : new AppError(502, e instanceof Error ? e.message : 'Falha na transcrição');
    transaction(() => {
      addJobEvent(jobId, 'Falha na transcrição', 'failed');
      failTranscriptionJob(jobId, error.message);
    });
    throw error;
  }
}
