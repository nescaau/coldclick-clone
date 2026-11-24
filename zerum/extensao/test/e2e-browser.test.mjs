/**
 * E2E NO NAVEGADOR DE VERDADE (opcional; não roda no `npm test`).
 *
 * Um Chromium-família real (Edge/Chromium; o Chrome "de marca" ≥ 137 ignora --load-extension) com a extensão MV3 carregada
 * SEM compactação, o app Zerum de verdade (servidor Next + a página com a bomba React) e um "Flow de mentira"
 * (test/browser/mock-flow.mjs) que o navegador enxerga como https://flow.google.com. Prova o que o Node não prova: o
 * manifesto, o service worker em módulo, a injeção dos content scripts (import dinâmico + web_accessible_resources), o
 * relay por postMessage de verdade, o driver mexendo num DOM de verdade e o MP4 juntado TOCANDO num <video> real.
 *
 * Como rodar (exemplo: WSL2 + Edge do Windows, rede espelhada):
 *   1. app:     ZERUM_DATA_DIR=<tmp> next start -H 127.0.0.1 -p 3101    (build em /tmp)
 *   2. browser: msedge.exe --headless=new --remote-debugging-port=9333 --remote-allow-origins=* --user-data-dir=<tmp>
 *                 --load-extension=<cópia de zerum/extensao> --ignore-certificate-errors
 *                 "--host-resolver-rules=MAP flow.google.com 127.0.0.1:8443, MAP flow-content.google 127.0.0.1:8443"
 *                 --disable-background-timer-throttling --disable-renderer-backgrounding about:blank
 *   3. teste:   ZERUM_E2E_CDP=http://127.0.0.1:9333 ZERUM_E2E_APP=http://127.0.0.1:3101 npx vitest run extensao/test/e2e-browser.test.mjs
 *
 * Perfil TEMPORÁRIO e NOVO a cada execução (sem contas do usuário; o cenário de cota deixa a conta em pausa de 24 h dentro
 * da extensão, então rodar de novo no mesmo perfil falha de propósito, com a mensagem dizendo o porquê). Nenhuma conta
 * Flow real é tocada: o "Flow" é este mock local.
 */
import { afterAll, describe, expect, it } from 'vitest';
import { startMockFlow, MOCK_PROJECT_ID } from './browser/mock-flow.mjs';
import { parseMp4Meta } from '../../src/lib/domain/mp4.ts';
import { readMp4Tracks } from '../../src/lib/domain/mp4-concat.ts';
import { buildMp4 } from '../../src/lib/domain/mp4-fixture.ts';
import { PLACEHOLDER_MP4 } from '../../src/lib/services/placeholder-clip.ts';

const CDP = process.env.ZERUM_E2E_CDP ?? '';
const APP = process.env.ZERUM_E2E_APP ?? '';
const API = `${APP}/zerum/api`;

