/**
 * A CADEIA INTEIRA, sem Chrome e sem Flow de verdade:
 *
 *   servidor (SQLite real, serviços reais) ⇄ bomba da página (TS) ⇄ BridgeClient (TS, 25 s) ⇄ window.postMessage (janela falsa)
 *   ⇄ relay do site (JS) ⇄ service worker + broker + journal (JS) ⇄ worker da aba do Flow (JS) ⇄ driver ⇄ página FALSA do Flow
 *
 * É o "mock da extensão" do pedido: prova que um lote vira MP4 do Flow ponta a ponta, que o clique em "gerar" acontece
 * UMA vez por cena mesmo com resposta perdida/cota/cancelamento, e que o app sem extensão continua como sempre.
 */
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { afterAll, afterEach, beforeAll, describe, expect, it, vi } from 'vitest';
import { startSiteRelay } from '../content/site-relay.js';
import { createMockPage } from './mock-page.mjs';
import { ERR_NO_RESPONSE, QUOTA_PAUSE_MS } from '../lib/protocol.js';
import { createFakeChrome, createFakeWindow, createWorld, sender } from './world.mjs';
import { BridgeClient, windowEnv } from '../../src/lib/bridge/client.ts';
import { ExtensionFlowExecutor } from '../../src/lib/bridge/executor.ts';
import { BridgePump } from '../../src/lib/bridge/pump.ts';
import { buildClip } from '../../src/lib/domain/mp4-concat-fixture.ts';
import { buildMp4 } from '../../src/lib/domain/mp4-fixture.ts';
import { readMp4Tracks } from '../../src/lib/domain/mp4-concat.ts';

const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'zerum-chain-'));
process.env.ZERUM_DATA_DIR = dir;

let S; // serviços do servidor
let seed = 1;
const clip = () => buildClip({ videoFrames: 25, audioFrames: 40, seed: seed++ }).bytes;

beforeAll(async () => {
  const boot = await import('../../src/lib/services/bootstrap.ts');
  boot.ensureBootstrapped();
  S = {
    prod: await import('../../src/lib/services/production-service.ts'),
    viral: await import('../../src/lib/services/viral-service.ts'),
    settings: await import('../../src/lib/services/settings-service.ts'),
    bridge: await import('../../src/lib/services/bridge-service.ts'),
    real: await import('../../src/lib/services/real-service.ts'),
    avatar: await import('../../src/lib/services/avatar-service.ts'),
  };
});

afterEach(() => {
  S.settings.patchSettings({ simulation: true, parallel: 2, autoSwitch: false, minCredits: 20 });
  S.bridge.resetBridge();
  for (const b of S.prod.listAllBatches()) S.prod.discardBatch(b.id);
  vi.restoreAllMocks();
});
afterAll(() => {
  globalThis.__zerumDb?.close();
  globalThis.__zerumDb = undefined;
  fs.rmSync(dir, { recursive: true, force: true });
});

/** Servidor em processo: a mesma `PumpApi` da página, sem HTTP. */
const serverApi = () => ({
  heartbeat: async (b) => S.bridge.reportHeartbeat(b),
  claim: async (b) => S.real.claimWork(b),
  progress: async (w, pumpId, orderId) => S.real.sceneProgress({ videoId: w.videoId, idx: w.sceneIdx, pumpId, orderId }),
  uploadClip: async (w, pumpId, orderId, mediaRef, bytes) => S.real.acceptClip({ videoId: w.videoId, idx: w.sceneIdx, pumpId, orderId, mediaRef, bytes }),
  fail: async (w, body) => S.real.failScene({ videoId: w.videoId, idx: w.sceneIdx, ...body }),
  settings: async () => {
    const s = S.settings.getSettings();
    return { parallel: s.parallel, autoSwitch: s.autoSwitch, minCredits: s.minCredits };
  },
  photo: async (id) => {
    const p = S.avatar.avatarPhoto(id);
    return { bytes: new Uint8Array(fs.readFileSync(p.path)), mime: p.mime };
  },
});

