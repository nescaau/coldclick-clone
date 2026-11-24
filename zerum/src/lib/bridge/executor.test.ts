/**
 * Executor REAL do navegador (`ExtensionFlowExecutor` + `ExtensionApi`) contra uma extensão FALSA que responde pela ponte
 * `zre`. Prova o que o app promete: chave estável (reenviar não duplica), leitura do MP4 em partes com conferência de
 * tamanho e SHA-256, e o estado mostrado ("não instalada" × "parou de responder" × "origem não autorizada" × pronta).
 */
import { createHash } from 'node:crypto';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { BridgeClient, BridgeError, type BridgeEnv } from './client';
import { ExtensionApi, ExtensionFlowExecutor, STATUS_TIMEOUT_MS, stableKey, toOperationRecord } from './executor';
import { ERR_NO_RESPONSE, type OrderView } from './protocol';
import { NOT_READY_DETAIL } from './status';

type Payload = Record<string, unknown>;
type Handler = (payload: Payload) => unknown;
const SILENCE = Symbol('a extensão não responde');

/** Extensão falsa: cada ação tem um handler; devolver SILENCE = não responder; lançar erro = resposta com `error`/`code`. */
function fakeExtension(handlers: Record<string, Handler>) {
  let listener: ((d: unknown) => void) | null = null;
  let n = 0;
  const calls: { action: string; payload: Payload }[] = [];
  const env: BridgeEnv = {
    post: (m) => {
      const r = m as { id: string; action: string; payload: Payload };
      calls.push({ action: r.action, payload: r.payload });
      queueMicrotask(() => {
        try {
          const h = handlers[r.action];
          if (!h) throw Object.assign(new Error('ACAO_SEM_HANDLER'), { code: 'ACAO_SEM_HANDLER' });
          const result = h(r.payload);
          if (result === SILENCE) return;
          listener?.({ zre: 'response', id: r.id, result });
        } catch (e) {
          const err = e as { message: string; code?: string };
          listener?.({ zre: 'response', id: r.id, error: err.message, code: err.code });
        }
      });
    },
    listen: (fn) => {
      listener = fn;
      return () => (listener = null);
    },
    setTimeout: (fn, ms) => setTimeout(fn, ms),
    clearTimeout: (h) => clearTimeout(h as ReturnType<typeof setTimeout>),
    randomId: () => `id-${++n}`,
  };
  return { client: new BridgeClient(env), calls };
}

const fail = (code: string) => Object.assign(new Error(code), { code });

const CTX = { accountId: 'ana@gmail.com', projectId: '11111111-1111-4111-8111-111111111111', accountPath: '' };
const T0 = 1_800_000_000_000;
const order = (o: Partial<OrderView> = {}): OrderView => ({ id: 'o1', key: 'k1', jobId: 'cena:v:0', attempt: 0, context: CTX, cmd: 'generate.video', state: 'queued', created: T0, ...o });
const extStatus = (o: Payload = {}) => ({
  installed: true,
  paired: true,
  version: '0.1.0',
  protocol: 'zerum-local-flow-v1',
  health: { state: 'healthy', detail: 'Flow ligado' },
  accounts: [{ context: CTX, online: true, heartbeatAgeMs: 100, presenceTtlMs: 90_000, cooldownUntil: 0, credits: 120, creditsAt: T0, pending: 1 }],
  ...o,
});

afterEach(() => vi.useRealTimers());

describe('stableKey', () => {
  it('mesma entrada (em qualquer ordem de campos, também aninhados) = mesma chave; outra tentativa ou outro texto = outra chave', async () => {
    const a = await stableKey({ jobId: 'j', args: [{ prompt: 'x', aspectRatio: '9:16' }], attempt: 0 });
    const b = await stableKey({ attempt: 0, args: [{ aspectRatio: '9:16', prompt: 'x' }], jobId: 'j' });
    expect(a).toMatch(/^[0-9a-f]{64}$/);
    expect(b).toBe(a);
    expect(await stableKey({ jobId: 'j', args: [{ prompt: 'x', aspectRatio: '9:16' }], attempt: 1 })).not.toBe(a);
    expect(await stableKey({ jobId: 'j', args: [{ prompt: 'y', aspectRatio: '9:16' }], attempt: 0 })).not.toBe(a);
  });
});

describe('toOperationRecord', () => {
  it('ordem da extensão → registro do contrato (cmd→command, datas ISO, erro só quando existe)', () => {
    const rec = toOperationRecord(order({ state: 'failed', error: 'COTA', updated: T0 + 5000 }));
    expect(rec).toMatchObject({ key: 'k1', jobId: 'cena:v:0', command: 'generate.video', state: 'failed', attempt: 0, error: 'COTA' });
    expect(rec.createdAt).toBe(new Date(T0).toISOString());
    expect(rec.updatedAt).toBe(new Date(T0 + 5000).toISOString());
    const quiet = toOperationRecord(order());
    expect(quiet).not.toHaveProperty('error');
    expect(quiet.updatedAt).toBe(quiet.createdAt); // sem `updated`, vale a criação
  });
});

