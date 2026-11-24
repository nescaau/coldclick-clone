/**
 * Broker de ordens do Flow, DENTRO da extensão (no original ele roda num servidor da 001; aqui é local).
 *
 * É o dono das regras que nunca podem ser quebradas:
 *   queued → dispatched → accepted → completed | failed | unknown
 *  - `unknown` (queda de aba, executor mudo, entrega incerta) PRESERVA o bloqueio da conta e NUNCA reenfileira a geração:
 *    só se reconcilia (releitura da mesma operação) ou se expira como falha explícita.
 *  - chave estável por job + contexto + comando + argumentos: reenviar o mesmo pedido (resposta perdida) devolve a MESMA ordem.
 *  - tudo é gravado no journal (chrome.storage.local) ANTES de responder; reiniciar o service worker não perde nada.
 *  - cota: 429/QUOTA/COTA pausam a conta por 24 h; INCOMUM/UNUSUAL/RESOURCE_EXHAUSTED por 5 min. Nunca há troca
 *    automática de conta/modelo AQUI — trocar de conta é decisão do app (e só se o usuário ligou a "troca automática").
 *
 * Reescrita própria a partir do broker.mjs da 0.4.18 (estudo do protocolo); sem código copiado.
 * Funções puras + `kv`/`media`/`now` injetáveis: roda igual no service worker e no Node dos testes.
 */
import {
  LIVE_LIMIT_MS,
  MAX_IN_FLIGHT,
  PRESENCE_TTL_MS,
  QUEUED_TTL_MS,
  RECONCILE_TTL_MS,
  RELOAD_WITHOUT_IDS_TTL_MS,
  BROKER_COMMANDS,
  canTransition,
  canonicalContext,
  classifyRefusal,
  isMutation,
  isTerminal,
  pauseUntil,
  scopeOf,
  validContext,
  validateVideoArgs,
  JOURNAL_RETENTION_MS,
} from '../lib/protocol.js';
import { ZerumError, clone, createMutex, fingerprint } from '../lib/util.js';

const CORE_KEY = 'zr:v1:core';
const orderKey = (id) => `zr:v1:o:${id}`;
const argsKey = (id) => `zr:v1:a:${id}`;

export class BrokerError extends ZerumError {
  constructor(code, status = 409, extra = {}) {
    super(code, { status, ...extra });
    this.name = 'BrokerError';
  }
}

const emptyCore = () => ({ v: 1, orderIds: [], jobs: {}, accounts: {}, media: {}, paused: [] });

/** A ordem já sabe QUAL geração é a dela no Flow (aba/mídia)? Então dá para reconciliar só lendo. */
export const hasIDs = (o) => !!(o.resume && (o.resume.tileId || o.resume.mediaRef || o.resume.candidates?.length));

export class Broker {
  /**
   * @param {{kv: object, media: object, now?: () => number, uid?: () => string}} deps
   */
  constructor({ kv, media, now = Date.now, uid = () => crypto.randomUUID() }) {
    this.kv = kv;
    this.media = media;
    this.now = now;
    this.uid = uid;
    this.core = null;
    this.orders = {};
    this.mutex = createMutex();
  }

  // ─── infraestrutura ────────────────────────────────────────────────────────────────────────────────────────────

