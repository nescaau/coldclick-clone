/**
 * SMOKE HTTP da ponte simulada — roda contra um servidor Zerum de VERDADE (ex.: `next start` na porta 3101, com
 * ZERUM_DATA_DIR temporário), não contra os serviços em processo:
 *
 *   ZERUM_SMOKE_BASE=http://127.0.0.1:3101 npx vitest run extensao/test/smoke-http.test.mjs
 *
 * A "extensão" é o harness: os módulos REAIS da extensão (relay, service worker, broker, journal, worker) sobre a página
 * FALSA do Flow, ligados à bomba da página (TS) por window.postMessage falso. O servidor é tratado só por HTTP, como o
 * navegador faria — passa pelas rotas do Next, pelo zod e pelo middleware (Host/CSRF). Nada de rede externa; nada toca
 * numa conta Flow real. Sem ZERUM_SMOKE_BASE o teste é ignorado (o `npm test` não precisa de servidor).
 */
import nodeHttp from 'node:http';
import { describe, expect, it } from 'vitest';
import { startSiteRelay } from '../content/site-relay.js';
import { createMockPage } from './mock-page.mjs';
import { createFakeChrome, createFakeWindow, createWorld, sender } from './world.mjs';
import { BridgeClient, windowEnv } from '../../src/lib/bridge/client.ts';
import { ExtensionFlowExecutor } from '../../src/lib/bridge/executor.ts';
import { BridgePump } from '../../src/lib/bridge/pump.ts';
import { buildClip } from '../../src/lib/domain/mp4-concat-fixture.ts';
import { readMp4Tracks } from '../../src/lib/domain/mp4-concat.ts';
import { buildMp4 } from '../../src/lib/domain/mp4-fixture.ts';

const BASE = process.env.ZERUM_SMOKE_BASE ?? '';
const API = `${BASE}/zerum/api`;

const http = async (method, path, body) => {
  const res = await fetch(`${API}${path}`, { method, headers: body !== undefined ? { 'content-type': 'application/json' } : undefined, body: body !== undefined ? JSON.stringify(body) : undefined });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw Object.assign(new Error(data.error ?? `HTTP ${res.status}`), { status: res.status });
  return data;
};

/** A PumpApi da página, mas sobre HTTP de verdade (o que lib/bridge/pump-api.ts faz dentro do navegador). */
const httpApi = {
  heartbeat: (b) => http('POST', '/bridge/heartbeat', b),
  claim: (b) => http('POST', '/bridge/claim', b),
  progress: (w, pumpId, orderId) => http('POST', `/bridge/scenes/${w.videoId}/${w.sceneIdx}/progress`, { pumpId, orderId }),
  uploadClip: async (w, pumpId, orderId, mediaRef, bytes) => {
    const res = await fetch(`${API}/bridge/scenes/${w.videoId}/${w.sceneIdx}/clip?pumpId=${pumpId}&orderId=${orderId}&mediaRef=${encodeURIComponent(mediaRef)}`, { method: 'PUT', headers: { 'content-type': 'video/mp4' }, body: bytes });
    const data = await res.json().catch(() => ({}));
    if (!res.ok) throw Object.assign(new Error(data.error ?? `HTTP ${res.status}`), { status: res.status });
    return data;
  },
  fail: (w, body) => http('POST', `/bridge/scenes/${w.videoId}/${w.sceneIdx}/fail`, body),
  settings: async () => {
    const s = await http('GET', '/settings');
    return { parallel: s.parallel, autoSwitch: s.autoSwitch, minCredits: s.minCredits };
  },
  photo: async (id) => {
    const res = await fetch(`${API}/avatars/${id}/photo`);
    return { bytes: new Uint8Array(await res.arrayBuffer()), mime: res.headers.get('content-type') ?? '' };
  },
};

