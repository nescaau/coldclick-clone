/**
 * Núcleo do service worker: roteia as mensagens (site, aba do Flow, popup) para o broker. Sem efeitos globais: recebe
 * `kv`, `chrome` (só `tabs`) e `fetchImpl` — por isso roda igual no Chrome e no Node dos testes.
 *
 * Remetentes aceitos (nada mais passa):
 *   site   → `rpc` com uma das 10 ações da ponte (só da página do Zerum local, em origem permitida)
 *   Flow   → `rpc heartbeat`, `worker.*` (só de https://flow.google.com, quadro principal)
 *   popup  → `popup.*` (só da página do popup)
 */
import { BRIDGE_ACTIONS, MAX_CLIP_BYTES, PRESENCE_TTL_MS, PROTOCOL, SETTINGS_KEY, STATUS_KEY, isTerminal } from '../lib/protocol.js';
import { ZerumError } from '../lib/util.js';
import { Broker, BrokerError } from './broker.js';
import { createMediaStore, PART_BYTES } from './media-store.js';
import { DEFAULT_ORIGINS, FLOW_ORIGIN, isAllowedMediaUrl, isFlowSender, isPopupSender, isSiteSender, looksLikeMp4, normalizeOrigin } from './policy.js';

const PRESENCE_KEY = 'zr:v1:presence';
const LAST_PRUNE_KEY = 'zr:v1:lastPrune';
const WORKERS_KEY = 'zr:v1:workers';
const FRESH_MS = 20_000;

const REASONS = {
  SEM_CONTA_LOGADA: 'Entre na sua conta Google no Flow.',
  ABRA_UM_PROJETO_NO_FLOW: 'Abra (ou crie) um projeto no Flow: o Zerum gera dentro dele.',
};

/** Resposta de erro padronizada (o relay a transforma em `zre:'response'` com `error`). */
function failure(e) {
  if (e instanceof ZerumError) {
    return { error: e.code, code: e.code, status: e.status ?? 400, ...(e.retryable ? { retryable: true } : {}), ...(Number.isFinite(e.retryAt) ? { retryAt: e.retryAt } : {}) };
  }
  console.error('[zerum-ext]', e);
  return { error: 'ERRO_INTERNO', code: 'ERRO_INTERNO', status: 500 };
}

