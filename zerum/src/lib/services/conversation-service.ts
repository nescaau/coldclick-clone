/**
 * Conversas do Diretor (persistidas). O Diretor do original é uma IA (Antigravity); aqui NÃO existe IA:
 * o "Diretor" é local e determinístico — registra o pedido, interpreta a quantidade ("faz 20", "3 vídeos"),
 * monta um lote em "preparando" e explica que a geração real é fase futura.
 */
import { transaction } from '../db';
import { badRequest, notFound } from '../errors';
import {
  countMessages,
  deleteConversation,
  getConversation,
  insertConversation,
  insertMessage,
  listConversations,
  listMessages,
  updateConversation,
  type ConversationRow,
} from '../repo/conversations';
import { getViral, toViralDTO } from '../repo/virals';
import { listBatchesByConversation } from '../repo/batches';
import { deleteEvents, logEvent } from '../repo/events';
import { conversationTitle, planRequest, type DirectorMode } from '../domain/director';
import { DEFAULT_OPTIONS, languageName, mergeOptions, optionsSummary } from '../domain/video-options';
import { getSavedBalloonColor, saveBalloonColor } from './settings-service';
import { openBatch } from './batch-service';
import { MAX_VIRAL_MB } from '../limits';
import type { BatchDTO, ConversationDetail, ConversationSummary, SendMessageResult, VideoOptions } from '../types';
import type { z } from 'zod';
import type { ConversationPatchSchema, SendMessageSchema } from '../schemas';

function readOptions(raw: string): VideoOptions {
  let parsed: Partial<VideoOptions> = {};
  try {
    parsed = JSON.parse(raw) as Partial<VideoOptions>;
  } catch {
    /* opções corrompidas voltam ao padrão */
  }
  return mergeOptions({ ...DEFAULT_OPTIONS }, parsed);
}

const toSummary = (r: ConversationRow): ConversationSummary => ({
  id: r.id,
  title: r.title,
  mode: r.mode,
  hasViral: !!r.viral_id,
  createdAt: r.created_at,
  updatedAt: r.updated_at,
});

function toDetail(r: ConversationRow): ConversationDetail {
  const viral = r.viral_id ? getViral(r.viral_id) : undefined;
  return {
    ...toSummary(r),
    options: readOptions(r.options),
    viral: viral ? toViralDTO(viral) : null,
    messages: listMessages(r.id),
  };
}

export const listAll = (): ConversationSummary[] => listConversations().map(toSummary);

export function getDetail(id: string): ConversationDetail {
  const row = getConversation(id);
  if (!row) throw notFound('Conversa', true);
  return toDetail(row);
}

export const conversationBatches = (id: string): BatchDTO[] => {
  if (!getConversation(id)) throw notFound('Conversa', true);
  return listBatchesByConversation(id);
};

export function createConversation(input: { mode?: DirectorMode; viralId?: string | null } = {}): ConversationDetail {
  const options = mergeOptions({ ...DEFAULT_OPTIONS }, { bubbleColor: getSavedBalloonColor() });
  const row = insertConversation({ mode: input.mode ?? 'viral', options: JSON.stringify(options), viralId: input.viralId ?? null });
  return toDetail(row);
}

/** Aplica título/modo/viral/opções (o que vier no patch) a uma conversa. Chamar dentro de transaction(). */
function applyPatch(id: string, currentOptions: string, patch: z.infer<typeof ConversationPatchSchema>): void {
  if (patch.title !== undefined) updateConversation(id, { title: patch.title, titleManual: true });
  if (patch.mode !== undefined) updateConversation(id, { mode: patch.mode });
  if (patch.viralId !== undefined) {
    if (patch.viralId !== null && !getViral(patch.viralId)) throw notFound('Viral');
    updateConversation(id, { viralId: patch.viralId });
  }
  if (patch.options !== undefined) {
    const next = mergeOptions(readOptions(currentOptions), patch.options as Partial<VideoOptions>);
    updateConversation(id, { options: JSON.stringify(next) });
    if (patch.options.bubbleColor !== undefined) saveBalloonColor(next.bubbleColor);
  }
}

