/**
 * O Diretor (chat que monta lotes). LOCAL e determinístico — sem IA (o original usa o Antigravity, que aqui não existe).
 *
 * Fluxo "o Diretor mostra os passos, você confirma, e a ferramenta executa":
 *   pedido em texto → PLANO (passos, `requerConfirmacao`) → o usuário confirma → lote em PRODUÇÃO.
 * Pedir de novo ("faz 20", "troca a abertura") refina o plano pendente: o anterior vira "substituído".
 * Com "Aprovar tudo automaticamente" (⚙) o plano executa sem clique.
 */
import { transaction } from '../db';
import { badRequest, conflict, notFound } from '../errors';
import { MAX_VIRAL_MB } from '../limits';
import {
  getConversation,
  insertMessage,
  listMessages,
  updateConversation,
} from '../repo/conversations';
import { getPlan, getPlanConversation, insertPlan, pendingPlans, setPlanMessage, setPlanState } from '../repo/plans';
import { logEvent } from '../repo/events';
import { getViral } from '../repo/virals';
import { conversationTitle } from '../domain/director';
import { buildSteps, executeLabel, interpretRequest, type PlanParams } from '../domain/plan';
import { listAvatarRows } from '../repo/avatars';
import { getDetail, readOptions } from './conversation-service';
import { executionMode } from './bridge-service';
import { openBatch } from './production-service';
import { getSettings } from './settings-service';
import { namesOf } from './avatar-service';
import type { BatchDTO, PlanDTO, SendMessageResult } from '../types';
import type { z } from 'zod';
import type { SendMessageSchema } from '../schemas';

/** Parâmetros-base de um plano novo, a partir das opções da conversa. */
function baseParams(conv: { mode: PlanParams['mode']; options: ReturnType<typeof readOptions> }, viralId: string | null): PlanParams {
  const o = conv.options;
  return {
    mode: conv.mode,
    viralId,
    quantity: 1,
    path: 'igual',
    variation: 'sem',
    avatarIds: [],
    newAvatars: 0,
    language: o.language,
    word: o.word,
    batchName: o.batchName,
    bubbleOn: o.bubbleOn,
    bubbleColor: o.bubbleColor,
    notes: '',
  };
}

const plural = (n: number, one: string, many: string) => (n === 1 ? one : many);

/** Quem aparece: ids escolhidos → nomes; sem escolha, os avatares salvos (até a quantidade de vídeos). */
function resolveAvatarNames(p: PlanParams): string[] {
  if (p.newAvatars > 0) return [];
  if (p.avatarIds.length > 0) return namesOf(p.avatarIds);
  return [...listAvatarRows()].reverse().slice(0, Math.max(1, p.quantity)).map((r) => r.name);
}

export function sendMessage(id: string, input: z.infer<typeof SendMessageSchema>): SendMessageResult {
  const row = getConversation(id);
  if (!row) throw notFound('Conversa', true);
  const text = input.text.trim();
  if (!text && input.attachments.length === 0) throw badRequest('Escreva o pedido ao Diretor.');

  const options = readOptions(row.options);
  const viral = row.viral_id ? getViral(row.viral_id) : undefined;

  let plan: PlanDTO | null = null;
  let batch: BatchDTO | null = null;

  transaction(() => {
    insertMessage(id, 'aluna', text, input.attachments);

    if (!text) {
      insertMessage(id, 'diretor', 'Me conta o que você quer que eu monte.');
      logEvent('conversation', id, 'Pedido só com anexo: o Diretor precisa de texto para montar o plano.', 'aviso');
    } else if (row.mode === 'viral' && !viral) {
      insertMessage(
        id,
        'diretor',
        `Primeiro arraste o vídeo viral acima (MP4 até ${MAX_VIRAL_MB} MB) — ou troque para “A partir da sua ideia” se quiser criar sem viral. Depois me diga o que você quer.`,
      );
      logEvent('conversation', id, 'Pedido ainda não vira plano (sem viral).', 'aviso');
    } else {
      // Refinamento: parte do plano pendente (se houver); o anterior vira "substituído".
      const pending = pendingPlans(id);
      const previous = pending.length ? pending[pending.length - 1] : null;
      for (const p of pending) setPlanState(p.id, 'substituido');
      const base: PlanParams = previous
        ? { ...previous.params, viralId: viral?.id ?? null, mode: row.mode, language: options.language, word: options.word, batchName: options.batchName, bubbleOn: options.bubbleOn, bubbleColor: options.bubbleColor }
        : baseParams({ mode: row.mode, options }, viral?.id ?? null);
      const { params, entendi } = interpretRequest(text, base);

      const titleSoFar = conversationTitle(listMessages(id));
      const batchTitle = options.batchName || titleSoFar;
      const steps = buildSteps(params, { viralName: viral?.name.replace(/\.mp4$/i, '') ?? null, avatarNames: resolveAvatarNames(params), batchTitle });
      plan = insertPlan({ conversationId: id, messageId: null, steps, params });

      const entendiTxt = entendi.length ? `Entendi: ${entendi.join(' · ')}. ` : '';
      const msg = insertMessage(
        id,
        'diretor',
        `${entendiTxt}Fechado. Confira o plano aqui embaixo e clique em ${executeLabel(steps.length)} — ou diga o que quer mudar.`,
      );
      setPlanMessage(plan.id, msg.id);
      plan = getPlan(plan.id)!;
      logEvent('conversation', id, `Plano montado (${steps.length} passos) — aguardando confirmação.`);
    }

    const fresh = getConversation(id)!;
    if (!fresh.title_manual) updateConversation(id, { title: conversationTitle(listMessages(id)) });
    else updateConversation(id, {});
  });

  // "Aprovar tudo automaticamente": o plano passa direto (como o original, que registra isso no log).
  if (plan && getSettings().autoApprove) {
    const r = confirmPlan((plan as PlanDTO).id, { auto: true });
    batch = r.batch;
    plan = getPlan((plan as PlanDTO).id) ?? plan;
  }
  return { conversation: getDetail(id), batch, plan };
}

