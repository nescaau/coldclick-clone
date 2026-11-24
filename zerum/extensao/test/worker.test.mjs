/**
 * Cadeia real da extensão sem Chrome: service worker (sw-core) + broker + worker da aba + driver, sobre uma página
 * falsa do Flow. Prova o que importa: gera UMA vez, entrega o MP4, e nunca repete o clique em "gerar".
 */
import { describe, expect, it } from 'vitest';
import { fromBase64 } from '../lib/util.js';
import { MOCK_MP4 } from './mock-page.mjs';
import { PRESENCE_TTL_MS, QUOTA_PAUSE_MS } from '../lib/protocol.js';
import { createMockPage } from './mock-page.mjs';
import { FLOW_CTX, createWorld, sender, videoOrder } from './world.mjs';

const generateClicks = (page) => page.calls.filter((c) => c === 'clickGenerate').length;

/** A aba bate o coração, pega a ordem, termina de executar e bate de novo (é nessa batida que o resultado chega ao broker). */
async function runOnce(tab) {
  const r = await tab.worker.tick();
  await tab.worker.idle();
  await tab.worker.tick();
  return r;
}

async function ready(world, tabOpts) {
  const tab = world.flowTab(tabOpts);
  await tab.worker.init();
  await tab.worker.tick(); // a conta fica online (sem ordem ainda)
  return tab;
}