  async #load() {
    if (this.core) return;
    const core = (await this.kv.get([CORE_KEY]))[CORE_KEY] ?? emptyCore();
    const ids = core.orderIds ?? [];
    const recs = ids.length ? await this.kv.get(ids.map(orderKey)) : {};
    this.orders = {};
    for (const id of ids) if (recs[orderKey(id)]) this.orders[id] = recs[orderKey(id)];
    core.orderIds = ids.filter((id) => this.orders[id]);
    this.core = core;
  }

  /** Serializa e garante o estado carregado. Erro que NÃO é do broker = persistência falhou: descarta o cache (o storage manda). */
  #run(fn) {
    return this.mutex(async () => {
      try {
        await this.#load();
        return await fn();
      } catch (e) {
        if (!(e instanceof BrokerError)) {
          this.core = null;
          this.orders = {};
        }
        throw e;
      }
    });
  }

  async #save({ orders = [], args = {}, remove = [] } = {}) {
    const set = { [CORE_KEY]: this.core };
    for (const id of orders) if (this.orders[id]) set[orderKey(id)] = this.orders[id];
    for (const [id, a] of Object.entries(args)) set[argsKey(id)] = a;
    await this.kv.set(set);
    if (remove.length) await this.kv.remove(remove);
  }

  #view(o) {
    // eslint-disable-next-line no-unused-vars
    const { fingerprint: _f, lease: _l, worker: _w, ...safe } = o;
    const view = clone(safe);
    if (o.state === 'queued') {
      const mine = this.core.orderIds.indexOf(o.id);
      view.queueAhead = this.core.orderIds.filter((id, i) => i < mine && this.orders[id]?.context.accountId === o.context.accountId && !isTerminal(this.orders[id].state)).length;
    }
    return view;
  }

  #find(jobId, key, attempt) {
    return Object.values(this.orders).find((o) => o.jobId === jobId && o.key === key && (o.attempt || 0) === attempt);
  }

  #accountOrders(accountId) {
    return Object.values(this.orders).filter((o) => o.context.accountId === accountId);
  }

  /** Aplica uma transição respeitando a tabela (a mesma do contrato). */
  #transition(o, to, patch = {}) {
    if (o.state !== to && !canTransition(o.state, to)) throw new BrokerError(`TRANSICAO_INVALIDA_${o.state}_${to}`, 500);
    Object.assign(o, patch, { state: to, updated: this.now() });
  }

  // ─── consultas do site ─────────────────────────────────────────────────────────────────────────────────────────

  /** "accounts": uma linha por conta que já bateu o coração. */
  async list() {
    return this.#run(async () => {
      await this.#expire();
      const now = this.now();
      return Object.values(this.core.accounts).map((a) => {
        const mine = this.#accountOrders(a.context.accountId);
        return {
          context: { ...a.context },
          online: now - a.seen < PRESENCE_TTL_MS,
          heartbeatAgeMs: Math.max(0, now - a.seen),
          presenceTtlMs: PRESENCE_TTL_MS,
          cooldownUntil: a.cooldownUntil || 0,
          credits: a.credits ?? null,
          creditsAt: a.creditsAt || 0,
          spentCredits: a.spentCredits || 0,
          paused: this.core.paused.includes(a.context.accountId),
          pending: mine.filter((o) => !isTerminal(o.state)).length,
          uncertain: mine.some((o) => o.state === 'unknown'),
          lastError: a.lastError || '',
        };
      });
    });
  }

  async get({ id }) {
    return this.#run(async () => {
      await this.#expire();
      const o = this.orders[id];
      if (!o) throw new BrokerError('ORDEM_NAO_ENCONTRADA', 404);
      return this.#view(o);
    });
  }

  /** A ordem ainda pertence a esta lease (despachada e não terminal)? Usado antes de aceitar bytes de mídia da aba. */
  async checkLease({ id, lease, worker }) {
    return this.#run(async () => {
      const o = this.orders[id];
      return !!o && !!lease && o.lease === lease && (!worker || o.worker === worker) && !isTerminal(o.state) && o.executionFinished !== true;
    });
  }

  async mediaState({ mediaId }) {
    return this.#run(async () => {
      if (typeof mediaId !== 'string' || !mediaId) throw new BrokerError('MEDIA_ID_OBRIGATORIO', 400);
      const origin = this.core.media[mediaId];
      if (!origin) return { context: null };
      const [accountId, projectId] = origin.split('|');
      return { context: { accountId, projectId, accountPath: this.core.accounts[accountId]?.context.accountPath ?? '' } };
    });
  }

  // ─── jobs e tentativas ─────────────────────────────────────────────────────────────────────────────────────────

  /** "job": tentativa atual do job. "beginAttempt" (renew): abre a próxima — só se nada pendente/incerto. */
  async job({ jobId, context }, renew = false) {
    return this.#run(async () => {
      if (!jobId || typeof jobId !== 'string') throw new BrokerError('JOB_OBRIGATORIO', 400);
      if (!validContext(context)) throw new BrokerError('CONTEXTO_INVALIDO', 400);
      const ctx = { ...context, accountId: context.accountId.toLowerCase() };
      await this.#expire();
      const prior = this.core.jobs[jobId];
      if (prior && scopeOf(prior) !== scopeOf(ctx)) throw new BrokerError('JOB_FIXADO_EM_OUTRA_CONTA');
      if (!renew) return { attempt: prior?.attempt || 0 };
      const mine = Object.values(this.orders).filter((o) => o.jobId === jobId);
      for (const o of mine) this.#expireRecovery(o);
      if (mine.some((o) => !isTerminal(o.state))) throw new BrokerError('JOB_AINDA_TEM_OPERACAO_PENDENTE');
      const reuse = prior?.reuseAttempt === true;
      const current = (this.core.jobs[jobId] = { ...prior, accountId: ctx.accountId, projectId: ctx.projectId, attempt: (prior?.attempt || 0) + (reuse ? 0 : 1) });
      delete current.reuseAttempt;
      await this.#save({ orders: mine.map((o) => o.id) });
      return { attempt: current.attempt };
    });
  }

  /** "recoverJob": o que fazer com um job depois de uma resposta perdida/queda. */
  async recoverJob({ jobId, context }) {
    return this.#run(async () => {
      if (!jobId || typeof jobId !== 'string') throw new BrokerError('JOB_OBRIGATORIO', 400);
      if (!validContext(context)) throw new BrokerError('CONTEXTO_INVALIDO', 400);
      const ctx = { ...context, accountId: context.accountId.toLowerCase() };
      await this.#expire();
      const prior = this.core.jobs[jobId];
      if (prior && scopeOf(prior) !== scopeOf(ctx)) throw new BrokerError('JOB_FIXADO_EM_OUTRA_CONTA');
      const mine = Object.values(this.orders).filter((o) => o.jobId === jobId).sort((a, b) => b.created - a.created);
      const pending = mine.find((o) => !isTerminal(o.state)) || Object.values(this.orders).find((o) => scopeOf(o.context) === scopeOf(ctx) && o.state === 'unknown');
      if (pending) {
        const age = this.#recoveryAge(pending);
        if (this.#expireRecovery(pending)) {
          await this.#save({ orders: [pending.id] });
          return { status: 'released', ageMs: age, operationId: pending.id, blockerJobId: pending.jobId, uncertainExpired: true };
        }
        // Com identificação da geração, a própria aba do Flow relê sozinha no próximo coração (heartbeat).
        if (pending.state === 'unknown') pending.reconcileSince ||= pending.updated || pending.created;
        await this.#save({ orders: [pending.id] });
        return { status: 'reconciling', ageMs: age, operationId: pending.id, blockerJobId: pending.jobId, hasCandidates: hasIDs(pending), retryAfterMs: Math.min(2500, Math.max(500, this.#recoveryTtl(pending) - age)) };
      }
      const latest = mine[0];
      if (latest?.state === 'completed') {
        const j = (this.core.jobs[jobId] ||= { accountId: ctx.accountId, projectId: ctx.projectId, attempt: 0 });
        j.reuseAttempt = true;
        await this.#save();
        return { status: 'completed', operationId: latest.id };
      }
      return { status: 'released', operationId: latest?.id || null, ...(latest?.releasedUncertain ? { uncertainExpired: true, blockerJobId: jobId } : {}) };
    });
  }

  // ─── fila ──────────────────────────────────────────────────────────────────────────────────────────────────────

  /** "enqueue": cria a ordem (ou devolve a MESMA, se a chave já existe — resposta perdida nunca duplica a geração). */
  async enqueue(p) {
    return this.#run(async () => {
      const { jobId, context, cmd, args, key } = p ?? {};
      const attempt = p?.attempt ?? 0;
      if (!validContext(context)) throw new BrokerError('CONTEXTO_INVALIDO', 400);
      if (!jobId || typeof jobId !== 'string' || !key || typeof key !== 'string' || !BROKER_COMMANDS.includes(cmd) || !Number.isInteger(attempt) || attempt < 0) throw new BrokerError('COMANDO_INVALIDO', 400);
      const ctx = { ...context, accountId: context.accountId.toLowerCase() };
      await this.#expire();

      const job = this.core.jobs[jobId];
      if (job && scopeOf(job) !== scopeOf(ctx)) throw new BrokerError('JOB_FIXADO_EM_OUTRA_CONTA');

      const fp = await fingerprint({ jobId, context: canonicalContext(ctx), cmd, args });
      const prior = this.#find(jobId, key, attempt);
      if (prior) {
        // A mesma chave com OUTRO conteúdo é um erro de quem chama; com o mesmo conteúdo é só um reenvio.
        if (prior.fingerprint !== fp) throw new BrokerError('CHAVE_REUTILIZADA_COM_OUTRO_PEDIDO');
        return this.#view(prior);
      }

      if (cmd === 'generate.video') {
        const bad = validateVideoArgs(args);
        if (bad) throw new BrokerError(bad, 400);
      }
      const now = this.now();
      const acct = this.core.accounts[ctx.accountId];
      if (!acct || scopeOf(acct.context) !== scopeOf(ctx) || now - acct.seen >= PRESENCE_TTL_MS) throw new BrokerError('CONTA_PROJETO_OFFLINE');
      if (attempt !== (job?.attempt || 0)) throw new BrokerError('TENTATIVA_SUPERADA');
      if (isMutation(cmd)) {
        if (this.core.paused.includes(ctx.accountId)) throw new BrokerError('CONTA_PAUSADA_PELO_USUARIO');
        if (this.#accountOrders(ctx.accountId).some((o) => o.state === 'unknown')) throw new BrokerError('CONTA_COM_OPERACAO_INCERTA');
        if ((acct.cooldownUntil || 0) > now) throw new BrokerError('CONTA_EM_PAUSA_COTA', 409, { retryable: true, retryAt: acct.cooldownUntil });
      }

      const o = { id: this.uid(), key, fingerprint: fp, jobId, attempt, context: { ...ctx }, cmd, state: 'queued', created: now, updated: now };
      this.orders[o.id] = o;
      this.core.orderIds.push(o.id);
      this.core.jobs[jobId] ||= { accountId: ctx.accountId, projectId: ctx.projectId, attempt: 0 };
      await this.#save({ orders: [o.id], args: { [o.id]: args } });
      return this.#view(o);
    });
  }

  /**
   * "reconcile": a RELEITURA de uma ordem incerta. Nunca cria geração nova.
   * Com identificação da geração (aba/mídia) a própria aba do Flow recebe a ordem em modo "só ler" no próximo coração
   * (isso acontece sozinho; aqui só se confirma o prazo e se devolve o estado). Sem identificação não há o que reler:
   * a ordem segue incerta (bloqueando a conta) até o prazo e então vira falha explícita.
   */
  async reconcile({ id }) {
    return this.#run(async () => {
      await this.#expire();
      const o = this.orders[id];
      if (!o) throw new BrokerError('ORDEM_NAO_ENCONTRADA', 404);
      if (isTerminal(o.state)) return this.#view(o);
      if (o.state !== 'unknown') {
        if (!hasIDs(o)) throw new BrokerError('OPERACAO_NAO_PRECISA_RECONCILIAR');
        return this.#view(o); // em andamento (ou ainda na fila): nada a reconciliar
      }
      o.reconcileSince ||= o.updated || o.created;
      this.#expireRecovery(o);
      await this.#save({ orders: [o.id] });
      return this.#view(o);
    });
  }

  /** Pausa/retoma uma conta por vontade do usuário (a conta só deixa de receber ordens NOVAS). */
  async setPaused(email, paused) {
    return this.#run(async () => {
      const e = String(email || '').toLowerCase();
      const set = new Set(this.core.paused);
      if (paused) set.add(e);
      else set.delete(e);
      this.core.paused = [...set];
      await this.#save();
      return { paused: this.core.paused };
    });
  }

  // ─── coração da aba executora ──────────────────────────────────────────────────────────────────────────────────

  /**
   * A aba do Flow bate o coração: informa presença/créditos, entrega eventos (outbox) e recebe ordens.
   * Confirmação perdida repete a ENTREGA do evento, nunca a geração.
   */
  async heartbeat({ context, worker, events = [], capacity = 1, credits, tabId } = {}) {
    return this.#run(async () => {
      if (!validContext(context)) throw new BrokerError('CONTEXTO_INVALIDO', 400);
      if (typeof worker !== 'string' || !worker) throw new BrokerError('WORKER_OBRIGATORIO', 400);
      const now = this.now();
      const ctx = { ...context, accountId: context.accountId.toLowerCase() };
      const prev = this.core.accounts[ctx.accountId];
      if (prev && prev.worker !== worker && now - prev.seen < PRESENCE_TTL_MS) throw new BrokerError('CONTA_JA_TEM_ABA_EXECUTORA');

      const routeChanged = !!prev && (prev.context.projectId !== ctx.projectId || prev.context.accountPath !== ctx.accountPath || prev.worker !== worker);
      const acct = (this.core.accounts[ctx.accountId] = { ...prev, context: ctx, worker, seen: now, ...(tabId != null ? { tabId } : {}) });
      if (Number.isInteger(credits) && credits >= 0) {
        if (Number.isInteger(acct.credits)) acct.spentCredits = (acct.spentCredits || 0) + Math.max(0, acct.credits - credits);
        acct.credits = credits;
        acct.creditsAt = now;
      }

      const touched = new Set();
      if (routeChanged) {
        // Outra aba/projeto: o que estava em voo NÃO foi perdido nem repetido — fica incerto para reconciliar.
        for (const o of this.#accountOrders(ctx.accountId)) {
          if (!isTerminal(o.state) && (o.state === 'dispatched' || o.state === 'accepted')) {
            this.#transition(o, 'unknown', { error: 'ROTA_ALTERADA_RECONCILIAR', executionFinished: true, reconcileSince: o.reconcileSince || now });
            if (hasIDs(o)) o.candidateDeadline ||= now + RECONCILE_TTL_MS;
            touched.add(o.id);
          }
        }
      }

      const ack = [];
      for (const ev of events) {
        const o = this.orders[ev?.id];
        // Sem ordem, de outro worker ou de outra lease: não há o que aplicar — confirma para a aba esvaziar o outbox.
        if (!o || o.worker !== worker || o.lease !== ev.lease || o.context.accountId !== ctx.accountId) {
          if (ev?.eventId) ack.push(ev.eventId);
          continue;
        }
        if (!['accepted', 'completed', 'failed', 'unknown'].includes(ev.state)) {
          ack.push(ev.eventId);
          continue;
        }
        if (isTerminal(o.state)) {
          ack.push(ev.eventId);
          continue;
        }
        await this.#applyEvent(o, ev, acct);
        touched.add(o.id);
        ack.push(ev.eventId);
      }

      this.#expireInto(touched);
      const orders = [];
      const limit = Math.min(MAX_IN_FLIGHT, Number.isInteger(capacity) && capacity > 0 ? capacity : 1);
      const mine = this.#accountOrders(ctx.accountId);
      let inFlight = mine.filter((o) => o.state === 'dispatched' || (o.state === 'accepted' && !o.executionFinished) || (o.state === 'unknown' && o.resuming)).length;
      const blocked = (acct.cooldownUntil || 0) > now || this.core.paused.includes(ctx.accountId) || mine.some((o) => o.state === 'unknown' && !o.resuming);
      for (const o of Object.values(this.orders)) {
        if (inFlight >= limit) break;
        if (scopeOf(o.context) !== scopeOf(ctx)) continue;
        // `unknown` COM identificação volta para a aba em modo "só ler" (reconciliação) — mesmo com a conta em pausa/bloqueada.
        const resumable = o.state === 'unknown' && !o.resuming && hasIDs(o);
        const runnable = o.state === 'queued' && (!blocked || !isMutation(o.cmd));
        if (!resumable && !runnable) continue;
        const lease = this.uid();
        if (runnable) this.#transition(o, 'dispatched', { worker, lease, dispatched: now, executionFinished: false, context: { ...ctx }, mode: 'run' });
        else Object.assign(o, { worker, lease, dispatched: now, updated: now, executionFinished: false, resuming: true, mode: 'resume' });
        inFlight++;
        touched.add(o.id);
        orders.push({ ...(await this.#dispatchView(o)) });
      }

      await this.#save({ orders: [...touched] });
      return { ack, order: orders[0] ?? null, orders, cooldownUntil: acct.cooldownUntil || 0, paused: this.core.paused.includes(ctx.accountId), serverTime: now };
    });
  }

  async #dispatchView(o) {
    const args = (await this.kv.get([argsKey(o.id)]))[argsKey(o.id)];
    // eslint-disable-next-line no-unused-vars
    const { fingerprint: _f, ...rest } = o;
    return { ...clone(rest), args };
  }

  async #applyEvent(o, ev, acct) {
    const now = this.now();
    if (ev.resume && typeof ev.resume === 'object') o.resume = { ...o.resume, ...clone(ev.resume) };
    o.updated = now;
    if (ev.error) {
      o.error = String(ev.error).slice(0, 300);
      const kind = classifyRefusal(o.error);
      if (kind) {
        // 24 h para cota, 5 min para atividade incomum. O prazo exato do Google não é inferido: é conservador.
        acct.cooldownUntil = Math.max(acct.cooldownUntil || 0, pauseUntil(kind, now));
        acct.lastError = o.error;
      }
    }
    if (o.state === 'unknown' && ev.state === 'accepted') {
      // Reconciliação em andamento: progresso da releitura. O estado só muda quando houver veredito.
      return;
    }
    if (ev.state === 'accepted') {
      if (o.state === 'dispatched') this.#transition(o, 'accepted', { executionFinished: false });
      else if (o.state === 'accepted') o.executionFinished = !!ev.executionFinished;
      if (hasIDs(o)) o.candidateDeadline ||= now + RECONCILE_TTL_MS;
      return;
    }
    // Eventos intermediários podem ter sido coalescidos: `dispatched` passa por `accepted` antes de qualquer veredito.
    if (o.state === 'dispatched') this.#transition(o, 'accepted', { executionFinished: false });
    if (ev.state === 'unknown') {
      this.#transition(o, 'unknown', { executionFinished: true, reconcileSince: o.reconcileSince || now, resuming: false });
      if (hasIDs(o)) o.candidateDeadline ||= now + RECONCILE_TTL_MS;
      return;
    }
    if (ev.state === 'failed') {
      this.#transition(o, 'failed', { executionFinished: true, resuming: false });
      await this.#dropArgs(o);
      return;
    }
    // completed: só vale se os bytes do MP4 chegaram inteiros ao journal (senão a geração aconteceu mas o arquivo não — incerto).
    if (o.cmd === 'generate.video') {
      const meta = await this.media.meta(o.id);
      const bytes = ev.result?.bytes;
      if (!meta?.done || !(bytes > 0) || meta.size !== bytes) {
        this.#transition(o, 'unknown', { error: 'MIDIA_NAO_ENTREGUE', executionFinished: true, reconcileSince: o.reconcileSince || now, resuming: false });
        if (hasIDs(o)) o.candidateDeadline ||= now + RECONCILE_TTL_MS;
        return;
      }
      o.result = { mediaRef: String(ev.result?.mediaRef || o.resume?.mediaRef || ''), mimeType: meta.mimeType, bytes: meta.size, sha256: meta.sha256, parts: meta.parts, ...(ev.result?.durationS ? { durationS: ev.result.durationS } : {}) };
      if (o.result.mediaRef) this.core.media[o.result.mediaRef] = scopeOf(o.context);
    } else {
      o.result = clone(ev.result ?? {});
    }
    this.#transition(o, 'completed', { executionFinished: true, resuming: false, error: undefined, completedAt: now });
    delete o.candidateDeadline;
    await this.#dropArgs(o);
  }

  async #dropArgs(o) {
    // O pedido (com a imagem inteira) não precisa mais ficar guardado; a impressão digital continua para deduplicar.
    await this.kv.remove([argsKey(o.id)]);
  }

  // ─── prazos ────────────────────────────────────────────────────────────────────────────────────────────────────

  #recoveryAge(o) {
    return this.now() - (o.reconcileSince || o.updated || o.created);
  }
  #recoveryTtl(o) {
    return hasIDs(o) ? RECONCILE_TTL_MS : RELOAD_WITHOUT_IDS_TTL_MS;
  }

  /** `unknown` velho demais vira falha EXPLÍCITA (nunca nova geração). Devolve true se mudou. */
  #expireRecovery(o) {
    if (o.state !== 'unknown' || this.#recoveryAge(o) < this.#recoveryTtl(o)) return false;
    const ids = hasIDs(o);
    this.#transition(o, 'failed', { error: ids ? 'CANDIDATOS_NAO_RECONCILIADOS_SEM_REENVIO' : 'RECONCILIACAO_EXPIRADA_LIBERADA_PARA_NOVA_TENTATIVA', releasedUncertain: !ids, executionFinished: true, resuming: false });
    return true;
  }

  /** Aplica todos os prazos. Devolve os ids alterados (para o chamador gravar). */
  #expireInto(touched = new Set()) {
    const now = this.now();
    for (const o of Object.values(this.orders)) {
      if (isTerminal(o.state)) continue;
      if (o.candidateDeadline && now >= o.candidateDeadline) {
        this.#transition(o, 'failed', { error: 'CANDIDATOS_NAO_RECONCILIADOS_SEM_REENVIO', executionFinished: true, resuming: false });
        touched.add(o.id);
        continue;
      }
      if (o.state === 'queued') {
        // Nunca saiu do navegador: expirar é seguro (nada foi enviado ao Google) e impede gerar horas depois do pedido.
        if (now - o.created >= QUEUED_TTL_MS) {
          this.#transition(o, 'failed', { error: 'NAO_DESPACHADA_EXPIRADA', executionFinished: true });
          touched.add(o.id);
        }
        continue;
      }
      const last = o.updated || o.dispatched || o.created;
      if ((o.state === 'dispatched' || o.state === 'accepted') && !o.executionFinished && now - last >= LIVE_LIMIT_MS) {
        this.#transition(o, 'unknown', { error: 'EXECUTOR_SEM_RESPOSTA', executionFinished: true, reconcileSince: o.reconcileSince || now });
        if (hasIDs(o)) o.candidateDeadline ||= now + RECONCILE_TTL_MS;
        touched.add(o.id);
      }
      if (o.state === 'unknown' && o.resuming && now - last >= LIVE_LIMIT_MS) {
        // A releitura travou: volta a ficar só "incerta" (um novo reconcile pode tentar de novo).
        o.resuming = false;
        touched.add(o.id);
      }
      if (o.state === 'unknown' && !o.reconcileSince) {
        o.reconcileSince = now;
        touched.add(o.id);
      }
      if (this.#expireRecovery(o)) touched.add(o.id);
    }
    return touched;
  }

  async #expire() {
    const touched = this.#expireInto();
    if (touched.size) await this.#save({ orders: [...touched] });
  }

  // ─── manutenção ────────────────────────────────────────────────────────────────────────────────────────────────

  /** Remove do journal ordens TERMINAIS antigas (e os bytes delas). Nada em andamento é tocado. */
  async prune({ olderThanMs = JOURNAL_RETENTION_MS } = {}) {
    return this.#run(async () => {
      const limit = this.now() - olderThanMs;
      const gone = Object.values(this.orders).filter((o) => isTerminal(o.state) && (o.updated || o.created) < limit);
      if (!gone.length) return { removed: 0 };
      for (const o of gone) {
        delete this.orders[o.id];
        await this.media.delete(o.id);
      }
      this.core.orderIds = this.core.orderIds.filter((id) => this.orders[id]);
      await this.#save({ remove: gone.flatMap((o) => [orderKey(o.id), argsKey(o.id)]) });
      return { removed: gone.length };
    });
  }

  /** Resumo para o popup (sem argumentos nem bytes). */
  async snapshot({ recent = 15 } = {}) {
    return this.#run(async () => {
      await this.#expire();
      const orders = Object.values(this.orders).sort((a, b) => b.created - a.created).slice(0, recent).map((o) => ({ id: o.id, jobId: o.jobId, cmd: o.cmd, state: o.state, error: o.error || '', accountId: o.context.accountId, created: o.created, updated: o.updated }));
      return { orders, paused: [...this.core.paused], accounts: Object.keys(this.core.accounts).length };
    });
  }
}
