/**
 * Núcleo do service worker: quem pode falar com ele, saúde, mídia e popup. (O broker em si: broker.test.mjs.)
 */
import { describe, expect, it } from 'vitest';
import { DEFAULT_ORIGINS, isAllowedMediaUrl, isFlowSender, isPopupSender, isSiteSender, looksLikeMp4, normalizeOrigin } from '../background/policy.js';
import { STATUS_KEY } from '../lib/protocol.js';
import { MOCK_MP4, MOCK_PROJECT } from './mock-page.mjs';
import { POPUP_URL, SITE_URL, FLOW_CTX, createWorld, sender, videoOrder } from './world.mjs';

describe('política de remetentes', () => {
  it('site: só a página do Zerum (/zerum), quadro principal, em origem permitida', () => {
    expect(DEFAULT_ORIGINS).toEqual(['http://127.0.0.1:3100', 'http://localhost:3100']);
    expect(isSiteSender(sender.site())).toBe(true);
    expect(isSiteSender(sender.site('http://localhost:3100/zerum/'))).toBe(true);
    expect(isSiteSender(sender.site('http://127.0.0.1:3100/zerum/api/x'))).toBe(true);
    expect(isSiteSender(sender.site('http://127.0.0.1:3101/zerum'))).toBe(false); // outra porta
    expect(isSiteSender(sender.site('http://127.0.0.1:3100/outra-coisa'))).toBe(false); // fora de /zerum
    expect(isSiteSender(sender.site('http://127.0.0.1:3100/zerumx'))).toBe(false);
    expect(isSiteSender(sender.site('https://evil.example.com/zerum'))).toBe(false);
    expect(isSiteSender(sender.site(SITE_URL, { frameId: 3 }))).toBe(false); // iframe
    expect(isSiteSender({ url: 'lixo' })).toBe(false);
    expect(isSiteSender(sender.site('http://127.0.0.1:3101/zerum'), [...DEFAULT_ORIGINS, 'http://127.0.0.1:3101'])).toBe(true);
  });

  it('aba do Flow: só https://flow.google.com no quadro principal; popup: só a própria página', () => {
    expect(isFlowSender(sender.flow())).toBe(true);
    expect(isFlowSender({ url: 'https://flow.google.com.evil.com/', frameId: 0 })).toBe(false);
    expect(isFlowSender({ url: 'http://flow.google.com/', frameId: 0 })).toBe(false);
    expect(isFlowSender({ url: 'https://flow.google.com/x', frameId: 2 })).toBe(false);
    expect(isPopupSender(sender.popup(), POPUP_URL)).toBe(true);
    expect(isPopupSender({ url: 'https://flow.google.com/' }, POPUP_URL)).toBe(false);
  });

  it('origens: só http em loopback (com porta opcional); o resto é recusado', () => {
    expect(normalizeOrigin('http://127.0.0.1:3101/zerum?x=1')).toBe('http://127.0.0.1:3101');
    expect(normalizeOrigin('http://localhost')).toBe('http://localhost');
    expect(normalizeOrigin('https://127.0.0.1:3100')).toBeNull();
    expect(normalizeOrigin('http://meu-pc.local:3100')).toBeNull();
    expect(normalizeOrigin('http://user:pw@127.0.0.1:3100')).toBeNull();
    expect(normalizeOrigin('nada')).toBeNull();
  });

  it('mídia: só https em hosts do Flow; cabeçalho ftyp para ser MP4', () => {
    expect(isAllowedMediaUrl('https://flow-content.google/video/abc')).toBe(true);
    expect(isAllowedMediaUrl('http://flow-content.google/video/abc')).toBe(false);
    expect(isAllowedMediaUrl('https://flow-content.google.evil.com/x')).toBe(false);
    expect(isAllowedMediaUrl('https://evil.example.com/video.mp4')).toBe(false);
    expect(isAllowedMediaUrl('https://user@flow-content.google/x')).toBe(false);
    expect(isAllowedMediaUrl('blob:https://flow.google.com/x')).toBe(false);
    expect(looksLikeMp4(MOCK_MP4)).toBe(true);
    expect(looksLikeMp4(new Uint8Array(20))).toBe(false);
  });
});

