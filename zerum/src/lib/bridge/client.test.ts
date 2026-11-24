/**
 * Cliente da ponte (lado do site): pedidos por window.postMessage, resposta por id, prazo de 25 s — "pedido preservado".
 * Relógio e janela são falsos: nada espera de verdade.
 */
import { describe, expect, it, vi } from 'vitest';
import { BridgeClient, BridgeError, isNoResponse, windowEnv, type BridgeEnv } from './client';
import { BRIDGE_TIMEOUT_MS, ERR_NO_RESPONSE } from './protocol';

/** Ambiente falso: guarda o que foi postado; `reply` entrega mensagens ao cliente como se viessem da extensão. */
function fakeEnv() {
  const posted: Record<string, unknown>[] = [];
  let listener: ((d: unknown) => void) | null = null;
  let n = 0;
  const env: BridgeEnv = {
    post: (m) => posted.push(m as Record<string, unknown>),
    listen: (fn) => {
      listener = fn;
      return () => (listener = null);
    },
    setTimeout: (fn, ms) => setTimeout(fn, ms),
    clearTimeout: (h) => clearTimeout(h as ReturnType<typeof setTimeout>),
    randomId: () => `id-${++n}`,
  };
  return { env, posted, reply: (d: unknown) => listener?.(d), hasListener: () => listener !== null };
}

describe('BridgeClient', () => {
  it('envia {zre:"request", id, action, payload} e resolve com o result da resposta de mesmo id', async () => {
    const f = fakeEnv();
    const c = new BridgeClient(f.env);
    const p = c.request('extensionStatus', { a: 1 });
    expect(f.posted).toEqual([{ zre: 'request', id: 'id-1', action: 'extensionStatus', payload: { a: 1 } }]);
    expect(c.pendingCount).toBe(1);
    f.reply({ zre: 'response', id: 'id-1', result: { installed: true } });
    await expect(p).resolves.toEqual({ installed: true });
    expect(c.pendingCount).toBe(0);
  });

  it('respostas de OUTRO id (ou lixo) não resolvem nada', async () => {
    vi.useFakeTimers();
    try {
      const f = fakeEnv();
      const c = new BridgeClient(f.env);
      let done = false;
      void c.request('accounts').then(() => (done = true));
      f.reply({ zre: 'response', id: 'outro', result: 1 });
      f.reply({ zre: 'response', id: 'id-1' }); // sem result nem error
      f.reply('lixo');
      f.reply(null);
      await vi.advanceTimersByTimeAsync(10);
      expect(done).toBe(false);
      expect(c.pendingCount).toBe(1);
    } finally {
      vi.useRealTimers();
    }
  });

  it('25 s sem resposta → rejeita com a mensagem LITERAL do original ("pedido preservado, não gerar outra vez"), sem reenviar', async () => {
    vi.useFakeTimers();
    try {
      const f = fakeEnv();
      const c = new BridgeClient(f.env);
      const p = c.request('enqueue', { key: 'k' });
      const settled = p.then(
        () => 'ok',
        (e: unknown) => e,
      );
      await vi.advanceTimersByTimeAsync(BRIDGE_TIMEOUT_MS - 1);
      expect(c.pendingCount).toBe(1); // ainda esperando aos 24,999 s
      await vi.advanceTimersByTimeAsync(2);
      const e = (await settled) as BridgeError;
      expect(e).toBeInstanceOf(BridgeError);
      expect(e.message).toBe('EXTENSAO_SEM_RESPOSTA; pedido preservado, não gerar outra vez');
      expect(e.message).toBe(ERR_NO_RESPONSE);
      expect(isNoResponse(e)).toBe(true);
      expect(e.action).toBe('enqueue');
      expect(BRIDGE_TIMEOUT_MS).toBe(25_000);
      expect(f.posted).toHaveLength(1); // o pedido NUNCA é reenviado pelo cliente
      expect(c.pendingCount).toBe(0);
    } finally {
      vi.useRealTimers();
    }
  });

  it('resposta que chega DEPOIS do prazo é ignorada (não "ressuscita" o pedido)', async () => {
    vi.useFakeTimers();
    try {
      const f = fakeEnv();
      const c = new BridgeClient(f.env);
      const p = c.request('get', { id: 'x' }, 5_000);
      const settled = p.catch((e: unknown) => e);
      await vi.advanceTimersByTimeAsync(5_001);
      expect(((await settled) as Error).message).toBe(ERR_NO_RESPONSE);
      f.reply({ zre: 'response', id: 'id-1', result: { id: 'x' } }); // tarde demais
      expect(c.pendingCount).toBe(0);
    } finally {
      vi.useRealTimers();
    }
  });

  it('prazo por pedido: status usa 5 s; o padrão é 25 s', async () => {
    vi.useFakeTimers();
    try {
      const f = fakeEnv();
      const c = new BridgeClient(f.env);
      const quick = c.request('extensionStatus', {}, 5_000).catch((e: unknown) => e);
      const slow = c.request('accounts').catch((e: unknown) => e);
      await vi.advanceTimersByTimeAsync(5_001);
      expect(((await quick) as Error).message).toBe(ERR_NO_RESPONSE);
      expect(c.pendingCount).toBe(1);
      await vi.advanceTimersByTimeAsync(20_000);
      expect(((await slow) as Error).message).toBe(ERR_NO_RESPONSE);
    } finally {
      vi.useRealTimers();
    }
  });

  it('erro da extensão vira BridgeError com code/retryable/retryAt (os campos que o site do original lê)', async () => {
    const f = fakeEnv();
    const c = new BridgeClient(f.env);
    const p = c.request('enqueue', {});
    f.reply({ zre: 'response', id: 'id-1', error: 'CONTA_EM_PAUSA_COTA', code: 'CONTA_EM_PAUSA_COTA', retryable: true, retryAt: 1234, action: 'enqueue' });
    const e = (await p.catch((x: unknown) => x)) as BridgeError;
    expect(e).toMatchObject({ message: 'CONTA_EM_PAUSA_COTA', code: 'CONTA_EM_PAUSA_COTA', retryable: true, retryAt: 1234, action: 'enqueue' });
    expect(isNoResponse(e)).toBe(false);
  });

  it('push da extensão (flow-health / flow-credits) vai para os ouvintes, sem id', () => {
    const f = fakeEnv();
    const c = new BridgeClient(f.env);
    const seen: unknown[] = [];
    const off = c.onPush((m) => seen.push(m));
    f.reply({ zre: 'flow-health', health: { state: 'healthy' } });
    f.reply({ zre: 'flow-credits', status: null });
    off();
    f.reply({ zre: 'flow-health', health: null });
    expect(seen).toEqual([
      { zre: 'flow-health', health: { state: 'healthy' } },
      { zre: 'flow-credits', status: null },
    ]);
  });

  it('falha ao postar rejeita na hora e não deixa pedido pendente', async () => {
    const f = fakeEnv();
    f.env.post = () => {
      throw new Error('DataCloneError');
    };
    const c = new BridgeClient(f.env);
    await expect(c.request('accounts')).rejects.toThrow('DataCloneError');
    expect(c.pendingCount).toBe(0);
  });

  it('dispose: desliga o ouvinte e rejeita o que esperava', async () => {
    const f = fakeEnv();
    const c = new BridgeClient(f.env);
    const p = c.request('accounts').catch((e: unknown) => e);
    c.dispose();
    expect(((await p) as Error).message).toBe('PONTE_ENCERRADA');
    expect(f.hasListener()).toBe(false);
  });
});

