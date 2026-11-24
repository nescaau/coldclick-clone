/**
 * "Mundo" de teste: o service worker REAL (sw-core) com um Chrome falso, uma janela falsa (para o relay/ponte) e a página
 * falsa do Flow. Dá para ligar a cadeia inteira — site ⇄ relay ⇄ service worker ⇄ broker ⇄ worker ⇄ driver — no Node,
 * com relógio virtual (nada espera de verdade).
 */
import { createServiceWorker } from '../background/sw-core.js';
import { createFlowDriver } from '../drivers/flow-driver.js';
import { createMockPage, MOCK_MP4, MOCK_PROJECT } from './mock-page.mjs';
import { createFlowWorker } from '../content/flow-worker.js';
import { memoryKv } from '../lib/kv.js';
import { T0 } from './helpers.mjs';

export const SITE_URL = 'http://127.0.0.1:3100/zerum';
export const POPUP_URL = 'chrome-extension://zerum-ext/popup/popup.html';
export const FLOW_URL = `https://flow.google.com/project/${MOCK_PROJECT}`;
export const sender = {
  site: (url = SITE_URL, extra = {}) => ({ url, frameId: 0, ...extra }),
  flow: (tabId = 7) => ({ url: FLOW_URL, frameId: 0, tab: { id: tabId } }),
  popup: () => ({ url: POPUP_URL, frameId: 0 }),
};

/** Janela falsa: `postMessage` entrega aos ouvintes de `message` (mesma origem), como o navegador. */
export function createFakeWindow({ origin = 'http://127.0.0.1:3100', pathname = '/zerum' } = {}) {
  const listeners = [];
  const attrs = new Map();
  const win = {
    location: { origin, pathname },
    document: { documentElement: { setAttribute: (k, v) => attrs.set(k, v), getAttribute: (k) => attrs.get(k) ?? null } },
    posted: [],
    addEventListener: (type, fn) => type === 'message' && listeners.push(fn),
    removeEventListener: (type, fn) => {
      const i = listeners.indexOf(fn);
      if (i >= 0) listeners.splice(i, 1);
    },
    postMessage(data, targetOrigin) {
      win.posted.push({ data, targetOrigin });
      queueMicrotask(() => win.dispatch({ source: win, origin: win.location.origin, data }));
    },
    /** Entrega um evento arbitrário (para simular remetente/origem errados). */
    dispatch: (e) => listeners.slice().forEach((fn) => fn(e)),
    attrs,
  };
  return win;
}

/** Chrome falso para um contexto (relay, popup, aba do Flow): `sendMessage` chega ao service worker com o `sender` dele. */
export function createFakeChrome({ kv, sw, sender: from, version = '0.1.0' }) {
  const changeListeners = [];
  const local = {
    get: async (keys) => kv.get(Array.isArray(keys) ? keys : [keys]),
    set: async (obj) => {
      const old = await kv.get(Object.keys(obj));
      await kv.set(obj);
      for (const fn of changeListeners) fn(Object.fromEntries(Object.entries(obj).map(([k, v]) => [k, { oldValue: old[k], newValue: v }])), 'local');
    },
  };
  return {
    runtime: { id: 'zerum-ext', getManifest: () => ({ version }), getURL: (p) => `chrome-extension://zerum-ext/${p}`, sendMessage: async (m) => sw.handleMessage(JSON.parse(JSON.stringify(m)), from) },
    storage: { local, onChanged: { addListener: (fn) => changeListeners.push(fn) } },
  };
}

/**
 * @param opts.clip  () => Uint8Array — o MP4 que o "CDN do Flow" devolve a cada download (padrão: um MP4 mínimo fixo).
 *                   Nos testes de ponta a ponta devolve clipes de verdade (com faixas), para a junção das cenas funcionar.
 */
export function createWorld({ start = T0, fetchOk = true, clip = () => MOCK_MP4 } = {}) {
  const kv = memoryKv();
  const clock = { t: start };
  const fetches = [];
  const fetchImpl = async (url) => {
    fetches.push(url);
    if (!fetchOk) return { ok: false, status: 403, headers: { get: () => null }, arrayBuffer: async () => new ArrayBuffer(0) };
    const bytes = clip();
    return { ok: true, status: 200, headers: { get: () => String(bytes.length) }, arrayBuffer: async () => bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.length) };
  };
  let n = 0;
  const tabsApi = { tabs: [], query: async () => tabsApi.tabs, sendMessage: async () => ({ ok: true }), update: async () => ({}), create: async (o) => (tabsApi.created = o) };
  const sw = createServiceWorker({ kv, chrome: { tabs: tabsApi }, now: () => clock.t, fetchImpl, version: '0.1.0', popupUrl: POPUP_URL, uid: () => `id-${++n}` });
  /** Pede uma ação da ponte como se fosse o site. */
  const rpc = async (action, payload = {}, from = sender.site()) => sw.handleMessage({ type: 'rpc', action, payload }, from);
  const sleep = async (ms) => {
    clock.t += ms;
  };

  /** Uma aba do Flow: worker + driver sobre a página falsa, com relógio virtual. */
  function flowTab({ workerId = 'w1', tabId = 7, page = createMockPage(), capacity = 2, driverConfig, blockSleep = false } = {}) {
    // `blockSleep`: o 1º "esperar" da aba trava de verdade (simula a aba parada no meio de uma geração, até ser abandonada).
    let open;
    const gate = blockSleep ? new Promise((r) => (open = r)) : null;
    const tabSleep = gate ? (ms) => gate.then(() => sleep(ms)) : sleep;
    const driver = createFlowDriver({ page, sleep: tabSleep, now: () => clock.t, config: driverConfig });
    const from = sender.flow(tabId);
    const send = (m) => sw.handleMessage(JSON.parse(JSON.stringify(m)), from);
    const worker = createFlowWorker({ driver, send, storage: kv, workerId, readBlob: (u) => page.mediaBytes(u), now: () => clock.t, sleep: tabSleep, capacity });
    return { page, worker, driver, send, from, release: () => open?.() };
  }

  return { kv, clock, sw, rpc, fetches, sleep, flowTab, tabsApi, advance: (ms) => (clock.t += ms) };
}

export const FLOW_CTX = (accountId = 'ana@gmail.com', projectId = MOCK_PROJECT, accountPath = '') => ({ accountId, projectId, accountPath });
export const videoOrder = (o = {}) => ({ jobId: 'cena:v1:0', context: FLOW_CTX(), cmd: 'generate.video', args: [{ prompt: 'A woman says hello to the camera', aspectRatio: '9:16', durationSeconds: 8 }], key: 'k1', attempt: 0, ...o });