describe('roteamento e autorização', () => {
  it('site pode as 10 ações; ação desconhecida (inclusive a "connect" da 001) e `heartbeat` do site são recusados', async () => {
    const world = createWorld();
    expect((await world.rpc('extensionStatus')).result).toMatchObject({ installed: true, paired: true, version: '0.1.0', protocol: 'zerum-local-flow-v1' });
    expect((await world.rpc('accounts')).result).toEqual([]);
    expect((await world.rpc('connect')).error).toBe('ACAO_NAO_PERMITIDA');
    expect((await world.rpc('heartbeat', { context: FLOW_CTX(), worker: 'w' })).error).toBe('ORIGEM_NAO_PERMITIDA');
  });

  it('outra porta do mesmo computador NÃO manda na extensão — até o usuário autorizar no popup', async () => {
    const world = createWorld();
    const other = sender.site('http://127.0.0.1:3101/zerum');
    expect((await world.rpc('extensionStatus', {}, other)).error).toBe('ORIGEM_NAO_PERMITIDA');
    expect((await world.sw.handleMessage({ type: 'site.hello' }, other)).result.allowed).toBe(false);
    expect((await world.sw.handleMessage({ type: 'popup.origins', origins: ['http://127.0.0.1:3101', 'https://evil.com'] }, sender.popup())).result.origins).toEqual(['http://127.0.0.1:3101']);
    expect((await world.rpc('extensionStatus', {}, other)).result.installed).toBe(true);
    expect((await world.rpc('extensionStatus')).error).toBe('ORIGEM_NAO_PERMITIDA'); // a 3100 deixou de estar na lista (o usuário a trocou)
  });

  it('a aba do Flow só faz heartbeat/worker.*; o site não faz worker.* nem popup.*', async () => {
    const world = createWorld();
    expect((await world.sw.handleMessage({ type: 'rpc', action: 'enqueue', payload: videoOrder() }, sender.flow())).error).toBe('ORIGEM_NAO_PERMITIDA');
    expect((await world.sw.handleMessage({ type: 'worker.observe', info: {} }, sender.site())).error).toBe('ORIGEM_NAO_PERMITIDA');
    expect((await world.sw.handleMessage({ type: 'popup.status' }, sender.site())).error).toBe('ORIGEM_NAO_PERMITIDA');
    expect((await world.sw.handleMessage({ type: 'popup.status' }, sender.flow())).error).toBe('ORIGEM_NAO_PERMITIDA');
    expect((await world.sw.handleMessage({ type: 'qualquer' }, sender.site())).error).toBe('MENSAGEM_DESCONHECIDA');
    expect((await world.sw.handleMessage(null, sender.site())).error).toBe('MENSAGEM_INVALIDA');
  });

  it('erros do broker chegam com código estável, status e (para cota) retryable/retryAt', async () => {
    const world = createWorld();
    const r = await world.rpc('enqueue', videoOrder());
    expect(r).toMatchObject({ error: 'CONTA_PROJETO_OFFLINE', code: 'CONTA_PROJETO_OFFLINE', status: 409 });
    expect(r.retryable).toBeUndefined();
  });

  it('erro inesperado vira ERRO_INTERNO (nada do interior vaza)', async () => {
    const world = createWorld();
    world.kv.failNextSet = true;
    const origErr = console.error;
    console.error = () => {};
    try {
      const r = await world.sw.handleMessage({ type: 'popup.settings', assumeSingleOutput: true }, sender.popup());
      expect(r).toMatchObject({ error: 'ERRO_INTERNO', status: 500 });
    } finally {
      console.error = origErr;
    }
  });

  it('job e beginAttempt devolvem também o contexto (como o original)', async () => {
    const world = createWorld();
    const tab = world.flowTab();
    await tab.worker.init();
    await tab.worker.tick();
    expect((await world.rpc('job', { jobId: 'j', context: FLOW_CTX() })).result).toEqual({ attempt: 0, context: FLOW_CTX() });
    expect((await world.rpc('beginAttempt', { jobId: 'j', context: FLOW_CTX() })).result).toEqual({ attempt: 1, context: FLOW_CTX() });
  });
});

