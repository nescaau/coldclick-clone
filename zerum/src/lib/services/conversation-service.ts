/**
 * Conversas do Diretor (persistidas): criar, renomear, trocar, apagar, anexar viral, opções. O pedido ao Diretor
 * (plano → confirmação → lote) está em director-service.ts.
 */
import { transaction } from '../db';
import { notFound } from '../errors';
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
import { plansByMessage } from '../repo/plans';
import { getViral, toViralDTO, type ViralRow } from '../repo/virals';
import { deleteEvents, logEvent } from '../repo/events';
import { analysisBullets, fmtDuration, readAnalysis } from '../domain/analysis';
import { DEFAULT_OPTIONS, mergeOptions } from '../domain/video-options';
import type { DirectorMode } from '../domain/director';
import { getSavedBalloonColor, saveBalloonColor } from './settings-service';
import { conversationBatches as batchesOf } from './production-service';
import type { BatchDTO, ConversationDetail, ConversationSummary, VideoOptions } from '../types';
import type { z } from 'zod';
import type { ConversationPatchSchema } from '../schemas';

export function readOptions(raw: string): VideoOptions {
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

export function toDetail(r: ConversationRow): ConversationDetail {
  const viral = r.viral_id ? getViral(r.viral_id) : undefined;
  const plans = plansByMessage(r.id);
  return {
    ...toSummary(r),
    options: readOptions(r.options),
    viral: viral ? toViralDTO(viral) : null,
    messages: listMessages(r.id).map((m) => ({ ...m, plan: plans.get(m.id) ?? null })),
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
  return batchesOf(id);
};

export function createConversation(input: { mode?: DirectorMode; viralId?: string | null } = {}): ConversationDetail {
  const options = mergeOptions({ ...DEFAULT_OPTIONS }, { bubbleColor: getSavedBalloonColor() });
  const row = transaction(() => {
    const r = insertConversation({ mode: input.mode ?? 'viral', options: JSON.stringify(options), viralId: input.viralId ?? null });
    logEvent('conversation', r.id, 'Conversa criada.');
    return r;
  });
  return toDetail(row);
}

/** Resposta do Diretor quando um viral entra na conversa. HONESTA: só relata o que o arquivo informa (não houve IA). */
export function viralAnnouncement(v: ViralRow): string {
  const dto = toViralDTO(v);
  const a = readAnalysis(v.analysis);
  const facts = [fmtDuration(dto.durationS), ...(a ? analysisBullets(a, dto) : [])].filter(Boolean);
  return (
    `Li os dados do viral "${v.name.replace(/\.mp4$/i, '')}": ${facts.join(' · ') || 'arquivo guardado'}. ` +
    'Gancho, estrutura e falas ainda não foram lidos (a IA que assiste o vídeo é a fase futura) — preencha em “A leitura errou? Corrigir” se quiser que o plano use. ' +
    'O que você quer fazer?'
  );
}

/** Aplica título/modo/viral/opções (o que vier no patch) a uma conversa. Chamar dentro de transaction(). */
function applyPatch(id: string, currentOptions: string, currentViralId: string | null, patch: z.infer<typeof ConversationPatchSchema>): void {
  if (patch.title !== undefined) updateConversation(id, { title: patch.title, titleManual: true });
  if (patch.mode !== undefined) updateConversation(id, { mode: patch.mode });
  if (patch.viralId !== undefined) {
    const viral = patch.viralId !== null ? getViral(patch.viralId) : undefined;
    if (patch.viralId !== null && !viral) throw notFound('Viral');
    updateConversation(id, { viralId: patch.viralId });
    if (patch.viralId === currentViralId) {
      /* mesmo viral: nada novo para anunciar */
    } else if (viral) {
      insertMessage(id, 'diretor', viralAnnouncement(viral));
      logEvent('conversation', id, `Viral “${viral.name}” entrou na conversa.`);
    } else {
      logEvent('conversation', id, 'O viral saiu da conversa (a análise continua em Analisados).');
    }
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
      const fresh = insertConversation({ mode: 'viral', options: row.options, viralId: null });
      logEvent('conversation', fresh.id, 'Conversa aberta com o viral trocado (a anterior ficou como estava).');
      applyPatch(fresh.id, fresh.options, null, patch);
      return fresh.id;
    });
    return getDetail(freshId);
  }

  transaction(() => applyPatch(id, row.options, row.viral_id, patch));
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
