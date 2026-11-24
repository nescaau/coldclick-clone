/**
 * A "bomba" da geração real (roda na PÁGINA do Zerum): leva cenas do servidor para a extensão e o MP4 de volta.
 *
 *   a cada ~4 s: consulta a extensão → informa o servidor (heartbeat) → se esta aba é a LÍDER e o modo é "real",
 *   reserva cenas (claim) até o limite de "Vídeos simultâneos" e executa cada uma (`runScene`).
 *
 * `runScene` é IDEMPOTENTE por construção: começa sempre por `enqueue` com a chave da cena. Se a ordem já existe na
 * extensão (aba recarregada, resposta perdida, outra aba assumiu), o broker devolve a MESMA ordem — nunca uma geração nova.
 * Por isso retomar = rodar de novo a mesma cena.
 *
 * Regras que esta bomba NUNCA quebra:
 *  - não reenvia nada ao perder a resposta da extensão: relê (`get`) com a mesma chave, como no original;
 *  - não falha uma cena só porque a extensão demorou a responder (o pedido fica preservado);
 *  - não gera nada se a conta está em pausa por cota (o broker recusa; aqui vira falha explícita com o horário);
 *  - todo acesso ao servidor passa por `PumpApi` (lib/client.ts): nenhuma rede nova.
 */
import { classifyRefusal } from './broker';
import { BridgeError, isNoResponse } from './client';
import { pickAccount } from './accounts';
import type { ExtensionApi } from './executor';
import type { FlowContext, GenerateVideoArgs, OrderView } from './protocol';
import { accountUsable, type BridgeStatus, type FlowAccount } from './status';
import type { ClaimResponse, ClipResponse, FailResponse, HeartbeatResponse, ProgressResponse, SceneWork } from './work';

/** O que a bomba usa do servidor (implementado sobre lib/client.ts; nos testes, um servidor falso). */
export interface PumpApi {
  heartbeat(body: { pumpId: string; status: BridgeStatus }): Promise<HeartbeatResponse>;
  claim(body: { pumpId: string; accountId: string; available: string[] }): Promise<ClaimResponse>;
  progress(w: SceneWork, pumpId: string, orderId: string): Promise<ProgressResponse>;
  uploadClip(w: SceneWork, pumpId: string, orderId: string, mediaRef: string, bytes: Uint8Array): Promise<ClipResponse>;
  fail(w: SceneWork, body: { pumpId: string; orderId: string; code: string; message: string; kind: 'cota' | 'incomum' | 'outro'; retryAt?: number }): Promise<FailResponse>;
  settings(): Promise<{ parallel: number; autoSwitch: boolean; minCredits: number }>;
  photo(avatarId: string): Promise<{ bytes: Uint8Array; mime: string }>;
}

export interface PumpDeps {
  api: PumpApi;
  ext: ExtensionApi;
  /** O estado atual da extensão (com contas) — o mesmo que vai ao servidor no heartbeat. */
  status: () => Promise<BridgeStatus>;
  /** A conta que o usuário escolheu em "Contas Flow" (e-mail), se escolheu. */
  selectedAccount: () => string | null;
  now?: () => number;
  sleep?: (ms: number) => Promise<void>;
  log?: (message: string) => void;
  /** Mudou algo que a tela deve reler (vídeo andou). */
  onProgress?: () => void;
  /** A cada volta: o estado da extensão e o que o servidor decidiu (modo, liderança, o que a bomba espera). */
  onStatus?: (status: BridgeStatus, info: { mode: ClaimResponse['mode']; leader: boolean; reason: string }) => void;
  pumpId: string;
  timing?: Partial<typeof TIMING>;
}

export const TIMING = {
  pollMs: 3_000,
  /** De quanto em quanto tempo a cena renova a reserva no servidor. */
  renewMs: 10_000,
  /** A cena desiste de ACOMPANHAR (não de existir) depois disso — a ordem continua preservada na extensão. */
  runDeadlineMs: 25 * 60_000,
  settingsMs: 30_000,
  /** Quanto esperar a extensão responder `get` antes de tentar de novo (EXTENSAO_SEM_RESPOSTA). */
  getRetryMs: 5_000,
  /** Conta momentaneamente indisponível (aba reconectando): quanto esperar antes de tentar o `enqueue` de novo. */
  busyRetryMs: 5_000,
  busyTries: 24,
  uploadTries: 4,
};

const toBase64 = (bytes: Uint8Array): string => {
  let bin = '';
  for (let i = 0; i < bytes.length; i += 0x8000) bin += String.fromCharCode(...bytes.subarray(i, i + 0x8000));
  return btoa(bin);
};

const code = (e: unknown): string => (e instanceof BridgeError ? (e.code ?? e.message) : '');
const text = (e: unknown): string => (e instanceof Error ? e.message : String(e));