describe('saúde (flow-health)', () => {
  it('closed → not-ready (aba sem login) → healthy (aba pronta), e a saúde sanitizada vai para o storage', async () => {
    const world = createWorld();
    expect((await world.rpc('extensionStatus')).result.health.state).toBe('closed');

    await world.sw.handleMessage({ type: 'worker.observe', info: { context: { accountId: '', projectId: '', accountPath: '' }, ready: false, reason: 'SEM_CONTA_LOGADA' } }, sender.flow());
    const nr = (await world.rpc('extensionStatus')).result;
    expect(nr.health).toMatchObject({ state: 'not-ready' });
    expect(nr.health.detail).toMatch(/Entre na sua conta Google/);
    expect((await world.kv.get([STATUS_KEY]))[STATUS_KEY].health.state).toBe('not-ready');

    const tab = world.flowTab();
    await tab.worker.init();
    await tab.worker.tick();
    const ok = (await world.rpc('extensionStatus')).result;
    expect(ok.health).toMatchObject({ state: 'healthy', context: { accountId: 'ana@gmail.com', projectId: MOCK_PROJECT } });
    expect(ok.accounts[0]).toMatchObject({ online: true, credits: 500, pending: 0 });
    expect(JSON.stringify((await world.kv.get([STATUS_KEY]))[STATUS_KEY])).not.toMatch(/journal|base64|lease/);

    world.advance(25_000); // a aba parou de bater
    expect((await world.rpc('extensionStatus')).result.health.state).toBe('closed');
  });
});

/** Despacha uma ordem e devolve a lease (para testar os endpoints de mídia da aba). */
async function leased(world) {
  const tab = world.flowTab();
  await tab.worker.init();
  await tab.worker.tick();
  const q = (await world.rpc('enqueue', videoOrder())).result;
  const hb = (await tab.send({ type: 'rpc', action: 'heartbeat', payload: { context: FLOW_CTX(), worker: 'w1', events: [], capacity: 1 } })).result;
  return { tab, id: q.id, lease: hb.orders[0].lease };
}

describe('mídia entregue pela aba', () => {
  it('o service worker só baixa https de host do Flow, MP4 de verdade, dentro do limite e com a lease da ordem', async () => {
    const world = createWorld();
    const { id, lease, tab } = await leased(world);
    const base = { type: 'worker.media.fetch', orderId: id, lease, worker: 'w1' };
    const go = (m) => world.sw.handleMessage(m, tab.from);
    expect((await go({ ...base, url: 'https://evil.example.com/v.mp4' })).error).toBe('MIDIA_HOST_NAO_PERMITIDO');
    expect((await go({ ...base, url: 'http://flow-content.google/v' })).error).toBe('MIDIA_HOST_NAO_PERMITIDO');
    expect((await go({ ...base, lease: 'outra', url: 'https://flow-content.google/video/x' })).error).toBe('LEASE_INVALIDA');
    expect(world.fetches).toEqual([]); // nada foi buscado nos casos recusados
    const ok = await go({ ...base, url: 'https://flow-content.google/video/x' });
    expect(ok.result).toMatchObject({ ok: true, bytes: MOCK_MP4.length });
  });

  it('conteúdo que não é MP4 é recusado e não fica guardado', async () => {
    const world = createWorld();
    const { id, lease, tab } = await leased(world);
    const sw = (await import('../background/sw-core.js')).createServiceWorker({
      kv: world.kv,
      now: () => world.clock.t,
      popupUrl: POPUP_URL,
      fetchImpl: async () => ({ ok: true, status: 200, headers: { get: () => '10' }, arrayBuffer: async () => new Uint8Array(20).buffer }),
    });
    const r = await sw.handleMessage({ type: 'worker.media.fetch', orderId: id, lease, worker: 'w1', url: 'https://flow-content.google/video/x' }, tab.from);
    expect(r.error).toBe('CONTEUDO_MIDIA_INVALIDO');
    expect(await world.sw.media.meta(id)).toBeNull();
  });

  it('HTTP de erro do host vira DOWNLOAD_HTTP_<status>', async () => {
    const world = createWorld({ fetchOk: false });
    const { id, lease, tab } = await leased(world);
    const r = await world.sw.handleMessage({ type: 'worker.media.fetch', orderId: id, lease, worker: 'w1', url: 'https://flow-content.google/video/x' }, tab.from);
    expect(r.error).toBe('DOWNLOAD_HTTP_403');
  });

  it('entrega em partes (begin/chunk/end) confere o tamanho e a lease', async () => {
    const world = createWorld();
    const { id, lease, tab } = await leased(world);
    const base = { orderId: id, lease, worker: 'w1' };
    const go = (m) => world.sw.handleMessage({ ...base, ...m }, tab.from);
    expect((await go({ type: 'worker.media.begin' })).result.ok).toBe(true);
    const b64 = Buffer.from(MOCK_MP4).toString('base64');
    expect((await go({ type: 'worker.media.chunk', b64 })).result.size).toBe(MOCK_MP4.length);
    expect((await go({ type: 'worker.media.end', expectedBytes: 999 })).error).toBe('MIDIA_TAMANHO_DIVERGENTE');
    expect((await go({ type: 'worker.media.end', expectedBytes: MOCK_MP4.length })).result.bytes).toBe(MOCK_MP4.length);
    expect((await go({ type: 'worker.media.chunk', b64: 'x'.repeat(5_000_000) })).error).toBe('PARTE_INVALIDA');
    expect((await go({ type: 'worker.media.begin', lease: 'velha' })).error).toBe('LEASE_INVALIDA');
  });

  it('download só de ordem CONCLUÍDA; id inexistente → 404', async () => {
    const world = createWorld();
    const { id } = await leased(world);
    expect((await world.rpc('download', { id })).error).toBe('ORDEM_NAO_CONCLUIDA');
    expect((await world.rpc('download', { id: 'nada' })).status).toBe(404);
  });
});

