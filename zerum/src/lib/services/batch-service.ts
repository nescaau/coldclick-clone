/**
 * Lotes (aba PRODUÇÃO). NESTA FASE não há geração: todo lote nasce e fica em "preparando", com log local.
 * A transição para na_fila/rodando/pronto é do executor (fase futura, via extensão) — ver lib/bridge.
 */
import { badRequest, conflict, notFound } from '../errors';
import { transaction } from '../db';
import { logEvent, deleteEvents, listEvents } from '../repo/events';
import { deleteBatch, getBatch, insertBatch, listBatches, setBatchState, type NewBatch } from '../repo/batches';
import { getViral } from '../repo/virals';
import { languageName, mergeOptions, DEFAULT_OPTIONS, optionsSummary } from '../domain/video-options';
import { getSavedBalloonColor } from './settings-service';
import type { BatchDTO, EventDTO, VideoOptions } from '../types';
import { ManualBatchSchema } from '../schemas';
import type { z } from 'zod';

/** Cria o lote em "preparando" e registra o log inicial. Reutilizado pelo Diretor e pelo Manual. */
export function openBatch(input: NewBatch): BatchDTO {
  return transaction(() => {
    const batch = insertBatch(input);
    const options: VideoOptions = {
      word: input.word,
      batchName: input.batchName,
      bubbleOn: input.bubbleOn,
      bubbleColor: input.bubbleColor,
      language: input.language,
    };
    logEvent('batch', batch.id, `Lote criado (${input.source === 'diretor' ? 'pelo Diretor' : 'manual'}): ${input.quantity} vídeo(s).`);
    logEvent('batch', batch.id, `Opções: ${optionsSummary(options)} · cor ${input.bubbleColor} · idioma ${languageName(input.language)}.`);
    logEvent('batch', batch.id, input.viralId ? 'Estrutura vem do viral anexado (guardado só neste computador).' : 'Sem viral: lote a partir da ideia escrita.');
    logEvent('batch', batch.id, 'Sem Flow nem Antigravity nesta fase: nenhuma chamada externa foi feita.', 'aviso');
    logEvent('batch', batch.id, 'Estado: preparando — aguardando o executor (fase futura). O lote fica guardado até lá.');
    return batch;
  });
}

export const listAllBatches = (): BatchDTO[] => listBatches();

/** PRODUÇÃO = lotes que ainda não foram cancelados/entregues. */
export const listProduction = (): BatchDTO[] => listBatches().filter((b) => b.state !== 'cancelado' && b.state !== 'pronto');

export function batchEvents(id: string): EventDTO[] {
  if (!getBatch(id)) throw notFound('Lote');
  return listEvents('batch', id);
}

export function createManualBatch(input: z.infer<typeof ManualBatchSchema>): BatchDTO {
  const viral = getViral(input.viralId);
  if (!viral) throw notFound('Viral');
  const options = mergeOptions({ ...DEFAULT_OPTIONS, bubbleColor: getSavedBalloonColor() }, input.options as Partial<VideoOptions>);
  return openBatch({
    conversationId: null,
    viralId: viral.id,
    source: 'manual',
    title: `${options.batchName || viral.name.replace(/\.mp4$/i, '')} · ${input.quantity} vídeo${input.quantity === 1 ? '' : 's'}`,
    quantity: input.quantity,
    word: options.word,
    batchName: options.batchName,
    bubbleOn: options.bubbleOn,
    bubbleColor: options.bubbleColor,
    language: options.language,
    requestText: '',
  });
}

export function cancelBatch(id: string): BatchDTO {
  const b = getBatch(id);
  if (!b) throw notFound('Lote');
  if (b.state === 'cancelado') return b;
  if (b.state !== 'preparando') throw conflict(`Lote em "${b.state}" não pode ser cancelado por aqui.`);
  transaction(() => {
    setBatchState(id, 'cancelado');
    logEvent('batch', id, 'Lote cancelado pelo usuário. Nada havia sido enviado.');
  });
  return getBatch(id)!;
}

export function removeBatch(id: string): void {
  const b = getBatch(id);
  if (!b) throw notFound('Lote');
  if (b.state !== 'preparando' && b.state !== 'cancelado' && b.state !== 'falhou') throw badRequest('Cancele o lote antes de apagar.');
  transaction(() => {
    deleteBatch(id);
    deleteEvents('batch', id);
  });
}