/** Monta tudo: mundo da extensão + janela da página + bomba. `shrinkTimeouts`: 25 s da ponte viram 40 ms (teste de resposta perdida). */
async function rig({ page = createMockPage(), installed = true, shrinkTimeouts = false, dropResponses, blockSleep = false } = {}) {
  const world = createWorld({ clip });
  vi.spyOn(Date, 'now').mockImplementation(() => world.clock.t); // servidor, bomba e extensão no MESMO relógio
  const tab = world.flowTab({ page, capacity: 2, blockSleep });
  await tab.worker.init();
  if (installed) await tab.worker.tick(); // a conta fica online

  const win = createFakeWindow();
  Object.assign(win, { crypto: globalThis.crypto, setTimeout: (f, ms) => setTimeout(f, ms), clearTimeout: (h) => clearTimeout(h) });
  const siteChrome = createFakeChrome({ kv: world.kv, sw: world.sw, sender: sender.site() });
  if (dropResponses) {
    const real = siteChrome.runtime.sendMessage;
    siteChrome.runtime.sendMessage = async (m) => {
      const r = await real(m);
      if (dropResponses(m)) return new Promise(() => {}); // a extensão FEZ, mas a resposta nunca chega à página
      return r;
    };
  }
  if (installed) startSiteRelay({ window: win, chrome: siteChrome });
  const env = windowEnv(win);
  // `gate.blackhole`: a extensão "some" (pedidos não chegam) — o prazo de 25 s da ponte decide.
  const gate = { blackhole: false };
  const client = new BridgeClient({ ...env, post: (m) => !gate.blackhole && env.post(m), ...(shrinkTimeouts ? { setTimeout: (f, ms) => env.setTimeout(f, Math.min(ms, 40)) } : {}) });
  const ext = new ExtensionFlowExecutor(client, { installed: () => installed });

  const pump = new BridgePump({
    api: serverApi(),
    ext: ext.api,
    status: () => ext.status(),
    selectedAccount: () => null,
    pumpId: 'pump-1',
    now: () => world.clock.t,
    // o "esperar" da bomba move o relógio e bate o coração da aba do Flow (é o que faria o setInterval do navegador)
    sleep: async (ms) => {
      world.advance(ms);
      await tab.worker.tick();
      await new Promise((r) => setTimeout(r, 0));
    },
    timing: { pollMs: 3000, renewMs: 10_000, busyRetryMs: 1000, getRetryMs: 100 },
  });
  return { world, tab, page, pump, ext, client, win, gate };
}

const generateClicks = (page) => page.calls.filter((c) => c === 'clickGenerate').length;

function mkBatch({ scenes = 2, quantity = 1 } = {}) {
  const viral = S.viral.storeViral({ name: `chain${seed++}.mp4`, bytes: buildMp4({ durationS: scenes * 8, salt: seed }) }).viral;
  S.viral.correctAnalysis(viral.id, {
    pessoas: [], rosto: true, legenda: false, tela: 'sala de estar', acoes: '', enquadramento: 'vertical', estrutura: '',
    transcricao: Array.from({ length: scenes }, (_, i) => `Frase ${i + 1} do viral.`).join(' '),
  });
  return S.prod.openBatch({
    conversationId: null, viralId: viral.id, source: 'manual', title: 'Cadeia', requestText: '',
    params: { quantity, path: 'igual', variation: 'sem', language: 'en', word: '', batchName: 'Cadeia', bubbleOn: true, bubbleColor: '#FFC400', notes: '', newAvatars: 0 },
    avatarNames: [],
  });
}

/** Roda a bomba até `done()` (cada volta: reserva cenas e espera elas terminarem). */
async function drive(r, done, max = 60) {
  for (let i = 0; i < max; i++) {
    await r.pump.tick();
    await r.pump.idle();
    if (done()) return i;
    r.world.advance(4000);
  }
  throw new Error(`não terminou em ${max} voltas (${r.pump.lastReason})`);
}
const vid = (b) => S.prod.getBatchDTO(b.id).videos;

