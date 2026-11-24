/**
 * Executor REAL (roda no navegador): fala com a extensão pela ponte `zre` e implementa o contrato `FlowExecutor`.
 *
 *   ExtensionApi          → as ações da ponte, tipadas e validadas (zod), com o prazo de 25 s do cliente;
 *   ExtensionFlowExecutor → FlowExecutor (status/accounts/submit/get/reconcile) por cima da ExtensionApi.
 *
 * Nada aqui chama rede: só `window.postMessage` (via BridgeClient).
 */
import type { OperationRecord } from './broker';
import { BridgeClient, BridgeError, isNoResponse } from './client';
import {
  DownloadPartSchema,
  ExtensionStatusSchema,
  OrderViewSchema,
  type DownloadPart,
  type EnqueueRequest,
  type ExtensionStatus,
  type FlowContext,
  type OrderView,
} from './protocol';
import { statusFromExtension, toFlowAccount, type BridgeStatus, type FlowAccount, type FlowExecutor, type SubmitInput } from './status';

/** `extensionStatus` e `accounts` são consultas rápidas: 5 s (como o original), não os 25 s dos pedidos. */
export const STATUS_TIMEOUT_MS = 5_000;
/** Uma parte de MP4 (≤ 1 MiB) pode demorar um pouco mais que um status. */
export const DOWNLOAD_PART_TIMEOUT_MS = 30_000;

const decodeBase64 = (b64: string): Uint8Array => {
  const bin = atob(b64);
  const out = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i);
  return out;
};
const hex = (buf: ArrayBuffer) => [...new Uint8Array(buf)].map((b) => b.toString(16).padStart(2, '0')).join('');

function parse<T>(schema: { safeParse(v: unknown): { success: true; data: T } | { success: false } }, raw: unknown, what: string): T {
  const r = schema.safeParse(raw);
  if (!r.success) throw new BridgeError(`RESPOSTA_INVALIDA; ${what} fora do formato esperado`, { code: 'RESPOSTA_INVALIDA' });
  return r.data;
}

export class ExtensionApi {
  constructor(readonly client: BridgeClient) {}

  async extensionStatus(): Promise<ExtensionStatus> {
    return parse<ExtensionStatus>(ExtensionStatusSchema, await this.client.request('extensionStatus', {}, STATUS_TIMEOUT_MS), 'extensionStatus');
  }

  /** Tentativa atual do job (0 se novo). */
  async job(jobId: string, context: FlowContext): Promise<{ attempt: number }> {
    return this.client.request('job', { jobId, context });
  }
  /** Abre a próxima tentativa do job (só se nada pendente/incerto). */
  async beginAttempt(jobId: string, context: FlowContext): Promise<{ attempt: number }> {
    return this.client.request('beginAttempt', { jobId, context });
  }
  /** Enfileira. A MESMA chave devolve a MESMA ordem: pode ser reenviado com segurança depois de EXTENSAO_SEM_RESPOSTA. */
  async enqueue(req: EnqueueRequest): Promise<OrderView> {
    return parse<OrderView>(OrderViewSchema, await this.client.request('enqueue', req), 'ordem');
  }
  async getOrder(id: string): Promise<OrderView> {
    return parse<OrderView>(OrderViewSchema, await this.client.request('get', { id }), 'ordem');
  }
  async reconcile(id: string): Promise<OrderView> {
    return parse<OrderView>(OrderViewSchema, await this.client.request('reconcile', { id }), 'ordem');
  }
  async recoverJob(jobId: string, context: FlowContext): Promise<{ status: 'reconciling' | 'released' | 'completed'; operationId?: string | null; retryAfterMs?: number; uncertainExpired?: boolean }> {
    return this.client.request('recoverJob', { jobId, context });
  }