/** "Executar N passos" / "Sim, confirmar plano": o plano vira lote em PRODUÇÃO. */
export function confirmPlan(planId: string, opts: { auto?: boolean } = {}): { conversation: ReturnType<typeof getDetail>; batch: BatchDTO } {
  const plan = getPlan(planId);
  const convId = getPlanConversation(planId);
  if (!plan || !convId) throw notFound('Plano');
  if (plan.state !== 'pendente') throw conflict(plan.state === 'executado' ? 'Esse plano já foi executado.' : 'Esse plano não está mais valendo — use o mais recente.');
  const row = getConversation(convId);
  if (!row) throw notFound('Conversa', true);

  const p = plan.params;
  const viral = p.viralId ? getViral(p.viralId) : undefined;
  if (p.mode === 'viral' && !viral) throw conflict('O viral deste plano saiu da conversa. Coloque o viral de novo e peça outra vez.');

  const options = readOptions(row.options);
  const title = options.batchName || p.batchName || conversationTitle(listMessages(convId));
  const names = resolveAvatarNames(p);

  const batch = transaction(() => {
    const b = openBatch({
      conversationId: convId,
      viralId: viral?.id ?? null,
      source: 'diretor',
      title,
      params: p,
      avatarNames: names,
      requestText: p.notes,
    });
    setPlanState(planId, 'executado', b.id);
    insertMessage(
      convId,
      'diretor',
      'Executando o que você confirmou, na ordem. A produção aparece aqui ao lado e em Produção; cada vídeo pronto entra em Vídeos.\n\n' +
        `Feito: lote "${b.title}" montado com ${b.videos.length} vídeo${plural(b.videos.length, '', 's')}, ${b.videos[0]?.scenesTotal ?? 0} cena${plural(b.videos[0]?.scenesTotal ?? 0, '', 's')} cada. Acompanhe no painel Produção; cada vídeo pronto entra em Vídeos.` +
        {
          simulado: '\n\nA geração está SIMULADA (⚙ → Simulação local): as cenas avançam pelo relógio e o vídeo “pronto” é uma cópia do viral (selo SIMULADO). Para gerar de verdade no Flow, conecte a extensão e desligue a simulação.',
          real: '\n\nO Flow está conectado: cada cena será gerada de verdade na sua conta (gasta crédito do Flow) e o vídeo pronto é o MP4 baixado de lá. Deixe esta aba do Zerum aberta enquanto gera.',
          espera: '\n\nSem a extensão do Flow conectada (EXTENSAO_NAO_INSTALADA), o lote fica na fila e nada é enviado a lugar nenhum. Use “Conectar o Flow” para gerar de verdade.',
        }[executionMode()],
    );
    logEvent('conversation', convId, opts.auto ? 'Plano executado automaticamente (Aprovar tudo ligado no ⚙).' : 'Plano confirmado e executado.');
    updateConversation(convId, {});
    return b;
  });
  return { conversation: getDetail(convId), batch };
}

/** Cancelar o plano pendente (o usuário desistiu dos passos). */
export function cancelPlan(planId: string): ReturnType<typeof getDetail> {
  const plan = getPlan(planId);
  const convId = getPlanConversation(planId);
  if (!plan || !convId) throw notFound('Plano');
  if (plan.state !== 'pendente') throw conflict('Esse plano não está pendente.');
  transaction(() => {
    setPlanState(planId, 'cancelado');
    insertMessage(convId, 'diretor', 'Plano cancelado. Nada foi executado — diga o que você quer mudar e eu monto outro.');
    logEvent('conversation', convId, 'Plano cancelado pelo usuário.');
    updateConversation(convId, {});
  });
  return getDetail(convId);
}