export function createServiceWorker({ kv, chrome = null, now = Date.now, fetchImpl = globalThis.fetch?.bind(globalThis), version = '0.0.0', popupUrl = '', uid } = {}) {
  const media = createMediaStore(kv);
  const broker = new Broker({ kv, media, now, uid });
  let tail = Promise.resolve();
  const serial = (fn) => (tail = tail.then(fn, fn));

  // ─── configuração e presença ───────────────────────────────────────────────────────────────────────────────────
  const settings = async () => {
    const s = (await kv.get([SETTINGS_KEY]))[SETTINGS_KEY] ?? {};
    return { origins: Array.isArray(s.origins) && s.origins.length ? s.origins : DEFAULT_ORIGINS, assumeSingleOutput: !!s.assumeSingleOutput };
  };
  const saveSettings = async (patch) => {
    const next = { ...(await settings()), ...patch };
    await kv.set({ [SETTINGS_KEY]: next });
    return next;
  };

  const readPresence = async () => (await kv.get([PRESENCE_KEY]))[PRESENCE_KEY] ?? {};
  const touchPresence = (email, patch) =>
    serial(async () => {
      const all = await readPresence();
      all[email] = { ...all[email], ...patch, seenAt: now() };
      await kv.set({ [PRESENCE_KEY]: all });
      await publishHealth(all);
    });

  function healthOf(all) {
    const t = now();
    const live = Object.entries(all).filter(([, p]) => t - p.seenAt < FRESH_MS);
    const ready = live.find(([, p]) => p.ready);
    if (ready) return { state: 'healthy', detail: 'Flow ligado', context: ready[1].context, lastResponseAt: ready[1].seenAt };
    if (live.length) {
      const p = live[0][1];
      return { state: 'not-ready', detail: REASONS[p.reason] ?? 'O Flow está aberto, mas ainda não está pronto.', context: p.context ?? null, lastResponseAt: p.seenAt };
    }
    return { state: 'closed', detail: 'Nenhuma aba do Flow aberta: abra o Flow pelo ícone da extensão.', context: null, lastResponseAt: Math.max(0, ...Object.values(all).map((p) => p.seenAt || 0)) };
  }

  let lastPublished = '';
  async function publishHealth(all) {
    const h = healthOf(all);
    const key = `${h.state}|${h.detail}|${h.context?.accountId ?? ''}|${h.context?.projectId ?? ''}`;
    if (key === lastPublished) return;
    lastPublished = key;
    await kv.set({ [STATUS_KEY]: { health: { ...h, at: now() } } });
  }

  async function status(origin) {
    const all = await readPresence();
    const accounts = await broker.list();
    const t = now();
    const s = await settings();
    return {
      installed: true,
      paired: true, // sem servidor e sem login: a "ligação" é local e já existe
      version,
      protocol: PROTOCOL,
      health: { ...healthOf(all), at: t },
      accounts,
      tabs: Object.entries(all).map(([accountId, p]) => ({ accountId, projectId: p.context?.projectId ?? '', ready: !!p.ready, reason: p.reason ?? '', online: t - p.seenAt < PRESENCE_TTL_MS, ageMs: Math.max(0, t - p.seenAt) })),
      origin,
      origins: s.origins,
    };
  }

  // ─── ações do site ─────────────────────────────────────────────────────────────────────────────────────────────
  async function download({ id, part = 0 }) {
    const o = await broker.get({ id });
    if (o.state !== 'completed' || !o.result) throw new BrokerError('ORDEM_NAO_CONCLUIDA', 409);
    const meta = await media.meta(id);
    if (!meta?.done) throw new BrokerError('MIDIA_NAO_ENCONTRADA', 404);
    if (!Number.isInteger(part) || part < 0 || part >= meta.parts) throw new BrokerError('PARTE_INVALIDA', 400);
    const base64 = await media.readPart(id, part);
    if (base64 == null) throw new BrokerError('MIDIA_INCOMPLETA', 500);
    if (part === meta.parts - 1) await broker.markDownloaded({ id }); // o site leu o clipe até o fim: o "Limpar" já pode apagá-lo
    return { id, mimeType: meta.mimeType, size: meta.size, sha256: meta.sha256, parts: meta.parts, partBytes: PART_BYTES, part, base64, done: part === meta.parts - 1 };
  }

  const SITE_ACTIONS = {
    extensionStatus: (_p, ctx) => status(ctx.origin),
    accounts: () => broker.list(),
    enqueue: (p) => broker.enqueue(p),
    get: (p) => broker.get(p),
    reconcile: (p) => broker.reconcile(p),
    download: (p) => download(p),
    job: async (p) => ({ ...(await broker.job(p)), context: p.context }),
    beginAttempt: async (p) => ({ ...(await broker.job(p, true)), context: p.context }),
    mediaState: (p) => broker.mediaState(p),
    recoverJob: (p) => broker.recoverJob(p),
  };

  // ─── aba do Flow ───────────────────────────────────────────────────────────────────────────────────────────────
  async function heartbeat(payload, sender) {
    const r = await broker.heartbeat({ ...payload, tabId: sender.tab?.id });
    await touchPresence(payload.context.accountId.toLowerCase(), { context: { ...payload.context, accountId: payload.context.accountId.toLowerCase() }, ready: true, reason: '', tabId: sender.tab?.id });
    return r;
  }

  async function observe(info, sender) {
    const c = info?.context;
    const email = String(c?.accountId || '').toLowerCase() || `anonimo:${sender.tab?.id ?? 0}`;
    await touchPresence(email, { context: { accountId: String(c?.accountId || ''), projectId: String(c?.projectId || ''), accountPath: String(c?.accountPath || '') }, ready: !!info?.ready, reason: String(info?.reason || ''), tabId: sender.tab?.id });
    return { ok: true };
  }

  /**
   * A aba do Flow diz qual `workerId` (guardado no sessionStorage) pretende usar. "Duplicar aba" COPIA o sessionStorage: as duas
   * abas teriam o mesmo id, furando CONTA_JA_TEM_ABA_EXECUTORA e sobrescrevendo o journal `zr:journal:<id>`. O service worker
   * registra id → aba (sender.tab.id): se o id já pertence a OUTRA aba que ainda está aberta, devolve um id novo para esta.
   * Recarregar a mesma aba mantém o id (mesmo tabId) — a releitura do que estava em voo continua funcionando.
   */
  async function workerRegister(m, sender) {
    const worker = typeof m.worker === 'string' ? m.worker.slice(0, 80) : '';
    if (!worker) throw new BrokerError('WORKER_OBRIGATORIO', 400);
    const tabId = sender.tab?.id;
    if (!Number.isInteger(tabId)) return { worker };
    return serial(async () => {
      const map = (await kv.get([WORKERS_KEY]))[WORKERS_KEY] ?? {};
      let open = null;
      try {
        open = new Set((await flowTabs()).map((t) => t.id));
      } catch {
        /* sem lista de abas: trata como todas abertas (o mais seguro é reatribuir) */
      }
      // Abas fechadas liberam o id (reabrir uma aba fechada não deve ser tratado como duplicata).
      if (open) for (const [w, t] of Object.entries(map)) if (t !== tabId && !open.has(t)) delete map[w];
      let assigned = worker;
      if (map[worker] !== undefined && map[worker] !== tabId) assigned = `${worker.slice(0, 36)}-${(uid ?? (() => crypto.randomUUID()))()}`.slice(0, 80);
      map[assigned] = tabId;
      await kv.set({ [WORKERS_KEY]: map });
      return { worker: assigned, reassigned: assigned !== worker };
    });
  }

  async function mediaFetch(m) {
    if (!(await broker.checkLease({ id: m.orderId, lease: m.lease, worker: m.worker }))) throw new BrokerError('LEASE_INVALIDA', 409);
    if (!isAllowedMediaUrl(m.url)) throw new BrokerError('MIDIA_HOST_NAO_PERMITIDO', 403);
    if (!fetchImpl) throw new BrokerError('FETCH_INDISPONIVEL', 500);
    let res;
    try {
      res = await fetchImpl(m.url, { credentials: 'include', cache: 'no-store' });
    } catch {
      throw new BrokerError('DOWNLOAD_FALHOU', 502);
    }
    if (!res.ok) throw new BrokerError(`DOWNLOAD_HTTP_${res.status}`, 502);
    const declared = Number(res.headers.get('content-length') || 0);
    if (declared > MAX_CLIP_BYTES) throw new BrokerError('MIDIA_GRANDE_DEMAIS', 413);
    const bytes = new Uint8Array(await res.arrayBuffer());
    if (bytes.length > MAX_CLIP_BYTES) throw new BrokerError('MIDIA_GRANDE_DEMAIS', 413);
    if (!looksLikeMp4(bytes)) throw new BrokerError('CONTEUDO_MIDIA_INVALIDO', 502);
    const meta = await media.putBytes(m.orderId, bytes, 'video/mp4');
    return { ok: true, bytes: meta.size, sha256: meta.sha256 };
  }

  async function mediaBegin(m) {
    if (!(await broker.checkLease({ id: m.orderId, lease: m.lease, worker: m.worker }))) throw new BrokerError('LEASE_INVALIDA', 409);
    await media.begin(m.orderId, 'video/mp4');
    return { ok: true };
  }
  async function mediaChunk(m) {
    if (!(await broker.checkLease({ id: m.orderId, lease: m.lease, worker: m.worker }))) throw new BrokerError('LEASE_INVALIDA', 409);
    if (typeof m.b64 !== 'string' || m.b64.length > Math.ceil(((PART_BYTES * 4) / 3) * 1.01) + 8) throw new BrokerError('PARTE_INVALIDA', 400);
    const size = await media.appendBase64(m.orderId, m.b64);
    if (size > MAX_CLIP_BYTES) throw new BrokerError('MIDIA_GRANDE_DEMAIS', 413);
    return { ok: true, size };
  }
  async function mediaEnd(m) {
    if (!(await broker.checkLease({ id: m.orderId, lease: m.lease, worker: m.worker }))) throw new BrokerError('LEASE_INVALIDA', 409);
    let done;
    try {
      done = await media.finish(m.orderId, { expectedBytes: m.expectedBytes });
    } catch (e) {
      throw new BrokerError(String(e.message || 'MIDIA_INCOMPLETA'), 409);
    }
    return { ok: true, bytes: done.size, sha256: done.sha256 };
  }

  // ─── popup ─────────────────────────────────────────────────────────────────────────────────────────────────────
  async function flowTabs() {
    return chrome?.tabs ? await chrome.tabs.query({ url: `${FLOW_ORIGIN}/*` }) : [];
  }

  const POPUP = {
    'popup.status': async () => ({ ...(await status('popup')), journal: await broker.snapshot(), assumeSingleOutput: (await settings()).assumeSingleOutput }),
    'popup.pause': async (m) => broker.setPaused(m.email, !!m.paused),
    'popup.origins': async (m) => {
      const list = [...new Set((Array.isArray(m.origins) ? m.origins : []).map(normalizeOrigin).filter(Boolean))];
      if (!list.length) throw new BrokerError('ORIGEM_INVALIDA', 400);
      return { origins: (await saveSettings({ origins: list })).origins };
    },
    'popup.settings': async (m) => ({ assumeSingleOutput: (await saveSettings({ assumeSingleOutput: !!m.assumeSingleOutput })).assumeSingleOutput }),
    // "Limpar": apaga o que já acabou, MAS nunca um clipe concluído que o site ainda não leu (senão: ORDEM_NAO_ENCONTRADA → cobrança dupla).
    'popup.prune': async () => broker.prune({ olderThanMs: 0, deliveredOnly: true }),
    'popup.open-flow': async () => {
      const tabs = await flowTabs();
      if (tabs[0]) {
        await chrome.tabs.update(tabs[0].id, { active: true });
        return { ok: true, reused: true };
      }
      await chrome.tabs.create({ url: `${FLOW_ORIGIN}/`, active: true });
      return { ok: true };
    },
    'popup.probe': async () => {
      const tabs = await flowTabs();
      if (!tabs[0]) throw new BrokerError('NENHUMA_ABA_DO_FLOW', 409);
      const r = await chrome.tabs.sendMessage(tabs[0].id, { type: 'flow.probe' });
      if (!r || r.error) throw new BrokerError(r?.error || 'ABA_SEM_RESPOSTA', 502);
      return r;
    },
  };

  // ─── entrada ───────────────────────────────────────────────────────────────────────────────────────────────────
  async function handleMessage(m, sender = {}) {
    try {
      if (!m || typeof m !== 'object') throw new BrokerError('MENSAGEM_INVALIDA', 400);
      if (m.type === 'rpc') {
        const isBeat = m.action === 'heartbeat';
        if (isBeat) {
          if (!isFlowSender(sender)) throw new BrokerError('ORIGEM_NAO_PERMITIDA', 403);
          return { result: await heartbeat(m.payload ?? {}, sender) };
        }
        if (!BRIDGE_ACTIONS.includes(m.action)) throw new BrokerError('ACAO_NAO_PERMITIDA', 403);
        const s = await settings();
        if (!isSiteSender(sender, s.origins)) throw new BrokerError('ORIGEM_NAO_PERMITIDA', 403);
        return { result: await SITE_ACTIONS[m.action](m.payload ?? {}, { origin: new URL(sender.url).origin }) };
      }
      if (m.type === 'site.hello') {
        const s = await settings();
        if (!isSiteSender(sender, s.origins)) return { result: { allowed: false, version, protocol: PROTOCOL } };
        return { result: { allowed: true, version, protocol: PROTOCOL, health: healthOf(await readPresence()) } };
      }
      if (typeof m.type === 'string' && m.type.startsWith('worker.')) {
        if (!isFlowSender(sender)) throw new BrokerError('ORIGEM_NAO_PERMITIDA', 403);
        const fn = { 'worker.register': (x) => workerRegister(x, sender), 'worker.observe': (x) => observe(x.info, sender), 'worker.media.fetch': mediaFetch, 'worker.media.begin': mediaBegin, 'worker.media.chunk': mediaChunk, 'worker.media.end': mediaEnd }[m.type];
        if (!fn) throw new BrokerError('ACAO_NAO_PERMITIDA', 403);
        return { result: await fn(m) };
      }
      if (typeof m.type === 'string' && m.type.startsWith('popup.')) {
        if (!isPopupSender(sender, popupUrl)) throw new BrokerError('ORIGEM_NAO_PERMITIDA', 403);
        const fn = POPUP[m.type];
        if (!fn) throw new BrokerError('ACAO_NAO_PERMITIDA', 403);
        return { result: await fn(m) };
      }
      throw new BrokerError('MENSAGEM_DESCONHECIDA', 400);
    } catch (e) {
      return failure(e);
    }
  }

  /** Alarme periódico: aplica prazos, recalcula a saúde, acorda as abas do Flow e poda o journal (1×/dia). */
  async function onAlarm() {
    await broker.list(); // aplica prazos (unknown, fila velha…) e grava
    await serial(async () => publishHealth(await readPresence()));
    for (const t of await flowTabs().catch(() => [])) await chrome.tabs.sendMessage(t.id, { type: 'flow.pulse' }).catch(() => {});
    const last = (await kv.get([LAST_PRUNE_KEY]))[LAST_PRUNE_KEY] ?? 0;
    if (now() - last > 24 * 60 * 60_000) {
      await broker.prune();
      await kv.set({ [LAST_PRUNE_KEY]: now() });
    }
  }

  return { broker, media, handleMessage, onAlarm, settings, status, isTerminal };
}