export function patchConversation(id: string, patch: z.infer<typeof ConversationPatchSchema>): ConversationDetail {
  const row = getConversation(id);
  if (!row) throw notFound('Conversa', true);

  // "Trocar o viral abre uma conversa nova com ele": com mensagens na conversa, o viral novo vai para uma conversa nova
  // (a anterior fica como estava). Os DEMAIS campos do mesmo PATCH (título, modo, opções) valem para a conversa nova —
  // nenhum é descartado em silêncio.
  if (patch.viralId !== undefined && patch.viralId !== null && patch.viralId !== row.viral_id && countMessages(id) > 0) {
    if (!getViral(patch.viralId)) throw notFound('Viral');
    const freshId = transaction(() => {
      const fresh = insertConversation({ mode: 'viral', options: row.options, viralId: patch.viralId });
      logEvent('conversation', fresh.id, 'Conversa aberta com o viral trocado (a anterior ficou como estava).');
      const { viralId: _viral, ...rest } = patch;
      applyPatch(fresh.id, fresh.options, rest);
      return fresh.id;
    });
    return getDetail(freshId);
  }

  transaction(() => applyPatch(id, row.options, patch));
  return getDetail(id);
}

export function removeConversation(id: string): void {
  if (!getConversation(id)) throw notFound('Conversa', true);
  transaction(() => {
    deleteConversation(id);
    deleteEvents('conversation', id);
  });
}

/** Garante que a conversa existe (usado antes de gravar um upload, para não deixar viral órfão). */
export function assertConversationExists(id: string): void {
  if (!getConversation(id)) throw notFound('Conversa', true);
}

/** Anexa um viral recém-enviado à conversa (usado pelo upload). Mesma regra de "trocar viral" do PATCH. */
export const attachViral = (conversationId: string, viralId: string): ConversationDetail =>
  patchConversation(conversationId, { viralId });

export function sendMessage(id: string, input: z.infer<typeof SendMessageSchema>): SendMessageResult {
  const row = getConversation(id);
  if (!row) throw notFound('Conversa', true);
  const text = input.text.trim();
  if (!text && input.attachments.length === 0) throw badRequest('Escreva o pedido ao Diretor.');

  const options = readOptions(row.options);
  const viral = row.viral_id ? getViral(row.viral_id) : undefined;
  const plan = planRequest({ mode: row.mode, hasViral: !!viral, text });

  let batch: BatchDTO | null = null;
  transaction(() => {
    insertMessage(id, 'aluna', text, input.attachments);
    if (!plan.ok) {
      const reply =
        plan.reason === 'sem-viral'
          ? `Primeiro arraste o vídeo viral acima (MP4 até ${MAX_VIRAL_MB} MB) — ou troque para “A partir da sua ideia” se quiser criar sem viral. Depois me diga o que você quer.`
          : 'Me conta o que você quer que eu monte.';
      insertMessage(id, 'diretor', reply);
      logEvent('conversation', id, `Pedido ainda não vira lote (${plan.reason}).`, 'aviso');
    } else {
      const n = plan.quantity;
      const origem = viral ? `a partir de “${viral.name}”` : 'a partir da sua ideia';
      const titleSoFar = conversationTitle(listMessages(id));
      batch = openBatch({
        conversationId: id,
        viralId: viral?.id ?? null,
        source: 'diretor',
        title: options.batchName || titleSoFar,
        quantity: n,
        word: options.word,
        batchName: options.batchName,
        bubbleOn: options.bubbleOn,
        bubbleColor: options.bubbleColor,
        language: options.language,
        requestText: text,
      });
      insertMessage(
        id,
        'diretor',
        `Entendi: ${n} vídeo${n === 1 ? '' : 's'} em ${languageName(options.language)}, ${origem}.\n` +
          `Montei o lote “${batch.title}” e ele já aparece em PRODUÇÃO como “preparando” (${optionsSummary(options)}).\n\n` +
          'Esta é a versão local do Zerum: ainda não há executor, então nada foi gerado nem enviado a lugar nenhum — a geração real (Flow, pela extensão) é a próxima fase.',
      );
    }
    const fresh = getConversation(id)!;
    if (!fresh.title_manual) {
      updateConversation(id, { title: conversationTitle(listMessages(id)) });
    } else {
      updateConversation(id, {});
    }
  });
  return { conversation: getDetail(id), batch };
}