describe('windowEnv (janela real): só a própria janela e a própria origem', () => {
  function fakeWindow() {
    const handlers: ((e: { source: unknown; origin: string; data: unknown }) => void)[] = [];
    const win = {
      location: { origin: 'http://127.0.0.1:3100' },
      crypto: { randomUUID: () => 'uuid-1' },
      postMessage: vi.fn(),
      addEventListener: (_t: string, fn: (typeof handlers)[number]) => handlers.push(fn),
      removeEventListener: (_t: string, fn: (typeof handlers)[number]) => handlers.splice(handlers.indexOf(fn), 1),
      setTimeout: (fn: () => void, ms: number) => setTimeout(fn, ms) as unknown as number,
      clearTimeout: (h: number) => clearTimeout(h),
    };
    return { win, deliver: (e: { source: unknown; origin: string; data: unknown }) => handlers.forEach((h) => h(e)) };
  }

  it('posta para a própria origem e ignora mensagens de outra janela ou origem', () => {
    const { win, deliver } = fakeWindow();
    const env = windowEnv(win as unknown as Window);
    const got: unknown[] = [];
    const off = env.listen((d) => got.push(d));
    env.post({ zre: 'request' });
    expect(win.postMessage).toHaveBeenCalledWith({ zre: 'request' }, 'http://127.0.0.1:3100');
    deliver({ source: win, origin: 'http://127.0.0.1:3100', data: 'ok' });
    deliver({ source: {}, origin: 'http://127.0.0.1:3100', data: 'iframe' });
    deliver({ source: win, origin: 'http://evil.example.com', data: 'outra origem' });
    expect(got).toEqual(['ok']);
    off();
    deliver({ source: win, origin: 'http://127.0.0.1:3100', data: 'depois' });
    expect(got).toEqual(['ok']);
    expect(env.randomId()).toBe('uuid-1');
  });
});
