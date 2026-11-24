/**
 * Lote pela aba MANUAL (sem conversa nem confirmação: "GERAR" cria o lote e abre a Produção).
 * O ciclo de vida do lote (fila → gerando → pronto, cancelar, regerar…) está em production-service.ts.
 */
import { notFound } from '../errors';
import { getViral } from '../repo/virals';
import { DEFAULT_OPTIONS, mergeOptions } from '../domain/video-options';
import { getSavedBalloonColor } from './settings-service';
import { namesOf } from './avatar-service';
import { openBatch } from './production-service';
import type { BatchDTO, VideoOptions } from '../types';
import type { ManualBatchSchema } from '../schemas';
import type { z } from 'zod';

export function createManualBatch(input: z.infer<typeof ManualBatchSchema>): BatchDTO {
  const viral = getViral(input.viralId);
  if (!viral) throw notFound('Viral');
  const options = mergeOptions({ ...DEFAULT_OPTIONS, bubbleColor: getSavedBalloonColor() }, input.options as Partial<VideoOptions>);
  const q = input.quantity;
  return openBatch({
    conversationId: null,
    viralId: viral.id,
    source: 'manual',
    title: `${options.batchName || viral.name.replace(/\.mp4$/i, '')} · ${q} vídeo${q === 1 ? '' : 's'}`,
    params: {
      quantity: q,
      path: input.path,
      variation: input.variation,
      language: options.language,
      word: options.word,
      batchName: options.batchName,
      bubbleOn: options.bubbleOn,
      bubbleColor: options.bubbleColor,
      notes: input.notes,
      newAvatars: input.newAvatars,
    },
    avatarNames: input.newAvatars > 0 ? [] : namesOf(input.avatarIds),
    requestText: input.notes,
  });
}