describe('geração real de ponta a ponta', () => {
  it('lote de 2 cenas: cada cena gerada UMA vez no Flow, MP4 baixado, cenas juntadas, vídeo PRONTO sem selo SIMULADO', async () => {
    S.settings.patchSettings({ simulation: false });
    const r = await rig();
    const b = mkBatch({ scenes: 2 });
    await drive(r, () => vid(b)[0].state === 'pronto');

    expect(vid(b)[0]).toMatchObject({ state: 'pronto', scenesDone: 2, simulated: false });
    expect(generateClicks(r.page)).toBe(2); // uma por cena — jamais um clique a mais
    expect(r.world.fetches).toHaveLength(2); // dois downloads do host do Flow
    const media = S.prod.videoMedia(vid(b)[0].id);
    const [v, a] = readMp4Tracks(new Uint8Array(fs.readFileSync(media.path)));
    expect(v.samples).toHaveLength(50); // 25 + 25 amostras de vídeo, vindas do "Flow"
    expect(a.samples).toHaveLength(80);

    // o prompt que o Flow recebeu é o da cena, com a fala dela
    expect(r.page.state.prompt).toMatch(/Frase 2 do viral/);
    const log = S.prod.batchEvents(b.id).map((l) => l.message).join('\n');
    expect(log).toMatch(/começou a gerar de verdade no Flow/);
    expect(log).toMatch(/cena 1\/2 pronta — clipe baixado do Flow/);
    expect(log).toMatch(/PRONTO \(2 cenas\) — MP4 baixado do Flow \(conta ana@gmail\.com\)/);
    expect(S.prod.getBatchDTO(b.id).state).toBe('pronto');
  });

  it('dois vídeos em paralelo (1 aba, 2 simultâneos): os envios são em fila, nenhum clique se repete, os dois ficam prontos', async () => {
    S.settings.patchSettings({ simulation: false, parallel: 2 });
    const r = await rig();
    const b = mkBatch({ scenes: 1, quantity: 2 });
    await drive(r, () => vid(b).every((v) => v.state === 'pronto'));
    expect(generateClicks(r.page)).toBe(2);
    expect(vid(b).every((v) => !v.simulated)).toBe(true);
    // e o broker da extensão tem exatamente 2 ordens concluídas
    const orders = (await r.world.sw.broker.snapshot()).orders;
    expect(orders.filter((o) => o.state === 'completed')).toHaveLength(2);
  });

  it('simulação LIGADA: a extensão presente não é usada (nada vai ao Flow) e o selo SIMULADO continua', async () => {
    const r = await rig();
    const b = mkBatch({ scenes: 1 });
    await r.pump.tick();
    expect(r.pump.lastReason).toBe('SIMULACAO_LIGADA');
    S.prod.tickBatches(r.world.clock.t);
    r.world.advance(30_000);
    S.prod.tickBatches(r.world.clock.t);
    expect(vid(b)[0]).toMatchObject({ state: 'pronto', simulated: true });
    expect(generateClicks(r.page)).toBe(0);
  });

  it('SEM extensão (simulação desligada): fila + EXTENSAO_NAO_INSTALADA, nada avança, nada é pedido', async () => {
    S.settings.patchSettings({ simulation: false });
    const r = await rig({ installed: false });
    const b = mkBatch({ scenes: 1 });
    await r.pump.tick();
    expect(r.pump.lastReason).toBe('EXTENSAO_NAO_CONECTADA');
    expect(vid(b)[0].state).toBe('fila');
    expect(S.prod.getBatchDTO(b.id).state).toBe('na_fila');
    const st = await S.bridge.getBridgeStatus();
    expect(st.ready).toBe(false);
    expect(st.detail).toMatch(/^EXTENSAO_NAO_INSTALADA;/);
  });
});