describe('geração de ponta a ponta (mock do Flow)', () => {
  it('enqueue → a aba gera UMA vez → o MP4 volta pelo journal e é lido em partes pela ponte (download)', async () => {
    const world = createWorld();
    const tab = await ready(world);
    const q = (await world.rpc('enqueue', videoOrder())).result;
    expect(q.state).toBe('queued');

    await runOnce(tab);
    const done = (await world.rpc('get', { id: q.id })).result;
    expect(done.state).toBe('completed');
    expect(done.result).toMatchObject({ bytes: MOCK_MP4.length, mimeType: 'video/mp4' });
    expect(done.result.mediaRef).toBeTruthy();
    expect(generateClicks(tab.page)).toBe(1);
    expect(world.fetches).toHaveLength(1); // o service worker baixou do host do Flow (https)
    expect(world.fetches[0]).toMatch(/^https:\/\/flow-content\.google\/video\//);

    const part = (await world.rpc('download', { id: q.id, part: 0 })).result;
    expect(part).toMatchObject({ size: MOCK_MP4.length, parts: 1, part: 0, done: true, mimeType: 'video/mp4' });
    expect([...fromBase64(part.base64)]).toEqual([...MOCK_MP4]);
    expect((await world.rpc('download', { id: q.id, part: 1 })).error).toBe('PARTE_INVALIDA');
  });

  it('o prompt e a imagem de partida chegam ao Flow (formato 9:16, imagem anexada antes do prompt)', async () => {
    const world = createWorld();
    const tab = await ready(world);
    const png = 'iVBORw0KGgoAAAAN'; // base64 válido (16 caracteres)
    const q = await world.rpc('enqueue', videoOrder({ args: [{ prompt: 'Lip sync scene', aspectRatio: '9:16', firstFrame: { mimeType: 'image/png', base64: png, name: 'ana.png' } }] }));
    expect(q.result.state).toBe('queued');
    await runOnce(tab);
    expect(tab.page.calls.filter((c) => /^(prepare|attachFirstFrame|typePrompt|clickGenerate)/.test(c))).toEqual(['prepare:9:16:-:frame', 'attachFirstFrame', 'typePrompt', 'clickGenerate']);
    expect(tab.page.state.prompt).toBe('Lip sync scene');
    expect(tab.page.state.frame).toMatchObject({ mimeType: 'image/png' });
  });

  it('vídeo em blob: (a aba lê os bytes) é entregue em partes e confere o tamanho', async () => {
    const world = createWorld();
    const tab = await ready(world, { page: createMockPage({ mediaKind: 'blob' }) });
    const q = (await world.rpc('enqueue', videoOrder())).result;
    await runOnce(tab);
    expect((await world.rpc('get', { id: q.id })).result.state).toBe('completed');
    expect(world.fetches).toHaveLength(0); // não passou pela rede do service worker
    const part = (await world.rpc('download', { id: q.id, part: 0 })).result;
    expect([...fromBase64(part.base64)]).toEqual([...MOCK_MP4]);
  });

  it('o resultado fica no journal: reiniciar o service worker (novo núcleo no mesmo storage) ainda entrega o MP4', async () => {
    const world = createWorld();
    const tab = await ready(world);
    const q = (await world.rpc('enqueue', videoOrder())).result;
    await runOnce(tab);
    const { createServiceWorker } = await import('../background/sw-core.js');
    const reborn = createServiceWorker({ kv: world.kv, now: () => world.clock.t, version: '0.1.0', popupUrl: 'x' });
    const r = await reborn.handleMessage({ type: 'rpc', action: 'download', payload: { id: q.id } }, sender.site());
    expect(r.result.done).toBe(true);
  });
});

describe('falhas: nada é reenviado, e a causa vira código estável', () => {
  it('Flow recusa na hora por cota → failed COTA; a conta fica pausada 24 h e ordens novas são recusadas (retryAt)', async () => {
    const world = createWorld();
    const tab = await ready(world, { page: createMockPage({ outcomes: [{ kind: 'refuse', error: "You've reached your daily quota for video generation" }] }) });
    const q = (await world.rpc('enqueue', videoOrder())).result;
    const hit = world.clock.t;
    await runOnce(tab);
    const o = (await world.rpc('get', { id: q.id })).result;
    expect(o).toMatchObject({ state: 'failed' });
    expect(o.error).toMatch(/^COTA/);
    expect(generateClicks(tab.page)).toBe(1);
    const acc = (await world.rpc('accounts')).result[0];
    expect(acc.cooldownUntil).toBeGreaterThanOrEqual(hit + QUOTA_PAUSE_MS);
    const next = await world.rpc('enqueue', videoOrder({ jobId: 'cena:v2:0', key: 'k2' }));
    expect(next).toMatchObject({ error: 'CONTA_EM_PAUSA_COTA', retryable: true });
    expect(next.retryAt).toBe(acc.cooldownUntil);
  });

  it('cartão que mostra falha na grade (conteúdo recusado) → failed CONTEUDO_RECUSADO, sem pausa de conta', async () => {
    const world = createWorld();
    const tab = await ready(world, { page: createMockPage({ outcomes: [{ kind: 'failed', error: 'Failed: this prompt was blocked by our safety policy' }] }) });
    const q = (await world.rpc('enqueue', videoOrder())).result;
    await runOnce(tab);
    const o = (await world.rpc('get', { id: q.id })).result;
    expect(o.state).toBe('failed');
    expect(o.error).toMatch(/^CONTEUDO_RECUSADO/);
    expect((await world.rpc('accounts')).result[0].cooldownUntil).toBe(0);
  });

  it('seletor ausente ANTES do clique → failed SELETOR_AUSENTE:<nome> (nada enviado, seguro refazer)', async () => {
    const world = createWorld();
    const tab = await ready(world, { page: createMockPage({ missing: ['outputsOne'] }) });
    const q = (await world.rpc('enqueue', videoOrder())).result;
    await runOnce(tab);
    const o = (await world.rpc('get', { id: q.id })).result;
    expect(o).toMatchObject({ state: 'failed', error: 'SELETOR_AUSENTE:outputsOne' });
    expect(generateClicks(tab.page)).toBe(0);
  });

  it('clicou e o cartão nunca apareceu → unknown (ENVIO_NAO_CONFIRMADO): NÃO reenvia, e a conta fica bloqueada', async () => {
    const world = createWorld();
    const tab = await ready(world, { page: createMockPage({ outcomes: [{ kind: 'silent' }] }) });
    const q = (await world.rpc('enqueue', videoOrder())).result;
    await runOnce(tab);
    expect((await world.rpc('get', { id: q.id })).result).toMatchObject({ state: 'unknown' });
    for (let i = 0; i < 3; i++) {
      await world.sleep(4000);
      await runOnce(tab);
    }
    expect(generateClicks(tab.page)).toBe(1); // jamais um segundo clique
    expect((await world.rpc('enqueue', videoOrder({ jobId: 'cena:v2:0', key: 'k2' }))).error).toBe('CONTA_COM_OPERACAO_INCERTA');
  });

  it('comando que a extensão não executa → failed COMANDO_NAO_SUPORTADO (sem tocar na página)', async () => {
    const world = createWorld();
    const tab = await ready(world);
    const q = (await world.rpc('enqueue', videoOrder({ cmd: 'generate.image', args: [{ prompt: 'x', aspectRatio: '9:16' }] }))).result;
    await runOnce(tab);
    expect((await world.rpc('get', { id: q.id })).result).toMatchObject({ state: 'failed', error: 'COMANDO_NAO_SUPORTADO_generate.image' });
    expect(tab.page.calls).not.toContain('clickGenerate');
  });

  it('o projeto mudou entre o pedido e a execução → failed CONTA_OU_PROJETO_MUDOU antes de qualquer clique', async () => {
    const world = createWorld();
    const tab = await ready(world);
    const q = (await world.rpc('enqueue', videoOrder())).result;
    tab.page.state.projectId = '44444444-4444-4444-8444-444444444444'; // a pessoa abriu outro projeto
    await runOnce(tab);
    const o = (await world.rpc('get', { id: q.id })).result;
    // a aba já não bate com o contexto do pedido: a ordem fica na fila (nunca é despachada para a rota errada)
    expect(['queued', 'failed', 'unknown']).toContain(o.state);
    expect(generateClicks(tab.page)).toBe(0);
  });
});

describe('recarregar a aba no meio da geração: relê, nunca repete', () => {
  it('journal da aba: o que estava em voo vira unknown com a identidade do cartão, e a releitura conclui — 1 clique só', async () => {
    const world = createWorld();
    const page = createMockPage({ outcomes: [{ kind: 'ready', reads: 2 }] });
    const tab1 = await ready(world, { page, blockSleep: true });
    const q = (await world.rpc('enqueue', videoOrder())).result;

    // a aba despacha, clica em gerar UMA vez e fica esperando o clipe; "morre" (recarregada) nesse ponto
    await tab1.worker.tick();
    let guard = 0;
    while (!tab1.worker.journal().active[q.id]?.resume?.tileId && guard++ < 200) await new Promise((r) => setTimeout(r, 0));
    expect(tab1.worker.journal().active[q.id].resume.tileId).toBeTruthy();
    expect(generateClicks(page)).toBe(1);
    // o broker ainda nem soube do cartão (o `accepted` está no outbox da aba, que só entrega no próximo coração)
    expect((await world.rpc('get', { id: q.id })).result.state).toBe('dispatched');
    tab1.worker.stop();

    // aba nova (mesmo worker id = mesma aba recarregada; mesmo DOM do Flow com o cartão já na grade)
    const tab2 = world.flowTab({ page, workerId: 'w1' });
    await tab2.worker.init();
    await tab2.worker.tick(); // reporta unknown e já recebe a releitura (modo resume)
    await tab2.worker.idle();
    await tab2.worker.tick(); // entrega o veredito da releitura
    const o = (await world.rpc('get', { id: q.id })).result;
    expect(o.state).toBe('completed');
    expect(generateClicks(page)).toBe(1); // a releitura NÃO clicou em gerar
  });
});

describe('duas abas na mesma conta', () => {
  it('a segunda fica de reserva (CONTA_JA_TEM_ABA_EXECUTORA) e não executa nada', async () => {
    const world = createWorld();
    await ready(world);
    const page2 = createMockPage();
    const tab2 = world.flowTab({ page: page2, workerId: 'w2', tabId: 9 });
    await tab2.worker.init();
    const r = await tab2.worker.tick();
    expect(r.error).toBe('CONTA_JA_TEM_ABA_EXECUTORA');
    expect(tab2.worker.state().standby).toBe(true);
    // depois que a primeira some (presença vence), a segunda assume
    world.advance(PRESENCE_TTL_MS + 1);
    expect((await tab2.worker.tick()).dispatched).toBe(0);
    expect(tab2.worker.state().standby).toBe(false);
  });
});

describe('aba sem conta/projeto pronto', () => {
  it('não entra no broker como executora; só avisa o estado (observe) → saúde "not-ready"', async () => {
    const world = createWorld();
    const tab = world.flowTab({ page: createMockPage({ loggedIn: false }) });
    await tab.worker.init();
    const r = await tab.worker.tick();
    expect(r).toMatchObject({ ready: false, reason: 'SEM_CONTA_LOGADA' });
    const st = (await world.rpc('extensionStatus')).result;
    expect(st.health.state).toBe('not-ready');
    expect(st.accounts).toEqual([]);
  });
});

describe('outbox: confirmação perdida repete a ENTREGA, nunca a geração', () => {
  it('se a resposta do coração se perde, o evento é reenviado e o broker aplica uma vez só', async () => {
    const world = createWorld();
    const tab = await ready(world);
    const q = (await world.rpc('enqueue', videoOrder())).result;
    // perde a resposta (ack) do coração que carrega o evento final
    const realSend = tab.send;
    let lose = false;
    const flaky = async (m) => {
      const r = await realSend(m);
      if (lose && m.type === 'rpc' && m.action === 'heartbeat' && m.payload.events.length) return { error: 'EXTENSAO_INDISPONIVEL', code: 'EXTENSAO_INDISPONIVEL' };
      return r;
    };
    const { createFlowWorker } = await import('../content/flow-worker.js');
    const w2 = createFlowWorker({ driver: tab.driver, send: flaky, storage: world.kv, workerId: 'w1', readBlob: async () => null, now: () => world.clock.t, sleep: world.sleep });
    await w2.init();
    await w2.tick(); // despacha
    lose = true;
    await w2.idle();
    await w2.tick(); // entrega o outbox, mas o ack se perde
    lose = false;
    expect(w2.state().events).toBeGreaterThan(0); // ainda guardado
    await w2.tick(); // reenvia; o broker responde ack
    expect(w2.state().events).toBe(0);
    expect((await world.rpc('get', { id: q.id })).result.state).toBe('completed');
    expect(generateClicks(tab.page)).toBe(1);
  });
});