// ─── cliente CDP mínimo (WebSocket global do Node 22+) ───────────────────────────────────────────────────────────────
class Cdp {
  constructor(ws) {
    this.ws = ws;
    this.n = 0;
    this.pending = new Map();
    ws.addEventListener('message', (e) => {
      const m = JSON.parse(e.data);
      const p = m.id && this.pending.get(m.id);
      if (p) {
        this.pending.delete(m.id);
        m.error ? p.rej(new Error(`${p.method}: ${m.error.message}`)) : p.res(m.result);
      }
    });
  }
  static async connect(base) {
    const v = await (await fetch(`${base}/json/version`)).json();
    const ws = new WebSocket(v.webSocketDebuggerUrl);
    await new Promise((res, rej) => {
      ws.addEventListener('open', res, { once: true });
      ws.addEventListener('error', () => rej(new Error('CDP: não conectou')), { once: true });
    });
    return new Cdp(ws);
  }
  send(method, params = {}, sessionId) {
    const id = ++this.n;
    this.ws.send(JSON.stringify({ id, method, params, sessionId }));
    return new Promise((res, rej) => this.pending.set(id, { res, rej, method }));
  }
  /** Abre uma aba e devolve um "handle" com eval() no contexto da página. */
  async open(url) {
    const { targetId } = await this.send('Target.createTarget', { url });
    const { sessionId } = await this.send('Target.attachToTarget', { targetId, flatten: true });
    const tab = {
      targetId,
      eval: async (expression) => {
        const r = await this.send('Runtime.evaluate', { expression, awaitPromise: true, returnByValue: true }, sessionId);
        if (r.exceptionDetails) throw new Error(`eval: ${r.exceptionDetails.exception?.description ?? r.exceptionDetails.text}`);
        return r.result.value;
      },
      close: () => this.send('Target.closeTarget', { targetId }).catch(() => undefined),
    };
    return tab;
  }
}

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
async function waitFor(fn, { timeout = 60_000, every = 400, what = 'condição' } = {}) {
  const t0 = Date.now();
  let last;
  for (;;) {
    try {
      const v = await fn();
      if (v) return v;
      last = v;
    } catch (e) {
      last = e;
    }
    if (Date.now() - t0 > timeout) throw new Error(`tempo esgotado esperando ${what} (último: ${last instanceof Error ? last.message : JSON.stringify(last)})`);
    await sleep(every);
  }
}

const http = async (method, p, body) => {
  const res = await fetch(`${API}${p}`, { method, headers: body !== undefined ? { 'content-type': 'application/json' } : undefined, body: body !== undefined ? JSON.stringify(body) : undefined });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(data.error ?? `HTTP ${res.status}`);
  return data;
};

/** Lote de `scenes` cenas com a fala dada, pelas rotas reais (viral → análise → plano → confirmar). */
async function createBatch({ scenes, transcript }) {
  const conv = await http('POST', '/conversations', { mode: 'viral' });
  const form = new FormData();
  form.append('file', new File([buildMp4({ durationS: scenes * 8, salt: Date.now() % 1_000_000 })], 'e2e.mp4', { type: 'video/mp4' }));
  const up = await fetch(`${API}/conversations/${conv.id}/viral`, { method: 'POST', body: form });
  const viralId = (await up.json()).conversation.viral.id;
  await http('PATCH', `/virals/${viralId}/analysis`, { pessoas: [], rosto: true, legenda: false, tela: 'sala', acoes: '', enquadramento: 'vertical', estrutura: '', transcricao: transcript });
  const sent = await http('POST', `/conversations/${conv.id}/messages`, { text: '1 vídeo', attachments: [] });
  return (await http('POST', `/plans/${sent.plan.id}/confirm`)).batch;
}
const batchOf = async (id) => (await http('GET', '/batches')).find((b) => b.id === id);

let mock;
afterAll(async () => {
  await mock?.close();
});