describe.skipIf(!BASE)('smoke HTTP: Zerum rodando + extensão simulada', () => {
  it('sem extensão: status EXTENSAO_NAO_INSTALADA e o lote espera na fila; as páginas e o pacote da extensão respondem', async () => {
    const st = await http('GET', '/bridge/status');
    expect(st).toMatchObject({ ready: false });
    expect(st.detail).toMatch(/^EXTENSAO_NAO_INSTALADA;/);

    const page = await fetch(`${BASE}/zerum/extensao`);
    expect(page.status).toBe(200);
    expect(await page.text()).toMatch(/Extensão Zerum/);
    expect((await fetch(`${BASE}/zerum`)).status).toBe(200);

    const zip = await fetch(`${API}/extension/package`);
    expect(zip.status).toBe(200);
    expect(zip.headers.get('content-type')).toBe('application/zip');
    const bytes = Buffer.from(await zip.arrayBuffer());
    expect(bytes.subarray(0, 4).toString('hex')).toBe('504b0304'); // PK\3\4
    const names = bytes.toString('latin1');
    expect(names).toContain('zerum-extensao/manifest.json');
    expect(names).toContain('zerum-extensao/background/broker.js');
    expect(names).toContain('zerum-extensao/INSTALAR.txt');
    expect(names).not.toContain('zerum-extensao/test/'); // testes e ferramentas ficam de fora
  });

  it('lote de 2 cenas: a extensão simulada gera cena a cena pelo HTTP real; o vídeo fica PRONTO, sem selo SIMULADO, e o MP4 baixado é o do Flow', async () => {
    await http('PATCH', '/settings', { simulation: false, parallel: 1 });

    // um viral de 16 s (2 cenas) com a fala preenchida
    const conv = await http('POST', '/conversations', { mode: 'viral' });
    const form = new FormData();
    form.append('file', new File([buildMp4({ durationS: 16, salt: Date.now() % 100000 })], 'smoke.mp4', { type: 'video/mp4' }));
    const up = await fetch(`${API}/conversations/${conv.id}/viral`, { method: 'POST', body: form });
    expect([200, 201]).toContain(up.status);
    const viralId = (await up.json()).conversation.viral.id;
    await http('PATCH', `/virals/${viralId}/analysis`, {
      pessoas: [], rosto: true, legenda: false, tela: 'sala', acoes: '', enquadramento: 'vertical', estrutura: '',
      transcricao: 'Primeira frase do viral. Segunda frase do viral.',
    });
    const sent = await http('POST', `/conversations/${conv.id}/messages`, { text: '1 vídeo', attachments: [] });
    const { batch } = await http('POST', `/plans/${sent.plan.id}/confirm`);
    expect(batch.videos).toHaveLength(1);

    // a extensão simulada (módulos reais, página falsa do Flow)
    let seed = 1;
    const world = createWorld({ clip: () => buildClip({ videoFrames: 25, audioFrames: 40, seed: seed++ }).bytes });
    const page = createMockPage();
    const tab = world.flowTab({ page, capacity: 2 });
    await tab.worker.init();
    await tab.worker.tick();
    const win = createFakeWindow();
    Object.assign(win, { crypto: globalThis.crypto, setTimeout: (f, ms) => setTimeout(f, ms), clearTimeout: (h) => clearTimeout(h) });
    startSiteRelay({ window: win, chrome: createFakeChrome({ kv: world.kv, sw: world.sw, sender: sender.site() }) });
    const ext = new ExtensionFlowExecutor(new BridgeClient(windowEnv(win)), { installed: () => true });
    const pump = new BridgePump({
      api: httpApi,
      ext: ext.api,
      status: () => ext.status(),
      selectedAccount: () => null,
      pumpId: `smoke-${Date.now()}`,
      sleep: async (ms) => {
        world.advance(ms);
        await tab.worker.tick();
        await new Promise((r) => setTimeout(r, 0));
      },
      now: () => Date.now(), // o servidor usa o relógio de verdade
    });

    // o servidor passa a enxergar a extensão: status real e modo "real"
    await pump.tick();
    const st = await http('GET', '/bridge/status');
    expect(st).toMatchObject({ ready: true });
    expect(st.detail).toBe('Flow ligado: ana@gmail.com · 500 créditos');
    expect(st.checklist).toEqual({ extensionInstalled: true, extensionConnected: true, flowTabOpen: true, accountChosen: true });

    for (let i = 0; i < 40; i++) {
      await pump.tick();
      await pump.idle();
      const b = (await http('GET', '/batches')).find((x) => x.id === batch.id);
      if (b.videos[0].state === 'pronto') break;
      await new Promise((r) => setTimeout(r, 20));
    }
    const done = (await http('GET', '/batches')).find((x) => x.id === batch.id);
    expect(done.videos[0]).toMatchObject({ state: 'pronto', scenesDone: 2, simulated: false });
    expect(done.state).toBe('pronto');
    expect(page.calls.filter((c) => c === 'clickGenerate')).toHaveLength(2); // uma geração por cena

    // o download é o MP4 juntado das duas cenas do "Flow" (não uma cópia do viral)
    const dl = await fetch(`${API}/videos/${done.videos[0].id}/download`);
    expect(dl.status).toBe(200);
    expect(dl.headers.get('content-type')).toBe('video/mp4');
    const [v, a] = readMp4Tracks(new Uint8Array(await dl.arrayBuffer()));
    expect(v.samples).toHaveLength(50);
    expect(a.samples).toHaveLength(80);
    const ready = await http('GET', '/videos');
    expect(ready.flatMap((g) => g.videos).find((x) => x.id === done.videos[0].id)).toMatchObject({ simulated: false });
    expect((await fetch(`${API}/batches/${batch.id}/zip`)).status).toBe(200);

    const log = await http('GET', `/batches/${batch.id}`);
    expect(log.some((l) => /PRONTO \(2 cenas\) — MP4 baixado do Flow/.test(l.message))).toBe(true);

    // limpeza + volta ao padrão
    await http('DELETE', `/batches/${batch.id}`);
    await http('PATCH', '/settings', { simulation: true, parallel: 4 });
  });

  it('as rotas novas validam a entrada (400) e respeitam o middleware (Host)', async () => {
    const bad = await fetch(`${API}/bridge/heartbeat`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ pumpId: '', status: {} }) });
    expect(bad.status).toBe(400);
    const wrongType = await fetch(`${API}/bridge/claim`, { method: 'POST', headers: { 'content-type': 'text/plain' }, body: '{}' });
    expect(wrongType.status).toBe(415);
    const notMp4 = await fetch(`${API}/bridge/scenes/x/0/clip?pumpId=p`, { method: 'PUT', headers: { 'content-type': 'text/html' }, body: 'x' });
    expect(notMp4.status).toBe(415);
    // DNS rebinding: o `fetch` do Node não deixa trocar o cabeçalho Host; um request cru deixa.
    const url = new URL(BASE);
    const status = await new Promise((resolve, reject) => {
      const req = nodeHttp.request({ host: url.hostname, port: url.port, path: '/zerum/api/bridge/status', headers: { host: 'evil.example.com' } }, (res) => {
        res.resume();
        resolve(res.statusCode);
      });
      req.on('error', reject);
      req.end();
    });
    expect(status).toBe(403);
  });
});