describe('resposta perdida, cota e cancelamento', () => {
  it('a resposta do `enqueue` se perde (25 s sem resposta): a bomba reenvia a MESMA chave; o broker devolve a mesma ordem — gera UMA vez', async () => {
    S.settings.patchSettings({ simulation: false });
    let dropped = 0;
    const r = await rig({ shrinkTimeouts: true, dropResponses: (m) => m.action === 'enqueue' && dropped++ === 0 });
    const b = mkBatch({ scenes: 1 });
    const logs = [];
    r.pump.d.log = (m) => logs.push(m);
    await drive(r, () => vid(b)[0].state === 'pronto');
    expect(dropped).toBeGreaterThanOrEqual(2); // o 1º foi perdido, o reenvio passou
    expect(logs.some((m) => /não respondeu o pedido; reenviando a mesma chave/.test(m))).toBe(true);
    expect(generateClicks(r.page)).toBe(1);
    expect((await r.world.sw.broker.snapshot()).orders).toHaveLength(1); // uma ordem só
  });

  it('cota do Flow (429): o vídeo falha com a hora da volta, a conta fica em pausa de 24 h e o app para de pedir', async () => {
    S.settings.patchSettings({ simulation: false, parallel: 1 });
    const page = createMockPage({ outcomes: [{ kind: 'refuse', error: 'Daily quota exceeded (429)' }] });
    const r = await rig({ page });
    const b = mkBatch({ scenes: 2, quantity: 2 });
    const t0 = r.world.clock.t;
    await drive(r, () => vid(b)[0].state === 'falhou');
    expect(vid(b)[0].error).toMatch(/atingiu a cota e fica em pausa até (amanhã |\d{2}\/\d{2} )?\d{2}:\d{2}/); // o relógio do mundo é falso: o dia depende dele
    expect(generateClicks(page)).toBe(1);

    const acc = (await r.world.rpc('accounts')).result[0];
    expect(acc.cooldownUntil).toBeGreaterThanOrEqual(t0 + QUOTA_PAUSE_MS);
    // a próxima volta já vê a conta pausada: o status deixa de ser "pronto", o servidor entra em "espera" e nada novo é pedido
    await r.pump.tick();
    expect((await S.bridge.getBridgeStatus()).detail).toMatch(/^COTA_PAUSADA;/);
    expect(S.bridge.executionMode(r.world.clock.t)).toBe('espera');
    await r.pump.tick();
    expect(generateClicks(page)).toBe(1); // o 2º vídeo do lote NÃO foi enviado
    expect(vid(b)[1].state).toBe('fila');
  });

  it('cancelar o lote no meio: a extensão ainda termina o clipe no Flow, mas o app o IGNORA (nenhum arquivo guardado, vídeo continua cancelado)', async () => {
    S.settings.patchSettings({ simulation: false });
    const r = await rig({ blockSleep: true }); // a aba do Flow fica "esperando o clipe" até eu liberar
    const b = mkBatch({ scenes: 1 });
    await r.pump.tick(); // reserva a cena e começa a executar
    for (let i = 0; i < 200 && generateClicks(r.page) === 0; i++) await new Promise((x) => setTimeout(x, 0));
    expect(generateClicks(r.page)).toBe(1); // o clique em gerar já aconteceu
    S.prod.cancelBatch(b.id);
    r.tab.release(); // o Flow termina o clipe
    await r.pump.idle();
    expect(vid(b)[0].state).toBe('cancelado');
    expect(S.prod.getBatchDTO(b.id).state).toBe('cancelado');
    expect(generateClicks(r.page)).toBe(1); // e não gerou mais nada
    const flowDir = path.join(dir, 'flow');
    expect(!fs.existsSync(flowDir) || fs.readdirSync(flowDir).length === 0).toBe(true);
  });
});

describe('o estado real aparece na UI (conta e créditos)', () => {
  it('status da extensão → "Flow ligado: conta · créditos"; o servidor espelha o mesmo texto', async () => {
    S.settings.patchSettings({ simulation: false });
    const r = await rig();
    const st = await r.ext.status();
    expect(st).toMatchObject({ ready: true, version: '0.1.0' });
    expect(st.detail).toBe('Flow ligado: ana@gmail.com · 500 créditos');
    expect(st.accounts[0]).toMatchObject({ email: 'ana@gmail.com', credits: 500, online: true });
    await r.pump.tick();
    const mirrored = await S.bridge.getBridgeStatus();
    expect(mirrored.detail).toBe(st.detail);
    expect(mirrored.checklist).toEqual({ extensionInstalled: true, extensionConnected: true, flowTabOpen: true, accountChosen: true });
  });

  it('extensão que respondia e PAROU de responder → o texto literal do original (EXTENSAO_SEM_RESPOSTA; pedido preservado…), não "não instalada"', async () => {
    S.settings.patchSettings({ simulation: false });
    const r = await rig({ shrinkTimeouts: true });
    expect((await r.ext.status()).ready).toBe(true);
    r.gate.blackhole = true; // a extensão deixa de responder
    const st = await r.ext.status();
    expect(st.ready).toBe(false);
    expect(st.detail).toBe(ERR_NO_RESPONSE);
    expect(st.detail).toBe('EXTENSAO_SEM_RESPOSTA; pedido preservado, não gerar outra vez');
    expect(st.checklist.extensionInstalled).toBe(true);
    expect(st.checklist.extensionConnected).toBe(false);
  });
});