describe('ExtensionApi.downloadClip (o MP4 vem da extensão em partes e é CONFERIDO)', () => {
  const bytes = Uint8Array.from({ length: 2500 }, (_, i) => (i * 7) % 251);
  const sha = createHash('sha256').update(bytes).digest('hex');
  const slices = [bytes.subarray(0, 1000), bytes.subarray(1000, 2000), bytes.subarray(2000)];
  const partMsg = (i: number, o: Payload = {}) => ({ id: 'o1', mimeType: 'video/mp4', size: bytes.length, sha256: sha, parts: 3, part: i, base64: Buffer.from(slices[i]).toString('base64'), done: i === 2, ...o });
  const part = (p: Payload) => p.part as number;

  it('junta as partes na ordem, confere tamanho e SHA-256 e devolve exatamente os bytes', async () => {
    const { client, calls } = fakeExtension({ download: (p) => partMsg(part(p)) });
    const out = await new ExtensionApi(client).downloadClip('o1', { bytes: bytes.length, sha256: sha });
    expect(Buffer.from(out).equals(Buffer.from(bytes))).toBe(true);
    expect(calls.map((c) => c.payload)).toEqual([
      { id: 'o1', part: 0 },
      { id: 'o1', part: 1 },
      { id: 'o1', part: 2 },
    ]);
  });

  it('hash diferente (corrompido) → MIDIA_HASH_DIVERGENTE; nada é devolvido', async () => {
    const { client } = fakeExtension({ download: (p) => partMsg(part(p), { sha256: '0'.repeat(64) }) });
    await expect(new ExtensionApi(client).downloadClip('o1')).rejects.toMatchObject({ code: 'MIDIA_HASH_DIVERGENTE' });
  });

  it('tamanho diferente do anunciado, ou do esperado pelo chamador → MIDIA_TAMANHO_DIVERGENTE', async () => {
    const lying = fakeExtension({ download: (p) => partMsg(part(p), { size: bytes.length + 1 }) });
    await expect(new ExtensionApi(lying.client).downloadClip('o1')).rejects.toMatchObject({ code: 'MIDIA_TAMANHO_DIVERGENTE' });
    const honest = fakeExtension({ download: (p) => partMsg(part(p)) });
    await expect(new ExtensionApi(honest.client).downloadClip('o1', { bytes: 1 })).rejects.toMatchObject({ code: 'MIDIA_TAMANHO_DIVERGENTE' });
    await expect(new ExtensionApi(honest.client).downloadClip('o1', { sha256: 'f'.repeat(64) })).rejects.toMatchObject({ code: 'MIDIA_HASH_DIVERGENTE' });
  });

  it('partes fora de ordem, de outro vídeo ou em formato errado → RESPOSTA_INVALIDA', async () => {
    const swapped = fakeExtension({ download: (p) => partMsg(part(p) === 1 ? 2 : part(p)) });
    await expect(new ExtensionApi(swapped.client).downloadClip('o1')).rejects.toMatchObject({ code: 'RESPOSTA_INVALIDA' });
    const mixed = fakeExtension({ download: (p) => partMsg(part(p), part(p) === 1 ? { sha256: '1'.repeat(64) } : {}) });
    await expect(new ExtensionApi(mixed.client).downloadClip('o1')).rejects.toMatchObject({ code: 'RESPOSTA_INVALIDA' });
    const junk = fakeExtension({ download: () => ({ qualquer: 'coisa' }) });
    await expect(new ExtensionApi(junk.client).downloadClip('o1')).rejects.toMatchObject({ code: 'RESPOSTA_INVALIDA' });
  });

  it('erro da extensão (ex.: mídia não encontrada) chega ao chamador com o código', async () => {
    const { client } = fakeExtension({ download: () => { throw fail('MIDIA_NAO_ENCONTRADA'); } });
    await expect(new ExtensionApi(client).downloadClip('o1')).rejects.toBeInstanceOf(BridgeError);
    await expect(new ExtensionApi(client).downloadClip('o1')).rejects.toMatchObject({ code: 'MIDIA_NAO_ENCONTRADA' });
  });
});

