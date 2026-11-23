/**
 * PONTE site ⇄ extensão — INTERFACES da fase futura (nada aqui fala com extensão nem com rede).
 *
 * Desenho derivado do protocolo da extensão Zerum 0.4.18 (leitura de reference/zerum-001/extensao-0.4.18/site-iso.js):
 *
 *   site  → extensão   window.postMessage({ zre: 'request',  id, action, payload }, location.origin)
 *   extensão → site    window.postMessage({ zre: 'response', id, result } | { zre: 'response', id, error }, location.origin)
 *   extensão → site    window.postMessage({ zre: 'flow-health',  health },  …)   // saúde sanitizada (nunca token/journal)
 *   extensão → site    window.postMessage({ zre: 'flow-credits', status },  …)   // aviso de saldo baixo
 *
 * Regras que o executor futuro DEVE respeitar (do original):
 *  - só aceita mensagens com `e.source === window` e `e.origin === location.origin`;
 *  - `id` é string de 1..128 caracteres; ações fora da lista são ignoradas;
 *  - sem resposta em 25 s → erro `EXTENSAO_SEM_RESPOSTA; pedido preservado, não gerar outra vez`
 *    (o pedido NÃO é reenviado automaticamente: reconciliar, nunca repetir o submit).
 *
 * Aqui no clone NÃO existe a ação `connect` do original (ela trocava a sessão logada da 001 por um código de
 * membro `ZR-XXXX-XXXX-XXXX`): sem login, o pareamento futuro será local (token gerado pelo próprio app).
 */
import { z } from 'zod';

export const BRIDGE_TIMEOUT_MS = 25_000;

/** Mensagem literal do original quando a extensão não responde. */
export const ERR_NO_RESPONSE = 'EXTENSAO_SEM_RESPOSTA; pedido preservado, não gerar outra vez';

/** Ações aceitas pela ponte (a `connect` do original foi removida — ver comentário acima). */
export const BRIDGE_ACTIONS = [
  'extensionStatus',
  'accounts',
  'enqueue',
  'get',
  'reconcile',
  'download',
  'job',
  'beginAttempt',
  'mediaState',
  'recoverJob',
] as const;
export type BridgeAction = (typeof BRIDGE_ACTIONS)[number];

export const BridgeRequestSchema = z.object({
  zre: z.literal('request'),
  id: z.string().min(1).max(128),
  action: z.enum(BRIDGE_ACTIONS),
  payload: z.unknown().optional(),
});
export type BridgeRequest = z.infer<typeof BridgeRequestSchema>;

export const BridgeResponseSchema = z
  .object({
    zre: z.literal('response'),
    id: z.string().min(1).max(128),
    result: z.unknown().optional(),
    error: z.string().max(200).optional(),
  })
  .refine((r) => r.result !== undefined || r.error !== undefined, { message: 'resposta sem result nem error' });
export type BridgeResponse = z.infer<typeof BridgeResponseSchema>;

/** Contexto de conta do Flow, como o site o seleciona no original. */
export interface FlowContext {
  accountId: string;
  projectId: string;
  accountPath: string;
}

/** Valida uma mensagem recebida: só devolve a resposta se o `id` é de um pedido pendente. */
export function matchResponse(pending: ReadonlySet<string>, data: unknown): BridgeResponse | null {
  const parsed = BridgeResponseSchema.safeParse(data);
  if (!parsed.success) return null;
  return pending.has(parsed.data.id) ? parsed.data : null;
}

/** Mensagens `flow-health`/`flow-credits` são push da extensão (sem id). */
export const BridgePushSchema = z.discriminatedUnion('zre', [
  z.object({ zre: z.literal('flow-health'), health: z.unknown().nullable() }),
  z.object({ zre: z.literal('flow-credits'), status: z.unknown().nullable() }),
]);
