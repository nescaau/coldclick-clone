/** Relay do site: window.postMessage ⇄ service worker. Mesmas regras de segurança do original. */
import { describe, expect, it } from 'vitest';
import { startSiteRelay, toResponse } from '../content/site-relay.js';
import { STATUS_KEY } from '../lib/protocol.js';
import { FLOW_CTX, createFakeChrome, createFakeWindow, createWorld, sender, videoOrder } from './world.mjs';

const tick = () => new Promise((r) => setTimeout(r, 50));

function setup({ path = '/zerum', from = sender.site() } = {}) {
  const world = createWorld();
  const win = createFakeWindow({ pathname: path });
  const chrome = createFakeChrome({ kv: world.kv, sw: world.sw, sender: from });
  const started = startSiteRelay({ window: win, chrome });
  return { world, win, chrome, started };
}
const responses = (win) => win.posted.filter((p) => p.data?.zre === 'response').map((p) => p.data);
const send = async (win, data) => {
  win.postMessage(data, win.location.origin);
  await tick();
};

describe('relay do site', () => {
  it('marca a página (versão + origem autorizada) e empurra a saúde ao carregar', async () => {
    const { win, started } = setup();
    expect(started).toBe(true);
    expect(win.attrs.get('data-zerum-extension')).toBe('0.1.0');
    await tick();
    expect(win.attrs.get('data-zerum-extension-origin')).toBe('allowed');
    expect(win.posted.some((p) => p.data.zre === 'flow-health' && p.targetOrigin === 'http://127.0.0.1:3100')).toBe(true);
  });

  it('origem não autorizada: a página é marcada "blocked" e as ações são recusadas pelo service worker', async () => {
    const { win } = setup({ from: sender.site('http://127.0.0.1:3101/zerum') });
    await tick();
    expect(win.attrs.get('data-zerum-extension-origin')).toBe('blocked');
    await send(win, { zre: 'request', id: 'a', action: 'extensionStatus' });
    expect(responses(win)[0]).toMatchObject({ id: 'a', error: 'ORIGEM_NAO_PERMITIDA', code: 'ORIGEM_NAO_PERMITIDA' });
  });

  it('origem NÃO autorizada não recebe `flow-health` (e-mail/projeto) — nem ao carregar, nem quando a saúde muda', async () => {
    const { win, chrome, world } = setup({ from: sender.site('http://127.0.0.1:3101/zerum') });
    await world.kv.set({ [STATUS_KEY]: { health: { state: 'healthy', detail: 'Flow ligado', context: FLOW_CTX() } } });
    await tick();
    await chrome.storage.local.set({ [STATUS_KEY]: { health: { state: 'healthy', detail: 'Flow ligado', context: FLOW_CTX() } } });
    await tick();
    expect(win.attrs.get('data-zerum-extension-origin')).toBe('blocked');
    expect(win.posted.filter((p) => p.data.zre === 'flow-health')).toEqual([]);
  });

  it('request → response com o mesmo id (result) e a resposta vai só para a própria origem', async () => {
    const { win } = setup();
    await send(win, { zre: 'request', id: 'abc', action: 'extensionStatus', payload: {} });
    const [r] = responses(win);
    expect(r).toMatchObject({ zre: 'response', id: 'abc' });
    expect(r.result).toMatchObject({ installed: true, version: '0.1.0' });
    expect(win.posted.filter((p) => p.data.zre === 'response').every((p) => p.targetOrigin === 'http://127.0.0.1:3100')).toBe(true);
  });

  it('erro do broker vira `error` + `code` (+ retryable/retryAt) sem result', async () => {
    const { win } = setup();
    await send(win, { zre: 'request', id: 'e1', action: 'enqueue', payload: videoOrder() });
    expect(responses(win)[0]).toMatchObject({ id: 'e1', error: 'CONTA_PROJETO_OFFLINE', code: 'CONTA_PROJETO_OFFLINE', retryable: false, action: 'enqueue' });
    expect(responses(win)[0].result).toBeUndefined();
  });

  it('ignora (sem responder): outra janela, outra origem, sem `zre`, id inválido, ação fora da lista', async () => {
    const { win } = setup();
    const ok = { zre: 'request', id: 'x', action: 'accounts' };
    win.dispatch({ source: {}, origin: win.location.origin, data: ok }); // outra janela (iframe/extensão)
    win.dispatch({ source: win, origin: 'http://evil.example.com', data: ok });
    await send(win, { id: 'x', action: 'accounts' });
    await send(win, { zre: 'request', id: '', action: 'accounts' });
    await send(win, { zre: 'request', id: 'x'.repeat(129), action: 'accounts' });
    await send(win, { zre: 'request', id: 7, action: 'accounts' });
    await send(win, { zre: 'request', id: 'z', action: 'connect' });
    await send(win, { zre: 'request', id: 'z', action: 'heartbeat' });
    await send(win, null);
    await tick();
    expect(responses(win)).toEqual([]);
  });

  it('não toca em páginas que não são o Zerum (fora de /zerum) e não inicia duas vezes', async () => {
    const out = setup({ path: '/outra-coisa' });
    expect(out.started).toBe(false);
    await send(out.win, { zre: 'request', id: 'a', action: 'accounts' });
    expect(responses(out.win)).toEqual([]);
    expect(out.win.attrs.has('data-zerum-extension')).toBe(false);

    const again = setup();
    expect(startSiteRelay({ window: again.win, chrome: again.chrome })).toBe(false);
    await send(again.win, { zre: 'request', id: 'a', action: 'accounts' });
    expect(responses(again.win)).toHaveLength(1); // um ouvinte só
  });

  it('a mudança de saúde no storage é empurrada como `flow-health` (nunca journal/mídia)', async () => {
    const { win, chrome } = setup();
    await tick();
    await chrome.storage.local.set({ [STATUS_KEY]: { health: { state: 'healthy', detail: 'Flow ligado', context: FLOW_CTX() } } });
    const pushes = win.posted.filter((p) => p.data.zre === 'flow-health');
    expect(pushes.at(-1).data.health).toMatchObject({ state: 'healthy', context: { accountId: 'ana@gmail.com' } });
    await chrome.storage.local.set({ outra: 1 }); // outras chaves não viram push
    expect(win.posted.filter((p) => p.data.zre === 'flow-health')).toHaveLength(pushes.length);
  });

  it('extensão recarregada (contexto inválido): responde com erro em vez de ficar muda', async () => {
    const { win, chrome } = setup();
    chrome.runtime.sendMessage = async () => {
      throw new Error('Extension context invalidated.');
    };
    await send(win, { zre: 'request', id: 'q', action: 'accounts' });
    expect(responses(win)[0]).toMatchObject({ id: 'q', code: 'EXTENSAO_INDISPONIVEL' });
  });
});

describe('toResponse', () => {
  it('cobre result, error (com retryAt) e resposta vazia; erro limitado a 200 caracteres', () => {
    expect(toResponse('i', 'get', { result: { a: 1 } })).toEqual({ zre: 'response', id: 'i', result: { a: 1 } });
    expect(toResponse('i', 'get', { result: undefined })).toEqual({ zre: 'response', id: 'i', result: null });
    expect(toResponse('i', 'get', { error: 'X'.repeat(500), code: 'C', retryable: true, retryAt: 99 })).toMatchObject({ code: 'C', retryable: true, retryAt: 99, action: 'get' });
    expect(toResponse('i', 'get', { error: 'X'.repeat(500) }).error).toHaveLength(200);
    expect(toResponse('i', 'get', undefined)).toMatchObject({ error: 'SEM_RESPOSTA' });
  });
});