describe('ExtensionFlowExecutor.status', () => {
  it('sem o marcador da extensão na página: nem pergunta (nada é postado) e diz EXTENSAO_NAO_INSTALADA', async () => {
    const { client, calls } = fakeExtension({ extensionStatus: () => extStatus() });
    const st = await new ExtensionFlowExecutor(client, { installed: () => false }).status();
    expect(calls).toEqual([]);
    expect(st).toMatchObject({ ready: false, detail: NOT_READY_DETAIL });
    expect(st.checklist.extensionInstalled).toBe(false);
  });

  it('extensão pronta: contas (e-mail, créditos), versão, "Flow ligado" e o checklist completo', async () => {
    const { client } = fakeExtension({ extensionStatus: () => extStatus() });
    const ex = new ExtensionFlowExecutor(client);
    const st = await ex.status();
    expect(st).toMatchObject({ ready: true, version: '0.1.0', pending: 1, checklist: { extensionInstalled: true, extensionConnected: true, flowTabOpen: true, accountChosen: true } });
    expect(st.detail).toMatch(/^Flow ligado: ana@gmail\.com · 120 créditos/);
    expect(st.accounts).toEqual([expect.objectContaining({ email: 'ana@gmail.com', credits: 120, online: true })]);
    expect((await ex.accounts()).map((a) => a.email)).toEqual(['ana@gmail.com']);
  });

  it('a extensão recusa esta origem → originBlocked (instalada, mas não autorizada)', async () => {
    const { client } = fakeExtension({ extensionStatus: () => { throw fail('ORIGEM_NAO_PERMITIDA'); } });
    const st = await new ExtensionFlowExecutor(client).status();
    expect(st).toMatchObject({ ready: false, originBlocked: true });
    expect(st.detail).toMatch(/^ORIGEM_NAO_AUTORIZADA;/);
    expect(st.checklist.extensionInstalled).toBe(true);
  });

  it('nunca respondeu e não responde → "não instalada"; respondia e parou → o texto literal EXTENSAO_SEM_RESPOSTA', async () => {
    vi.useFakeTimers();
    let mute = false;
    const { client } = fakeExtension({ extensionStatus: () => (mute ? SILENCE : extStatus()) });
    const never = fakeExtension({ extensionStatus: () => SILENCE });

    const silentFromStart = new ExtensionFlowExecutor(never.client).status();
    await vi.advanceTimersByTimeAsync(STATUS_TIMEOUT_MS);
    expect((await silentFromStart).detail).toBe(NOT_READY_DETAIL);

    const ex = new ExtensionFlowExecutor(client);
    expect((await ex.status()).ready).toBe(true);
    mute = true;
    const later = ex.status();
    await vi.advanceTimersByTimeAsync(STATUS_TIMEOUT_MS);
    const st = await later;
    expect(st).toMatchObject({ ready: false, detail: ERR_NO_RESPONSE });
    expect(st.checklist.extensionInstalled).toBe(true);
  });

  it('erro que não é "sem resposta" nem origem (ex.: formato inválido) NÃO vira "pronto": propaga', async () => {
    const { client } = fakeExtension({ extensionStatus: () => ({ installed: false }) });
    await expect(new ExtensionFlowExecutor(client).status()).rejects.toMatchObject({ code: 'RESPOSTA_INVALIDA' });
  });
});

describe('ExtensionFlowExecutor.submit / get / reconcile', () => {
  it('a MESMA entrada gera a MESMA chave (reenviar depois de EXTENSAO_SEM_RESPOSTA não duplica); a tentativa vem do job', async () => {
    const sent: Payload[] = [];
    const { client, calls } = fakeExtension({
      job: () => ({ attempt: 2 }),
      enqueue: (p) => {
        sent.push(p);
        return order({ key: p.key as string, attempt: p.attempt as number });
      },
    });
    const ex = new ExtensionFlowExecutor(client);
    const input = { jobId: 'cena:v:0', context: CTX, command: 'generate.video', args: [{ prompt: 'oi', aspectRatio: '9:16' }] };
    const a = await ex.submit(input);
    const b = await ex.submit({ ...input, context: { ...CTX, accountId: 'ANA@gmail.com' } }); // e-mail em maiúsculas = mesma conta
    expect(sent[0].key).toBe(sent[1].key);
    expect(sent[0]).toMatchObject({ jobId: 'cena:v:0', cmd: 'generate.video', attempt: 2 });
    expect(a).toMatchObject({ state: 'queued', attempt: 2, command: 'generate.video' });
    expect(b.key).toBe(a.key);
    expect(calls.map((c) => c.action)).toEqual(['job', 'enqueue', 'job', 'enqueue']);

    await ex.submit({ ...input, args: [{ prompt: 'outro texto', aspectRatio: '9:16' }] });
    expect(sent[2].key).not.toBe(sent[0].key);
  });

  it('get/reconcile: ordem que sumiu → null; qualquer outro erro propaga; só leitura (nunca chama enqueue)', async () => {
    const lookup: Handler = (p) => {
      if (p.id === 'sumiu') throw fail('ORDEM_NAO_ENCONTRADA');
      if (p.id === 'ruim') throw fail('ERRO_INTERNO');
      return order({ id: p.id as string, state: 'unknown' });
    };
    const { client, calls } = fakeExtension({ get: lookup, reconcile: lookup });
    const ex = new ExtensionFlowExecutor(client);
    expect(await ex.get('sumiu')).toBeNull();
    expect(await ex.reconcile('sumiu')).toBeNull();
    await expect(ex.get('ruim')).rejects.toMatchObject({ code: 'ERRO_INTERNO' });
    await expect(ex.reconcile('ruim')).rejects.toMatchObject({ code: 'ERRO_INTERNO' });
    expect(await ex.reconcile('o9')).toMatchObject({ state: 'unknown' });
    expect(calls.every((c) => c.action === 'get' || c.action === 'reconcile')).toBe(true);
  });
});