/** Mensagem de falha do broker/extensão → (tipo, código curto) para o servidor. */
export function failureOf(error: string): { kind: 'cota' | 'incomum' | 'outro'; code: string } {
  const kind = classifyRefusal(error) ?? 'outro';
  return { kind, code: (error.split(/[\s·]/)[0] || 'FLOW_ERRO').slice(0, 120) };
}

export class BridgePump {
  private readonly running = new Map<string, Promise<void>>();
  private stopped = false;
  private timer: ReturnType<typeof setTimeout> | null = null;
  private settings = { parallel: 2, autoSwitch: false, minCredits: 20, at: 0 };
  private lastAccount: string | null = null;
  /** O que a bomba está esperando (para a tela: "Troca automática pausada…", "limite de simultâneos"…). */
  lastReason = '';
  private snapshot: FlowAccount[] = [];
  private readonly t: typeof TIMING;
  private readonly now: () => number;
  private readonly sleep: (ms: number) => Promise<void>;

  constructor(private readonly d: PumpDeps) {
    this.t = { ...TIMING, ...d.timing };
    this.now = d.now ?? Date.now;
    this.sleep = d.sleep ?? ((ms) => new Promise((r) => setTimeout(r, ms)));
  }

  private log = (m: string) => this.d.log?.(m);

  /** Cenas em execução agora (para testes e para a UI). */
  get active(): number {
    return this.running.size;
  }
  /** Espera as cenas em execução terminarem (testes). */
  async idle(): Promise<void> {
    while (this.running.size) await Promise.allSettled([...this.running.values()]);
  }

  start(everyMs = 4_000): void {
    this.stopped = false;
    const loop = async () => {
      if (this.stopped) return;
      await this.tick().catch((e) => this.log(`bomba: ${text(e)}`));
      if (!this.stopped) this.timer = setTimeout(loop, everyMs);
    };
    void loop();
  }
  stop(): void {
    this.stopped = true;
    if (this.timer) clearTimeout(this.timer);
  }

  /** Uma volta: informa o servidor e, se for a aba líder em modo real, preenche as vagas com cenas. */
  async tick(): Promise<ClaimResponse['reason']> {
    const status = await this.d.status();
    this.snapshot = status.accounts ?? [];
    const hb = await this.d.api.heartbeat({ pumpId: this.d.pumpId, status: { ...status, detail: status.detail.slice(0, 400) } });
    const report = (reason: string) => {
      this.lastReason = reason;
      this.d.onStatus?.(status, { mode: hb.mode, leader: hb.leader, reason });
      return reason;
    };
    if (hb.mode !== 'real') return report(hb.mode === 'simulado' ? 'SIMULACAO_LIGADA' : 'EXTENSAO_NAO_CONECTADA');
    if (!hb.leader) return report('OUTRA_ABA_EXECUTANDO');
    await this.refreshSettings();

    this.lastReason = '';
    while (!this.stopped && this.running.size < this.settings.parallel) {
      const pick = pickAccount({ accounts: this.snapshot, selected: this.d.selectedAccount(), current: this.lastAccount, autoSwitch: this.settings.autoSwitch, minCredits: this.settings.minCredits, now: this.now() });
      const available = this.snapshot.filter((a) => a.online).map((a) => a.email ?? a.accountId);
      const r = await this.d.api.claim({ pumpId: this.d.pumpId, accountId: pick.account?.email ?? '', available });
      if (!r.work) {
        // Sem trabalho por falta de conta: a razão mais útil é a da escolha de conta.
        this.lastReason = r.reason === 'SEM_CONTA_ESCOLHIDA' && pick.reason ? pick.reason : r.reason;
        break;
      }
      this.lastAccount = r.work.accountId;
      const key = `${r.work.videoId}:${r.work.sceneIdx}`;
      if (this.running.has(key)) break; // já está sendo executada aqui (o servidor não devolveria; defesa)
      const run = this.runScene(r.work)
        .catch((e) => this.log(`${r.work!.label}: ${text(e)}`))
        .finally(() => this.running.delete(key));
      this.running.set(key, run);
    }
    return report(this.lastReason);
  }

  private async refreshSettings(): Promise<void> {
    if (this.now() - this.settings.at < this.t.settingsMs) return;
    const s = await this.d.api.settings();
    this.settings = { parallel: Math.max(1, s.parallel), autoSwitch: s.autoSwitch, minCredits: s.minCredits, at: this.now() };
  }

  private contextOf(accountId: string): FlowContext | null {
    const a = this.snapshot.find((x) => (x.email ?? x.accountId).toLowerCase() === accountId.toLowerCase() && x.online);
    return a ? { accountId: a.accountId, projectId: a.projectId, accountPath: a.accountPath } : null;
  }
  private accountOf(accountId: string): FlowAccount | undefined {
    return this.snapshot.find((x) => (x.email ?? x.accountId).toLowerCase() === accountId.toLowerCase());
  }

