/**
 * PONTE site ⇄ extensão — o CONTRATO de mensagens (lado do site; o da extensão é extensao/lib/protocol.js e o teste de
 * contrato os compara).
 *
 * Desenho derivado do protocolo da extensão Zerum 0.4.18 (leitura de reference/zerum-001/extensao-0.4.18/site-iso.js):
 *
 *   site  → extensão   window.postMessage({ zre: 'request',  id, action, payload }, location.origin)
 *   extensão → site    window.postMessage({ zre: 'response', id, result } | { zre: 'response', id, error, code?, retryable?, retryAt? }, …)
 *   extensão → site    window.postMessage({ zre: 'flow-health',  health },  …)   // saúde sanitizada (nunca token/journal)
 *   extensão → site    window.postMessage({ zre: 'flow-credits', status },  …)   // aviso de saldo baixo (reservado)
 *
 * Regras (do original e respeitadas nas duas pontas):
 *  - só aceita mensagens com `e.source === window` e `e.origin === location.origin`;
 *  - `id` é string de 1..128 caracteres; ações fora da lista são ignoradas;
 *  - sem resposta em 25 s → erro `EXTENSAO_SEM_RESPOSTA; pedido preservado, não gerar outra vez`
 *    (o pedido NÃO é reenviado automaticamente: reconciliar, nunca repetir o submit).
 *
 * Aqui no clone NÃO existe a ação `connect` do original (ela trocava a sessão logada da 001 por um código de
 * membro `ZR-XXXX-XXXX-XXXX`): sem login e sem servidor, a "ligação" é local — a extensão só aceita a página do Zerum
 * em origem autorizada no popup.
 */
import { z } from 'zod';
import { BROKER_STATES } from './broker';

export const BRIDGE_TIMEOUT_MS = 25_000;

/** Nome do protocolo (versão do formato de mensagens e do journal da extensão). */
export const BRIDGE_PROTOCOL = 'zerum-local-flow-v1';

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
    /** Campos extras de erro que o site conhece (o original lê estes). */
    code: z.string().max(80).optional(),
    retryable: z.boolean().optional(),
    retryAt: z.number().optional(),
    action: z.string().max(40).optional(),
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
export type BridgePush = z.infer<typeof BridgePushSchema>;

// ─── formatos de resultado (o que a extensão devolve em cada ação) ──────────────────────────────────────────────────

export const FlowContextSchema = z.object({ accountId: z.string(), projectId: z.string(), accountPath: z.string() });

export const HEALTH_STATES = ['healthy', 'not-ready', 'closed', 'failed', 'recovering'] as const;
export const FlowHealthSchema = z
  .object({
    state: z.enum(HEALTH_STATES),
    detail: z.string().max(400).optional(),
    at: z.number().optional(),
    lastResponseAt: z.number().optional(),
    context: FlowContextSchema.nullable().optional(),
  })
  .passthrough();
export type FlowHealth = z.infer<typeof FlowHealthSchema>;

/** Linha de `accounts` (uma por conta do Flow que já bateu o coração). */
export const ExtensionAccountSchema = z
  .object({
    context: FlowContextSchema,
    online: z.boolean(),
    heartbeatAgeMs: z.number(),
    presenceTtlMs: z.number(),
    /** ms desde a época até quando a conta está em pausa por cota (0 = sem pausa). */
    cooldownUntil: z.number(),
    credits: z.number().nullable(),
    creditsAt: z.number(),
    spentCredits: z.number().optional(),
    paused: z.boolean().optional(),
    pending: z.number(),
    uncertain: z.boolean().optional(),
    lastError: z.string().optional(),
  })
  .passthrough();
export type ExtensionAccount = z.infer<typeof ExtensionAccountSchema>;

export const ExtensionStatusSchema = z
  .object({
    installed: z.literal(true),
    paired: z.boolean(),
    version: z.string(),
    protocol: z.string(),
    health: FlowHealthSchema.nullable(),
    accounts: z.array(ExtensionAccountSchema),
    origin: z.string().optional(),
    origins: z.array(z.string()).optional(),
  })
  .passthrough();
export type ExtensionStatus = z.infer<typeof ExtensionStatusSchema>;

/** Uma ordem do broker como o site a vê (sem argumentos, lease nem impressão digital). */
export const OrderViewSchema = z
  .object({
    id: z.string(),
    key: z.string(),
    jobId: z.string(),
    attempt: z.number(),
    context: FlowContextSchema,
    cmd: z.string(),
    state: z.enum(BROKER_STATES),
    created: z.number(),
    updated: z.number().optional(),
    error: z.string().optional(),
    mode: z.enum(['run', 'resume']).optional(),
    resume: z.record(z.unknown()).optional(),
    result: z
      .object({ mediaRef: z.string().optional(), mimeType: z.string().optional(), bytes: z.number().optional(), sha256: z.string().optional(), parts: z.number().optional() })
      .passthrough()
      .optional(),
    queueAhead: z.number().optional(),
    releasedUncertain: z.boolean().optional(),
  })
  .passthrough();
export type OrderView = z.infer<typeof OrderViewSchema>;

/** Uma parte (≤ 1 MiB) do MP4 baixado do Flow, devolvida por `download {id, part}`. */
export const DownloadPartSchema = z.object({
  id: z.string(),
  mimeType: z.string(),
  size: z.number(),
  sha256: z.string(),
  parts: z.number(),
  part: z.number(),
  partBytes: z.number().optional(),
  base64: z.string(),
  done: z.boolean(),
});
export type DownloadPart = z.infer<typeof DownloadPartSchema>;

/** Argumentos de `generate.video` (`args[0]`). */
export interface GenerateVideoArgs {
  prompt: string;
  aspectRatio: '9:16' | '16:9';
  durationSeconds?: 4 | 6 | 8;
  /** Nome do modelo como aparece no Flow (vazio = o que o Flow já tem selecionado). */
  model?: string;
  /** Imagem de partida (a foto do avatar): bytes completos, nome e MIME. */
  firstFrame?: { base64: string; mimeType: 'image/png' | 'image/jpeg' | 'image/webp'; name?: string };
}

export interface EnqueueRequest {
  jobId: string;
  context: FlowContext;
  cmd: 'generate.video';
  args: [GenerateVideoArgs];
  /** Chave estável: o mesmo pedido, com a mesma chave, devolve a MESMA ordem (resposta perdida não duplica a geração). */
  key: string;
  attempt: number;
}
