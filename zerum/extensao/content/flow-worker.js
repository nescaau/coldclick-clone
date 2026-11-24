/**
 * Worker da aba do Flow (content script, mundo isolado): é quem de fato "opera" o flow.google.com.
 *
 * Ciclo (a cada ~3 s): descobre quem está logado/projeto → bate o coração no broker (service worker) entregando o
 * outbox de eventos → recebe ordens → executa pelo driver → devolve eventos (accepted → completed | failed | unknown).
 *
 * Garantias herdadas do original:
 *  - o journal desta aba (`zr:journal:<worker>`) é gravado ANTES de qualquer ação: recarregar a aba não reenvia nada —
 *    o que estava em voo vira `unknown` (ABA_RECARREGADA_SEM_REENVIO) com a identidade do cartão, e a releitura é só leitura;
 *  - confirmação perdida repete a ENTREGA do evento (outbox), nunca a geração;
 *  - um cartão da grade pertence a UMA ordem (não se confundem quando há várias em voo);
 *  - o "gerar" é um clique só: envio serializado por um lock, e nunca refeito.
 */
import { EXECUTABLE_COMMANDS } from '../lib/protocol.js';
import { DriverError } from '../drivers/flow-driver.js';
import { createMutex, sleep as realSleep, toBase64 } from '../lib/util.js';

export const HEARTBEAT_MS = 3_000;
const CREDITS_EVERY_MS = 60_000;
const OBSERVE_EVERY_MS = 10_000;
const STANDBY_MS = 10_000;
const MAX_EVENTS_PER_BEAT = 50;
const CHUNK_BYTES = 768 * 1024;

/**
 * @param deps.driver   createFlowDriver(...)
 * @param deps.send     (mensagem) => Promise<{result}|{error,code}>  — chrome.runtime.sendMessage
 * @param deps.storage  {get(keys[]) → obj, set(obj)}                  — chrome.storage.local (ou kv de teste)
 * @param deps.readBlob (url) => Promise<{bytes,mimeType}|null>        — lê blob:/mesma origem dentro da aba
 */