  /** Para de acompanhar sem falhar a cena (a reserva expira sozinha e a cena será retomada pela mesma chave). */
  private async waitOrStop(ms: number): Promise<boolean> {
    await this.sleep(ms);
    return !this.stopped;
  }

  /** Executa UMA cena do começo ao fim — ou até ela ser cancelada, ou até esta aba parar de acompanhar. */
  async runScene(w: SceneWork): Promise<void> {
    const { api, ext, pumpId } = this.d;
    const started = this.now();
    const fail = async (orderId: string, f: { kind: 'cota' | 'incomum' | 'outro'; code: string; message: string; retryAt?: number }) => {
      this.log(`${w.label}: falhou (${f.code})`);
      await api.fail(w, { pumpId, orderId, ...f }).catch((e) => this.log(`${w.label}: não consegui avisar a falha — ${text(e)}`));
      this.d.onProgress?.();
    };

    // 1) onde (conta/projeto) — a ordem vive na conta onde nasceu
    let ctx = this.contextOf(w.accountId);
    for (let i = 0; !ctx && i < this.t.busyTries; i++) {
      if (!(await this.waitOrStop(this.t.busyRetryMs))) return;
      this.snapshot = (await this.d.status()).accounts ?? this.snapshot;
      ctx = this.contextOf(w.accountId);
    }
    if (!ctx) return this.log(`${w.label}: a conta ${w.accountId} não está disponível; a cena continua reservada e será retomada.`);

    // 2) tentativa (o broker só aceita a atual) + foto do avatar
    let order: OrderView | null = null;
    try {
      const job = await ext.job(w.jobId, ctx);
      if (w.attempt < job.attempt) return await fail('', { kind: 'outro', code: 'TENTATIVA_SUPERADA', message: 'a extensão já está numa tentativa mais nova desta cena' });
      for (let a = job.attempt; a < w.attempt; a++) await ext.beginAttempt(w.jobId, ctx);
    } catch (e) {
      if (isNoResponse(e)) return this.log(`${w.label}: ${text(e)}`);
      if (code(e) === 'JOB_AINDA_TEM_OPERACAO_PENDENTE') {
        /* há ordem pendente deste job: o enqueue com a mesma chave a devolve — segue */
      } else return await fail('', { kind: 'outro', code: code(e) || 'EXTENSAO_ERRO', message: text(e) });
    }

    let firstFrame: { base64: string; mimeType: 'image/png' | 'image/jpeg' | 'image/webp'; name: string } | undefined;
    if (w.reference) {
      try {
        const photo = await api.photo(w.reference.avatarId);
        firstFrame = { base64: toBase64(photo.bytes), mimeType: w.reference.mimeType, name: w.reference.name };
      } catch (e) {
        return await fail('', { kind: 'outro', code: 'FOTO_DO_AVATAR', message: `não consegui ler a foto do avatar (${text(e)})` });
      }
    }

    // 3) enqueue — a MESMA chave devolve a MESMA ordem (resposta perdida / aba recarregada / retomada)
    const args: [GenerateVideoArgs] = [{ prompt: w.args.prompt, aspectRatio: w.args.aspectRatio, durationSeconds: w.args.durationSeconds, ...(firstFrame ? { firstFrame } : {}) }];
    for (let tries = 0; !order; tries++) {
      try {
        order = await ext.enqueue({ jobId: w.jobId, context: ctx, cmd: 'generate.video', args, key: w.opKey, attempt: w.attempt });
      } catch (e) {
        const c = code(e);
        if (isNoResponse(e) && tries < 2) {
          this.log(`${w.label}: a extensão não respondeu o pedido; reenviando a mesma chave (o broker não duplica).`);
          continue;
        }
        if (c === 'CONTA_EM_PAUSA_COTA') {
          return await fail('', { kind: 'cota', code: c, message: 'conta em pausa por cota', retryAt: e instanceof BridgeError && e.retryAt ? e.retryAt : this.accountOf(w.accountId)?.cooldownUntil });
        }
        if (['CONTA_PAUSADA_PELO_USUARIO', 'CONTA_COM_OPERACAO_INCERTA', 'CONTA_PROJETO_OFFLINE', 'CONTA_JA_TEM_ABA_EXECUTORA'].includes(c) || isNoResponse(e)) {
          if (tries >= this.t.busyTries || !(await this.waitOrStop(this.t.busyRetryMs))) return this.log(`${w.label}: a conta não pôde receber o pedido agora (${c || 'sem resposta'}); a reserva expira e a cena será retomada.`);
          continue;
        }
        return await fail('', { kind: 'outro', code: c || 'EXTENSAO_ERRO', message: text(e) });
      }
    }
    let cur: OrderView = order;
    this.log(`${w.label}: ordem ${cur.id.slice(0, 8)} na extensão (${cur.state}).`);

    // 4) acompanha até concluir (só LÊ a ordem; nunca reenvia)
    let lastRenew = 0;
    let lastReconcile = 0;
    for (;;) {
      if (this.stopped) return;
      if (this.now() - lastRenew >= this.t.renewMs || lastRenew === 0) {
        lastRenew = this.now();
        const p = await api.progress(w, pumpId, cur.id).catch(() => null);
        if (p && !p.continue) return this.log(`${w.label}: parei de acompanhar (${p.reason}).`);
      }
      try {
        cur = await ext.getOrder(cur.id);
      } catch (e) {
        if (!isNoResponse(e) && code(e) !== 'ORDEM_NAO_ENCONTRADA') return await fail(cur.id, { kind: 'outro', code: code(e) || 'EXTENSAO_ERRO', message: text(e) });
        if (code(e) === 'ORDEM_NAO_ENCONTRADA') return await fail(cur.id, { kind: 'outro', code: 'ORDEM_NAO_ENCONTRADA', message: 'a extensão não tem mais esta ordem (histórico limpo?)' });
        if (this.now() - started > this.t.runDeadlineMs) return this.log(`${w.label}: a extensão ficou sem responder; o pedido está preservado e será retomado.`);
        if (!(await this.waitOrStop(this.t.getRetryMs))) return;
        continue;
      }

      if (cur.state === 'completed') return await this.deliver(w, cur, fail);
      if (cur.state === 'failed') {
        const f = failureOf(cur.error ?? 'FLOW_ERRO');
        const uncertain = cur.releasedUncertain ? ' A geração ficou incerta e não foi possível relê-la: ela PODE ter sido feita (e cobrada) — confira a galeria do Flow antes de tentar de novo.' : '';
        // A pausa por cota acabou de começar: a hora da volta vem do estado ATUAL da extensão (o retrato guardado é anterior).
        const fresh = f.kind === 'cota' ? await this.d.status().then((s) => s.accounts ?? []).catch(() => this.snapshot) : this.snapshot;
        const until = fresh.find((a) => (a.email ?? a.accountId).toLowerCase() === w.accountId.toLowerCase())?.cooldownUntil;
        return await fail(cur.id, { kind: f.kind, code: f.code, message: `${cur.error ?? ''}${uncertain}`.slice(0, 400), retryAt: f.kind === 'cota' && until ? until : undefined });
      }
      if (cur.state === 'unknown' && this.now() - lastReconcile >= this.t.renewMs) {
        lastReconcile = this.now();
        await ext.reconcile(cur.id).catch(() => undefined); // releitura (só leitura): a aba do Flow retoma sozinha
      }
      if (this.now() - started > this.t.runDeadlineMs) return this.log(`${w.label}: ainda gerando depois de ${Math.round(this.t.runDeadlineMs / 60000)} min; a ordem está preservada e será retomada.`);
      if (!(await this.waitOrStop(this.t.pollMs))) return;
    }
  }