describe.skipIf(!CDP || !APP)('e2e: Edge/Chromium real + extensão MV3 + app + Flow simulado', () => {
  it(
    'conecta, mostra conta e créditos reais e gera um vídeo de 2 cenas de ponta a ponta; o MP4 juntado TOCA num <video>',
    async () => {
      mock = await startMockFlow({ clip: PLACEHOLDER_MP4 });
      const cdp = await Cdp.connect(CDP);

      // abas de uma execução anterior (Flow/app/popup) atrapalhariam: duas abas do Flow na mesma conta → a 2ª fica de reserva
      for (const t of await (await fetch(`${CDP}/json/list`)).json()) {
        if (t.type === 'page' && (t.url.startsWith('https://flow.google.com/') || t.url.startsWith(APP) || t.url.includes('/popup/popup.html'))) await cdp.send('Target.closeTarget', { targetId: t.id });
      }

      // 1) a extensão carregou: o service worker (módulo) existe e responde ao popup
      const list = await (await fetch(`${CDP}/json/list`)).json();
      const sw = list.find((t) => t.type === 'service_worker' && /\/background\/service-worker\.js$/.test(t.url));
      expect(sw, 'service worker da extensão Zerum não apareceu (extensão não carregada?)').toBeTruthy();
      const extId = new URL(sw.url).host;
      const popup = await cdp.open(`chrome-extension://${extId}/popup/popup.html`);
      await waitFor(() => popup.eval('document.readyState === "complete"'), { what: 'popup carregar' });
      const msg = (m) => popup.eval(`chrome.runtime.sendMessage(${JSON.stringify(m)})`);
      const status0 = (await msg({ type: 'popup.status' })).result;
      if (status0.accounts?.length) {
        throw new Error('Este e2e exige um perfil NOVO do navegador: a extensão ainda guarda contas/ordens de uma execução anterior (o cenário de cota deixa a conta em pausa de 24 h). Reinicie o navegador com um --user-data-dir vazio.');
      }
      expect(status0).toMatchObject({ version: '0.1.0', health: { state: 'closed' }, accounts: [] });

      // 2) a extensão só aceita a página do Zerum em origem autorizada (a 3101 NÃO está na lista padrão)
      const appOrigin = new URL(APP).origin;
      await mock.hits.splice(0);
      const blocked = await cdp.open(`${APP}/zerum`);
      await waitFor(() => blocked.eval('document.documentElement.getAttribute("data-zerum-extension-origin")'), { what: 'relay marcar a página' });
      expect(await blocked.eval('document.documentElement.getAttribute("data-zerum-extension")')).toBe('0.1.0');
      expect(await blocked.eval('document.documentElement.getAttribute("data-zerum-extension-origin")')).toBe('blocked');
      await blocked.close();
      expect((await msg({ type: 'popup.origins', origins: ['http://127.0.0.1:3100', 'http://localhost:3100', appOrigin] })).result.origins).toContain(appOrigin);

      // 3) abre o Flow (simulado) num projeto: o worker identifica conta/projeto e liga a conta
      const flow = await cdp.open(`https://flow.google.com/project/${MOCK_PROJECT_ID}`);
      const account = await waitFor(async () => (await msg({ type: 'popup.status' })).result.accounts.find((a) => a.online), { what: 'conta do Flow online no broker' });
      expect(account).toMatchObject({ context: { accountId: 'ana@gmail.com', projectId: MOCK_PROJECT_ID }, credits: 1250, pending: 0, paused: false });

      // 4) o diagnóstico de seletores roda dentro da aba do Flow
      const probe = (await msg({ type: 'popup.probe' })).result;
      expect(probe.identity).toMatchObject({ ready: true, email: 'ana@gmail.com' });
      for (const name of ['accountButton', 'promptBox', 'generateButton', 'settingsButton', 'fileInput']) {
        expect(probe.elements[name].found, `seletor ${name}`).toBe(true);
      }

      // 5) a página do Zerum (agora autorizada) mostra o estado REAL da ponte
      await http('PATCH', '/settings', { simulation: false, parallel: 1, autoSwitch: false });
      const app = await cdp.open(`${APP}/zerum`);
      expect(await waitFor(() => app.eval('document.documentElement.getAttribute("data-zerum-extension-origin")'), { what: 'origem autorizada' })).toBe('allowed');
      const banner = await waitFor(() => app.eval('document.querySelector(\'[data-estado="conectado"]\')?.innerText ?? ""'), { what: 'barra "Flow conectado"', timeout: 40_000 });
      expect(banner).toMatch(/Flow conectado/);
      expect(banner).toMatch(/ana@gmail\.com · 1250 créditos/);
      expect(await app.eval('document.getElementById("ponte")?.innerText')).toMatch(/flow ligado/i); // (o CSS põe em maiúsculas)
      expect((await http('GET', '/bridge/status')).detail).toBe('Flow ligado: ana@gmail.com · 1250 créditos');

      // 6) gera: a bomba (na página) leva cada cena à extensão, que opera o "Flow" no DOM e devolve o MP4
      const batch = await createBatch({ scenes: 2, transcript: 'Primeira frase do viral. Segunda frase do viral.' });
      const done = await waitFor(async () => {
        const b = await batchOf(batch.id);
        return b.videos[0].state === 'pronto' || b.videos[0].state === 'falhou' ? b : null;
      }, { what: 'o vídeo ficar pronto', timeout: 150_000, every: 1000 });
      expect(done.videos[0], JSON.stringify(done.videos[0].error)).toMatchObject({ state: 'pronto', scenesDone: 2, simulated: false });

      // o que o "Flow" recebeu: 2 pedidos, 9:16, 1 resultado por pedido, o prompt de cada cena
      const subs = await flow.eval('window.__mock.submissions');
      expect(subs).toHaveLength(2); // uma geração por cena — nenhum clique extra
      expect(subs.every((s) => s.aspect === '9:16' && s.outputs === 1)).toBe(true);
      expect(subs[0].prompt).toMatch(/Primeira frase do viral/);
      expect(subs[1].prompt).toMatch(/Segunda frase do viral/);

      // o arquivo é o MP4 juntado das 2 cenas "do Flow" — e um navegador de verdade o TOCA
      const dl = await fetch(`${API}/videos/${done.videos[0].id}/download`);
      const bytes = new Uint8Array(await dl.arrayBuffer());
      const [v, a] = readMp4Tracks(bytes);
      const [ov, oa] = readMp4Tracks(PLACEHOLDER_MP4);
      expect(v.samples).toHaveLength(ov.samples.length * 2);
      expect(a.samples).toHaveLength(oa.samples.length * 2);
      const play = await app.eval(`(async () => {
        const v = document.createElement('video'); v.muted = true; v.playsInline = true; document.body.appendChild(v);
        v.src = ${JSON.stringify(`/zerum/api/videos/${done.videos[0].id}/download?inline=1`)};
        await new Promise((res, rej) => { v.onloadedmetadata = res; v.onerror = () => rej(new Error('erro de mídia ' + (v.error && v.error.code) + ' ' + (v.error && v.error.message))); });
        await v.play(); await new Promise((r) => setTimeout(r, 1200));
        return { duration: v.duration, width: v.videoWidth, height: v.videoHeight, t: v.currentTime, ended: v.ended };
      })()`);
      const one = parseMp4Meta(PLACEHOLDER_MP4);
      expect(play.width).toBe(one.width);
      expect(play.height).toBe(one.height);
      expect(play.duration).toBeGreaterThan(one.durationS * 2 - 0.3);
      expect(play.duration).toBeLessThan(one.durationS * 2 + 0.3);
      expect(play.t).toBeGreaterThan(0.2); // está tocando

      await http('DELETE', `/batches/${batch.id}`);

      // 7) cota no Flow (a aba do Zerum segue aberta: é ela que executa): o toast aparece no DOM, a conta pausa 24 h e o vídeo falha com a explicação
      const q = await createBatch({ scenes: 1, transcript: 'QUOTA-TEST frase única.' });
      const failed = await waitFor(async () => {
        const b = await batchOf(q.id);
        return b.videos[0].state === 'falhou' ? b : null;
      }, { what: 'a falha por cota', timeout: 90_000, every: 1000 });
      expect(failed.videos[0].error).toMatch(/atingiu a cota e fica em pausa até amanhã \d{2}:\d{2}/); // pausa de 24 h = amanhã (nunca só "HH:mm")
      const acct = (await msg({ type: 'popup.status' })).result.accounts[0];
      expect(acct.cooldownUntil - Date.now()).toBeGreaterThan(23 * 3600_000);
      expect(acct.cooldownUntil - Date.now()).toBeLessThan(24 * 3600_000 + 60_000);
      await waitFor(async () => (await http('GET', '/bridge/status')).detail.startsWith('COTA_PAUSADA;'), { what: 'status COTA_PAUSADA', timeout: 30_000 });

      await http('DELETE', `/batches/${q.id}`);
      await http('PATCH', '/settings', { simulation: true, parallel: 4 });
      await app.close();
      await flow.close();
      await popup.close();
    },
    420_000,
  );
});
