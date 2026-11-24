/**
 * Broker de operações do Flow — máquina de estados e política de cota. Este arquivo é o ESPELHO, no app, das regras que a
 * extensão do Zerum (zerum/extensao/background/broker.js) aplica de verdade; um teste de contrato
 * (extensao/test/contract.test.mjs) garante que os dois lados não divergem.
 *
 * Do README da extensão 0.4.18 (a semântica reproduzida):
 *   queued → dispatched → accepted → completed / failed / unknown
 *  - `accepted` exige polling/download antes de devolver o resultado.
 *  - queda de aba/servidor, timeout e entrega incerta ⇒ `unknown`: preserva o lock e NÃO reenfileira a geração.
 *  - chave estável por job/contexto/comando/argumentos impede repetição após resposta perdida.
 *  - resultados ficam num outbox persistente (chrome.storage.local); confirmação perdida repete a ENTREGA do
 *    resultado, nunca a geração.
 *  - cota: 429/QUOTA/COTA pausa 24 h; INCOMUM/UNUSUAL/RESOURCE_EXHAUSTED pausa 5 min;
 *    nunca troca de conta/modelo para contornar cota.
 */
import type { FlowContext } from './protocol';

export const BROKER_STATES = ['queued', 'dispatched', 'accepted', 'completed', 'failed', 'unknown'] as const;
export type BrokerState = (typeof BROKER_STATES)[number];

const NEXT: Record<BrokerState, readonly BrokerState[]> = {
  queued: ['dispatched', 'failed'],
  dispatched: ['accepted', 'failed', 'unknown'],
  accepted: ['completed', 'failed', 'unknown'],
  // `unknown` só sai por reconciliação (leitura): vira completed/failed. Jamais volta a queued/dispatched.
  unknown: ['completed', 'failed'],
  completed: [],
  failed: [],
};

export const canTransition = (from: BrokerState, to: BrokerState): boolean => NEXT[from].includes(to);
export const isTerminal = (s: BrokerState): boolean => NEXT[s].length === 0;
/** Estados em que reenviar o pedido é PROIBIDO (já pode ter saído para o Google). */
export const forbidsResubmit = (s: BrokerState): boolean => s !== 'queued';

export type RefusalKind = 'cota' | 'incomum';

export const QUOTA_PAUSE_MS = 24 * 60 * 60 * 1000;
export const SOFT_PAUSE_MS = 5 * 60 * 1000;

/**
 * Classifica o texto de recusa do Google/extensão. A cota vence quando o texto tem as duas coisas.
 * Mesmo critério do broker da extensão (extensao/lib/protocol.js — o teste de contrato compara os dois), que casa
 * códigos compostos como `COTA_HTTP_429` e `PUBLIC_ERROR_DAILY_QUOTA_REACHED` (por isso sem `\b`: o `_` é "letra").
 */
export function classifyRefusal(text: string): RefusalKind | null {
  const t = String(text ?? '');
  if (/QUOTA|COTA|(?<![0-9])429(?![0-9])/i.test(t)) return 'cota';
  if (/INCOMUM|UNUSUAL|RESOURCE_EXHAUSTED/i.test(t)) return 'incomum';
  return null;
}

export const pauseUntil = (kind: RefusalKind, now = Date.now()): number =>
  now + (kind === 'cota' ? QUOTA_PAUSE_MS : SOFT_PAUSE_MS);

/** Registro de uma operação no journal da extensão (forma desejada; ainda não persistido em lugar nenhum). */
export interface OperationRecord {
  /** Chave de idempotência estável: job + contexto + comando + argumentos. */
  key: string;
  jobId: string;
  context: FlowContext;
  command: string;
  state: BrokerState;
  attempt: number;
  createdAt: string;
  updatedAt: string;
  error?: string;
}