export function createFlowWorker({ driver, send, storage, workerId, readBlob = async () => null, locks = null, now = Date.now, sleep = realSleep, capacity = 2 }) {
  const KEY = `zr:journal:${workerId}`;
  let journal = { worker: workerId, events: [], active: {} };
  let writing = Promise.resolve();
  const running = new Set();
  const submitLock = createMutex();
  let ticking = null;
  let stopped = false;
  let standby = false;
  let lastCreditsAt = 0;
  let credits = null;
  let lastObserveAt = 0;
  let lastIdentity = null;
  let releaseAwake = null;

  const persist = () => {
    const snapshot = JSON.parse(JSON.stringify(journal));
    writing = writing.then(() => storage.set({ [KEY]: snapshot }));
    return writing;
  };

  /** A aba segura um Web Lock enquanto há ordem em voo: o Chrome não congela aba com lock (sem isso, em segundo plano, ela dorme). */
  function holdAwake() {
    if (releaseAwake || !locks?.request) return;
    let done;
    const held = new Promise((r) => (done = r));
    releaseAwake = done;
    locks.request(`zerum-aba-acordada:${workerId}`, () => held).catch(() => {
      if (releaseAwake === done) releaseAwake = null;
    });
  }
  function letSleep() {
    if (Object.keys(journal.active).length || !releaseAwake) return;
    const r = releaseAwake;
    releaseAwake = null;
    r();
  }

  /** Enfileira um evento no outbox. Progresso (`accepted`) é coalescido: só o mais recente de cada ordem importa. */
  function emit(order, data) {
    const item = { id: order.id, lease: order.lease, eventId: crypto.randomUUID(), ...data };
    if (data.state === 'accepted') journal.events = journal.events.filter((e) => !(e.id === order.id && e.lease === order.lease && e.state === 'accepted'));
    journal.events.push(item);
    return persist();
  }

  const claimedTiles = () => Object.values(journal.active).map((o) => o.resume?.tileId).filter(Boolean);

  async function deliverMedia(order, media) {
    // 1) o service worker baixa (https em host do Flow; sem CORS, com os cookies do navegador)
    if (/^https:/i.test(media.url)) {
      const r = await send({ type: 'worker.media.fetch', orderId: order.id, lease: order.lease, worker: workerId, url: media.url });
      if (r?.result?.ok) return { bytes: r.result.bytes };
    }
    // 2) a própria aba lê (blob:, ou quando o service worker não conseguiu): bytes em partes
    const got = await readBlob(media.url);
    if (!got?.bytes?.length) throw new DriverError('MIDIA_ILEGIVEL', 'unknown');
    const base = { orderId: order.id, lease: order.lease, worker: workerId };
    const ok = (r) => {
      if (!r?.result?.ok) throw new DriverError(r?.code || 'MIDIA_NAO_ENTREGUE', 'unknown');
    };
    ok(await send({ ...base, type: 'worker.media.begin' }));
    for (let at = 0; at < got.bytes.length; at += CHUNK_BYTES) ok(await send({ ...base, type: 'worker.media.chunk', b64: toBase64(got.bytes.subarray(at, at + CHUNK_BYTES)) }));
    const end = await send({ ...base, type: 'worker.media.end', expectedBytes: got.bytes.length });
    ok(end);
    return { bytes: end.result.bytes };
  }

  /** Executa UMA ordem. Devolve o evento final (completed/failed/unknown). */
  async function execute(order, rec) {
    if (!EXECUTABLE_COMMANDS.includes(order.cmd)) throw new DriverError(`COMANDO_NAO_SUPORTADO_${order.cmd}`, 'failed');
    const id = await driver.identify();
    const c = order.context;
    const same = id.ready && id.email.toLowerCase() === c.accountId.toLowerCase() && id.projectId.toLowerCase() === c.projectId.toLowerCase();
    if (!same) throw new DriverError('CONTA_OU_PROJETO_MUDOU', order.mode === 'resume' || order.resume?.tileId ? 'unknown' : 'failed');

    let resume = { ...(order.resume ?? {}) };
    if (order.mode !== 'resume' && !resume.tileId) {
      const a = order.args?.[0] ?? {};
      await submitLock(async () => {
        await emit(order, { state: 'accepted', resume: { phase: 'enviando' } });
        const sub = await driver.submitVideo({ prompt: a.prompt, aspectRatio: a.aspectRatio, model: a.model, firstFrame: a.firstFrame }, { exclude: claimedTiles() });
        resume = { tileId: sub.tileId, weak: sub.weak || undefined, phase: 'gerando', submittedAt: sub.submittedAt };
        rec.resume = resume;
        await persist(); // a identidade do cartão entra no journal ANTES de esperar qualquer coisa
        await emit(order, { state: 'accepted', resume });
      });
    }
    rec.resume = resume;
    const seen = await driver.watch(resume, {
      onProgress: (p) => emit(order, { state: 'accepted', resume: { ...resume, phase: p.phase, progress: p.progress, executorAlive: true } }),
    });
    await emit(order, { state: 'accepted', resume: { ...resume, phase: 'baixando', executorAlive: true } });
    const delivered = await deliverMedia(order, seen.media);
    return { state: 'completed', result: { bytes: delivered.bytes, mediaRef: resume.tileId }, resume };
  }

  function failureEvent(e, rec) {
    if (e instanceof DriverError) {
      const text = e.errorText ? ` · ${e.errorText}` : e.detalhe ? ` · ${e.detalhe}` : '';
      return { state: e.state === 'failed' ? 'failed' : 'unknown', error: `${e.code}${text}`.slice(0, 280), resume: rec.resume, executionFinished: true };
    }
    return { state: 'unknown', error: `ERRO_NA_ABA · ${String(e?.message || e).slice(0, 160)}`, resume: rec.resume, executionFinished: true };
  }

  async function run(order) {
    if (journal.active[order.id]) return;
    const rec = { id: order.id, lease: order.lease, cmd: order.cmd, mode: order.mode, resume: order.resume ?? undefined };
    journal.active[order.id] = rec;
    holdAwake();
    await persist(); // journal ANTES de agir: recarregar a aba daqui em diante NUNCA reexecuta
    try {
      const ev = await execute(order, rec);
      await emit(order, ev);
    } catch (e) {
      await emit(order, failureEvent(e, rec));
    } finally {
      delete journal.active[order.id];
      await persist();
      letSleep();
    }
  }

  async function observe(id) {
    if (now() - lastObserveAt < OBSERVE_EVERY_MS) return;
    lastObserveAt = now();
    await send({ type: 'worker.observe', info: { context: { accountId: id.email || '', projectId: id.projectId || '', accountPath: id.accountPath || '' }, ready: false, reason: id.reason, worker: workerId } }).catch(() => {});
  }

  async function tickOnce() {
    const id = await driver.identify();
    lastIdentity = id;
    if (!id.ready) {
      await observe(id);
      return { ready: false, reason: id.reason };
    }
    if (now() - lastCreditsAt >= CREDITS_EVERY_MS) {
      lastCreditsAt = now();
      const c = await driver.credits();
      if (c !== null) credits = c;
    }
    const context = { accountId: id.email.toLowerCase(), projectId: id.projectId, accountPath: id.accountPath || '' };
    const r = await send({ type: 'rpc', action: 'heartbeat', payload: { context, worker: workerId, events: journal.events.slice(0, MAX_EVENTS_PER_BEAT), capacity, ...(credits !== null ? { credits } : {}) } });
    if (!r || r.error) {
      standby = r?.code === 'CONTA_JA_TEM_ABA_EXECUTORA'; // outra aba já opera esta conta: esta fica de reserva
      return { ready: true, error: r?.code ?? 'SEM_RESPOSTA' };
    }
    standby = false;
    const ack = new Set(r.result.ack ?? []);
    if (ack.size) {
      journal.events = journal.events.filter((e) => !ack.has(e.eventId));
      await persist();
    }
    const orders = r.result.orders ?? (r.result.order ? [r.result.order] : []);
    for (const order of orders) {
      const p = run(order).finally(() => running.delete(p));
      running.add(p);
    }
    return { ready: true, dispatched: orders.length };
  }

  const worker = {
    journal: () => journal,
    /** Uma batida (concorrentes se juntam na mesma). */
    tick() {
      if (!ticking) ticking = tickOnce().finally(() => (ticking = null));
      return ticking;
    },
    /** Espera as ordens em voo terminarem (testes). */
    async idle() {
      while (running.size) await Promise.all([...running]);
    },
    /** Lê o journal e declara incerto o que estava em voo quando a aba foi recarregada — sem reexecutar nada. */
    async init() {
      const saved = (await storage.get([KEY]))[KEY];
      if (saved && saved.worker === workerId) journal = { worker: workerId, events: saved.events ?? [], active: {} };
      for (const rec of Object.values(saved?.active ?? {})) {
        journal.events.push({ id: rec.id, lease: rec.lease, eventId: crypto.randomUUID(), state: 'unknown', error: 'ABA_RECARREGADA_SEM_REENVIO', resume: rec.resume, executionFinished: true });
      }
      await persist();
    },
    async start() {
      await worker.init();
      const loop = async () => {
        while (!stopped) {
          await worker.tick().catch(() => {});
          await sleep(standby ? STANDBY_MS : HEARTBEAT_MS);
        }
      };
      void loop();
    },
    stop() {
      stopped = true;
      if (releaseAwake) releaseAwake();
    },
    /** Mensagens vindas do service worker/popup. */
    async onMessage(m) {
      if (m?.type === 'flow.pulse') {
        void worker.tick().catch(() => {});
        return { ok: true };
      }
      if (m?.type === 'flow.query-info') {
        const id = lastIdentity ?? (await driver.identify());
        return { responsive: true, ready: !!id.ready, context: id.email ? { accountId: id.email.toLowerCase(), projectId: id.projectId, accountPath: id.accountPath || '' } : null, active: Object.keys(journal.active).length, standby, credits };
      }
      if (m?.type === 'flow.probe') return await driver.probe();
      return { error: 'MENSAGEM_DESCONHECIDA' };
    },
    state: () => ({ standby, credits, active: Object.keys(journal.active).length, events: journal.events.length }),
  };
  return worker;
}