  /** Ordem CONCLUÍDA: lê o MP4 da extensão e entrega ao servidor (com repetição; o arquivo continua no journal se falhar). */
  private async deliver(w: SceneWork, order: OrderView, fail: (orderId: string, f: { kind: 'cota' | 'incomum' | 'outro'; code: string; message: string }) => Promise<void>): Promise<void> {
    let bytes: Uint8Array;
    try {
      bytes = await this.d.ext.downloadClip(order.id, { bytes: order.result?.bytes, sha256: order.result?.sha256 });
    } catch (e) {
      return this.log(`${w.label}: não consegui ler o vídeo da extensão (${text(e)}); a cena será retomada e o vídeo lido de novo.`);
    }
    for (let i = 1; ; i++) {
      try {
        const r = await this.d.api.uploadClip(w, this.d.pumpId, order.id, order.result?.mediaRef ?? '', bytes);
        this.log(`${w.label}: pronta${r.finished ? ' — vídeo completo' : ''}.`);
        this.d.onProgress?.();
        return;
      } catch (e) {
        const status = (e as { status?: number }).status ?? 0;
        if (status === 409 || status === 404) return this.log(`${w.label}: o servidor recusou o clipe (${text(e)}); ignorado.`);
        if (status === 400 || status === 413) return await fail(order.id, { kind: 'outro', code: 'CLIPE_RECUSADO', message: text(e) });
        if (i >= this.t.uploadTries || this.stopped) return this.log(`${w.label}: não consegui entregar o clipe ao servidor (${text(e)}); a cena será retomada e o vídeo lido de novo.`);
        await this.sleep(2_000 * i);
      }
    }
  }
}

/** A conta serve para uma cena nova agora? (reexporta a regra para a UI não repeti-la) */
export const canRunNow = accountUsable;