describe('popup', () => {
  const popup = (world, m) => world.sw.handleMessage(m, sender.popup());

  it('status completo, pausa de conta, ajustes e limpeza do histórico', async () => {
    const world = createWorld();
    const tab = world.flowTab();
    await tab.worker.init();
    await tab.worker.tick();
    expect((await popup(world, { type: 'popup.pause', email: 'ana@gmail.com', paused: true })).result.paused).toEqual(['ana@gmail.com']);
    const st = (await popup(world, { type: 'popup.status' })).result;
    expect(st).toMatchObject({ version: '0.1.0', assumeSingleOutput: false, origins: DEFAULT_ORIGINS });
    expect(st.accounts[0].paused).toBe(true);
    expect((await popup(world, { type: 'popup.settings', assumeSingleOutput: true })).result.assumeSingleOutput).toBe(true);
    expect((await popup(world, { type: 'popup.origins', origins: [] })).error).toBe('ORIGEM_INVALIDA');
    expect((await popup(world, { type: 'popup.prune' })).result).toEqual({ removed: 0 });
    expect((await popup(world, { type: 'popup.nao-existe' })).error).toBe('ACAO_NAO_PERMITIDA');
  });

  it('abrir o Flow: reaproveita a aba aberta, senão cria uma (nunca fora do flow.google.com)', async () => {
    const world = createWorld();
    expect((await popup(world, { type: 'popup.open-flow' })).result).toEqual({ ok: true });
    expect(world.tabsApi.created).toEqual({ url: 'https://flow.google.com/', active: true });
    world.tabsApi.tabs = [{ id: 5 }];
    expect((await popup(world, { type: 'popup.open-flow' })).result).toEqual({ ok: true, reused: true });
  });

  it('diagnóstico sem aba do Flow avisa NENHUMA_ABA_DO_FLOW', async () => {
    const world = createWorld();
    expect((await popup(world, { type: 'popup.probe' })).error).toBe('NENHUMA_ABA_DO_FLOW');
  });
});

describe('alarme periódico', () => {
  it('aplica os prazos do broker e acorda as abas do Flow', async () => {
    const world = createWorld();
    world.tabsApi.tabs = [{ id: 3 }];
    const pulses = [];
    world.tabsApi.sendMessage = async (id, m) => pulses.push([id, m.type]);
    await world.sw.onAlarm();
    expect(pulses).toEqual([[3, 'flow.pulse']]);
  });
});
