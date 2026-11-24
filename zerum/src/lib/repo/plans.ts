import { getDb, newId, nowIso } from '../db';
import type { PlanParams, PlanStep } from '../domain/plan';
import type { PlanDTO } from '../types';

interface PlanRow {
  id: string;
  conversation_id: string;
  message_id: string | null;
  state: PlanDTO['state'];
  steps: string;
  params: string;
  batch_id: string | null;
}

const toDTO = (r: PlanRow): PlanDTO => ({
  id: r.id,
  requerConfirmacao: true,
  state: r.state,
  steps: JSON.parse(r.steps) as PlanStep[],
  params: JSON.parse(r.params) as PlanParams,
  batchId: r.batch_id,
});

export function insertPlan(p: { conversationId: string; messageId: string | null; steps: PlanStep[]; params: PlanParams }): PlanDTO {
  const id = newId();
  const now = nowIso();
  getDb()
    .prepare('INSERT INTO plans (id, conversation_id, message_id, steps, params, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?)')
    .run(id, p.conversationId, p.messageId, JSON.stringify(p.steps), JSON.stringify(p.params), now, now);
  return getPlan(id)!;
}

export const getPlan = (id: string): PlanDTO | undefined => {
  const r = getDb().prepare('SELECT * FROM plans WHERE id = ?').get(id) as PlanRow | undefined;
  return r ? toDTO(r) : undefined;
};

export const getPlanConversation = (id: string): string | undefined =>
  (getDb().prepare('SELECT conversation_id FROM plans WHERE id = ?').get(id) as { conversation_id: string } | undefined)?.conversation_id;

export const pendingPlans = (conversationId: string): PlanDTO[] =>
  (getDb().prepare("SELECT * FROM plans WHERE conversation_id = ? AND state = 'pendente' ORDER BY created_at ASC, rowid ASC").all(conversationId) as PlanRow[]).map(toDTO);

/** Planos de uma conversa por mensagem (a UI mostra o cartão do plano dentro da mensagem do Diretor). */
export function plansByMessage(conversationId: string): Map<string, PlanDTO> {
  const rows = getDb().prepare('SELECT * FROM plans WHERE conversation_id = ? AND message_id IS NOT NULL').all(conversationId) as PlanRow[];
  return new Map(rows.map((r) => [r.message_id as string, toDTO(r)]));
}

export const setPlanMessage = (id: string, messageId: string): void => {
  getDb().prepare('UPDATE plans SET message_id = ?, updated_at = ? WHERE id = ?').run(messageId, nowIso(), id);
};

export function setPlanState(id: string, state: PlanDTO['state'], batchId?: string | null): void {
  getDb().prepare('UPDATE plans SET state = ?, batch_id = COALESCE(?, batch_id), updated_at = ? WHERE id = ?').run(state, batchId ?? null, nowIso(), id);
}