  /** Lê o MP4 de uma ordem CONCLUÍDA, parte por parte, e confere tamanho e sha-256. */
  async downloadClip(id: string, expect?: { bytes?: number; sha256?: string }): Promise<Uint8Array> {
    const chunks: Uint8Array[] = [];
    let first: DownloadPart | null = null;
    for (let part = 0; ; part++) {
      const p = parse<DownloadPart>(DownloadPartSchema, await this.client.request('download', { id, part }, DOWNLOAD_PART_TIMEOUT_MS), 'parte do vídeo');
      first ??= p;
      if (p.part !== part || p.parts !== first.parts || p.sha256 !== first.sha256) throw new BridgeError('RESPOSTA_INVALIDA; partes do vídeo inconsistentes', { code: 'RESPOSTA_INVALIDA' });
      chunks.push(decodeBase64(p.base64));
      if (p.done) break;
      if (part > 200) throw new BridgeError('RESPOSTA_INVALIDA; vídeo com partes demais', { code: 'RESPOSTA_INVALIDA' });
    }
    const total = chunks.reduce((n, c) => n + c.length, 0);
    const out = new Uint8Array(total);
    let at = 0;
    for (const c of chunks) {
      out.set(c, at);
      at += c.length;
    }
    if (total !== first!.size || (expect?.bytes != null && total !== expect.bytes)) throw new BridgeError('MIDIA_TAMANHO_DIVERGENTE; o vídeo veio incompleto', { code: 'MIDIA_TAMANHO_DIVERGENTE' });
    const digest = hex(await crypto.subtle.digest('SHA-256', out));
    if (digest !== first!.sha256 || (expect?.sha256 && digest !== expect.sha256)) throw new BridgeError('MIDIA_HASH_DIVERGENTE; o vídeo veio corrompido', { code: 'MIDIA_HASH_DIVERGENTE' });
    return out;
  }
}

/** Ordem da extensão → registro do contrato `FlowExecutor`. */
export function toOperationRecord(o: OrderView): OperationRecord {
  const iso = (ms?: number) => new Date(ms ?? o.created).toISOString();
  return { key: o.key, jobId: o.jobId, context: o.context, command: o.cmd, state: o.state, attempt: o.attempt, createdAt: iso(o.created), updatedAt: iso(o.updated), ...(o.error ? { error: o.error } : {}) };
}

/** Chave estável derivada do pedido (mesmo job + contexto + comando + argumentos ⇒ mesma chave ⇒ mesma ordem). */
export async function stableKey(parts: unknown): Promise<string> {
  const text = JSON.stringify(parts, (_k, v) => (v && typeof v === 'object' && !Array.isArray(v) ? Object.fromEntries(Object.entries(v as Record<string, unknown>).sort(([a], [b]) => a.localeCompare(b))) : v));
  return hex(await crypto.subtle.digest('SHA-256', new TextEncoder().encode(text)));
}

export class ExtensionFlowExecutor implements FlowExecutor {
  private answered = false;
  readonly api: ExtensionApi;

  /**
   * `env.installed`: dica síncrona de que a extensão existe nesta página (o marcador `data-zerum-extension` que o relay
   * põe no <html>). `false` = nem pergunta (evita esperar 5 s por uma resposta que não virá); ausente/`true` = pergunta.
   */
  constructor(client: BridgeClient, private readonly env: { installed?: () => boolean; originBlocked?: () => boolean } = {}) {
    this.api = new ExtensionApi(client);
  }

  async status(): Promise<BridgeStatus> {
    if (this.env.installed && !this.env.installed()) return statusFromExtension(null, { answeredBefore: this.answered });
    try {
      const raw = await this.api.extensionStatus();
      this.answered = true;
      return statusFromExtension(raw);
    } catch (e) {
      if (e instanceof BridgeError && e.code === 'ORIGEM_NAO_PERMITIDA') {
        this.answered = true;
        return statusFromExtension(null, { originBlocked: true });
      }
      if (isNoResponse(e)) return statusFromExtension(null, { answeredBefore: this.answered, originBlocked: this.env.originBlocked?.() });
      throw e;
    }
  }

  async accounts(): Promise<FlowAccount[]> {
    return (await this.api.extensionStatus()).accounts.map(toFlowAccount);
  }

  async submit(input: SubmitInput): Promise<OperationRecord> {
    const { attempt } = await this.api.job(input.jobId, input.context);
    const key = await stableKey({ jobId: input.jobId, context: input.context.accountId.toLowerCase() + '|' + input.context.projectId, cmd: input.command, args: input.args, attempt });
    const order = await this.api.enqueue({ jobId: input.jobId, context: input.context, cmd: input.command as 'generate.video', args: input.args as EnqueueRequest['args'], key, attempt });
    return toOperationRecord(order);
  }

  async get(id: string): Promise<OperationRecord | null> {
    try {
      return toOperationRecord(await this.api.getOrder(id));
    } catch (e) {
      if (e instanceof BridgeError && e.code === 'ORDEM_NAO_ENCONTRADA') return null;
      throw e;
    }
  }

  async reconcile(id: string): Promise<OperationRecord | null> {
    try {
      return toOperationRecord(await this.api.reconcile(id));
    } catch (e) {
      if (e instanceof BridgeError && e.code === 'ORDEM_NAO_ENCONTRADA') return null;
      throw e;
    }
  }
}
