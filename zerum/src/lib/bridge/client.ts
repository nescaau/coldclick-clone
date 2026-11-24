/**
 * Cliente da ponte (roda no NAVEGADOR): pedidos `zre:'request'` por `window.postMessage`, respostas por `id`, prazo de 25 s.
 *
 * Contrato (igual ao `yn()` do original):
 *  - cada pedido leva um `id` aleatório; a resposta só vale se `e.source === window` e `e.origin === location.origin`;
 *  - sem resposta em `timeoutMs` (25 s) → rejeita com ERR_NO_RESPONSE ("pedido preservado, não gerar outra vez");
 *  - o pedido NUNCA é reenviado aqui: quem chamou decide (e só reenvia COM A MESMA CHAVE — o broker não duplica);
 *  - resposta tardia (id já expirado) é ignorada.
 *
 * Sem rede: só `postMessage`. O ambiente (janela, timers, ids) é injetável — por isso testa no Node.
 */
import { BRIDGE_TIMEOUT_MS, BridgePushSchema, ERR_NO_RESPONSE, type BridgeAction, type BridgePush } from './protocol';
import { BridgeResponseSchema } from './protocol';

/** Erro devolvido pela extensão (ou pelo prazo). Os campos extras são os que o site do original lê. */
export class BridgeError extends Error {
  readonly code?: string;
  readonly retryable: boolean;
  readonly retryAt: number | null;
  readonly action?: string;
  constructor(message: string, extra: { code?: string; retryable?: boolean; retryAt?: number | null; action?: string } = {}) {
    super(message);
    this.name = 'BridgeError';
    this.code = extra.code;
    this.retryable = extra.retryable === true;
    this.retryAt = extra.retryAt ?? null;
    this.action = extra.action;
  }
}

/** A extensão não respondeu a tempo (ou não existe)? */
export const isNoResponse = (e: unknown): boolean => e instanceof BridgeError && e.message === ERR_NO_RESPONSE;

export interface BridgeEnv {
  /** window.postMessage(message, location.origin) */
  post(message: unknown): void;
  /** Ouve mensagens JÁ filtradas (mesma janela, mesma origem). Devolve a função que desliga. */
  listen(fn: (data: unknown) => void): () => void;
  setTimeout(fn: () => void, ms: number): unknown;
  clearTimeout(handle: unknown): void;
  randomId(): string;
}

/** Ambiente real: uma `Window` de navegador. */
export function windowEnv(win: Window): BridgeEnv {
  return {
    post: (message) => win.postMessage(message, win.location.origin),
    listen(fn) {
      const handler = (e: MessageEvent) => {
        if (e.source !== win || e.origin !== win.location.origin) return;
        fn(e.data);
      };
      win.addEventListener('message', handler);
      return () => win.removeEventListener('message', handler);
    },
    setTimeout: (fn, ms) => win.setTimeout(fn, ms),
    clearTimeout: (h) => win.clearTimeout(h as number),
    randomId: () => win.crypto.randomUUID(),
  };
}

interface Pending {
  resolve: (v: unknown) => void;
  reject: (e: unknown) => void;
  timer: unknown;
}

export class BridgeClient {
  private readonly pending = new Map<string, Pending>();
  private readonly pushes = new Set<(m: BridgePush) => void>();
  private readonly off: () => void;

  constructor(private readonly env: BridgeEnv) {
    this.off = env.listen((data) => this.onMessage(data));
  }

  /** Pedidos aguardando resposta. */
  get pendingCount(): number {
    return this.pending.size;
  }

  /** Mensagens que a extensão empurra sem pedido (`flow-health`, `flow-credits`). */
  onPush(fn: (m: BridgePush) => void): () => void {
    this.pushes.add(fn);
    return () => this.pushes.delete(fn);
  }

  request<T = unknown>(action: BridgeAction, payload: unknown = {}, timeoutMs: number = BRIDGE_TIMEOUT_MS): Promise<T> {
    return new Promise<T>((resolve, reject) => {
      const id = this.env.randomId();
      const timer = this.env.setTimeout(() => {
        this.pending.delete(id);
        reject(new BridgeError(ERR_NO_RESPONSE, { action }));
      }, timeoutMs);
      this.pending.set(id, { resolve: resolve as (v: unknown) => void, reject, timer });
      try {
        this.env.post({ zre: 'request', id, action, payload });
      } catch (e) {
        this.env.clearTimeout(timer);
        this.pending.delete(id);
        reject(e);
      }
    });
  }

  private onMessage(data: unknown): void {
    const push = BridgePushSchema.safeParse(data);
    if (push.success) {
      for (const fn of this.pushes) fn(push.data);
      return;
    }
    const parsed = BridgeResponseSchema.safeParse(data);
    if (!parsed.success) return;
    const r = parsed.data;
    const p = this.pending.get(r.id);
    if (!p) return; // resposta tardia (já expirou) ou de outro cliente
    this.env.clearTimeout(p.timer);
    this.pending.delete(r.id);
    if (r.error !== undefined) {
      p.reject(new BridgeError(r.error, { code: r.code, retryable: r.retryable === true, retryAt: Number.isFinite(r.retryAt) ? (r.retryAt as number) : null, action: r.action }));
    } else {
      p.resolve(r.result);
    }
  }

  /** Desliga o ouvinte e rejeita o que ainda esperava (ao desmontar a página). */
  dispose(): void {
    this.off();
    for (const [id, p] of this.pending) {
      this.env.clearTimeout(p.timer);
      p.reject(new BridgeError('PONTE_ENCERRADA'));
      this.pending.delete(id);
    }
    this.pushes.clear();
  }
}
