/**
 * Estado da ponte exibido na UI (pílula, banner, modal "CONECTAR O FLOW") e a interface do executor.
 *
 * Quem fala com a extensão é o NAVEGADOR (window.postMessage): o executor real é `ExtensionFlowExecutor`
 * (executor.ts), que vive na página. O servidor só espelha o último estado que a página informou (bridge-service.ts).
 * Sem extensão (ou sem resposta) o estado continua o de sempre: fila + `EXTENSAO_NAO_INSTALADA`.
 */
import { untilLabel } from '../domain/clock-label';
import type { FlowContext, ExtensionStatus } from './protocol';
import { ERR_NO_RESPONSE } from './protocol';
import type { OperationRecord } from './broker';

export interface BridgeChecklist {
  extensionInstalled: boolean;
  extensionConnected: boolean;
  flowTabOpen: boolean;
  accountChosen: boolean;
}

export interface BridgeStatus {
  ready: boolean;
  /** Operações em andamento (mostradas como "● Flow ligado · N em andamento"). */
  pending: number;
  /** Motivo curto para depuração/log; no modal vira "detalhe: …". */
  detail: string;
  checklist: BridgeChecklist;
  /** Versão da extensão (quando ela respondeu). */
  version?: string;
  /** Contas do Flow conhecidas pela extensão (e-mail, créditos, pausa por cota…). */
  accounts?: FlowAccount[];
  /** A página está numa origem que a extensão não autorizou (adicione no popup da extensão). */
  originBlocked?: boolean;
}

export interface FlowAccount extends FlowContext {
  email?: string;
  credits?: number | null;
  /** A aba do Flow dessa conta está viva (bateu o coração há menos de 90 s). */
  online?: boolean;
  /** Pausada por cota (ms desde a época até quando; 0/ausente = sem pausa). */
  cooldownUntil?: number;
  /** Pausada pelo usuário no popup. */
  paused?: boolean;
  /** Ordens em andamento nessa conta. */
  pending?: number;
  /** Há uma geração incerta sendo conferida (a conta não recebe ordem nova até acabar). */
  uncertain?: boolean;
}

export interface SubmitInput {
  jobId: string;
  context: FlowContext;
  command: string;
  args: unknown;
}

/** Contrato do executor. Implementação real: extensão Chrome via window.postMessage (executor.ts). */
export interface FlowExecutor {
  status(): Promise<BridgeStatus>;
  accounts(): Promise<FlowAccount[]>;
  submit(input: SubmitInput): Promise<OperationRecord>;
  /** `key` = id da ordem devolvido por `submit`. */
  get(key: string): Promise<OperationRecord | null>;
  /** Só leitura: nunca repete o submit. */
  reconcile(key: string): Promise<OperationRecord | null>;
}

/**
 * Detalhe do executor nulo. Mesmo padrão `CODIGO; explicação` do original, mas SEM o texto de ERR_NO_RESPONSE
 * ("pedido preservado…"), que só faz sentido quando há um pedido em andamento — aqui nada foi pedido.
 */
export const NOT_READY_DETAIL = 'EXTENSAO_NAO_INSTALADA; instale a extensão do Zerum no Chrome (pasta zerum/extensao) para gerar de verdade; sem pedido pendente';

const EMPTY_CHECKLIST: BridgeChecklist = { extensionInstalled: false, extensionConnected: false, flowTabOpen: false, accountChosen: false };

export const notInstalledStatus = (): BridgeStatus => ({ ready: false, pending: 0, detail: NOT_READY_DETAIL, checklist: { ...EMPTY_CHECKLIST } });

export class NullFlowExecutor implements FlowExecutor {
  async status(): Promise<BridgeStatus> {
    return notInstalledStatus();
  }
  async accounts(): Promise<FlowAccount[]> {
    return [];
  }
  async submit(): Promise<OperationRecord> {
    throw new Error('EXECUTOR_INDISPONIVEL: a extensão do Zerum não está conectada; nenhum pedido foi enviado');
  }
  async get(): Promise<OperationRecord | null> {
    return null;
  }
  async reconcile(): Promise<OperationRecord | null> {
    return null;
  }
}

/** Uma conta da extensão → conta exibida na UI (o e-mail É o accountId do Flow). */
export function toFlowAccount(a: ExtensionStatus['accounts'][number]): FlowAccount {
  return {
    ...a.context,
    email: a.context.accountId,
    credits: a.credits,
    online: a.online,
    cooldownUntil: a.cooldownUntil || 0,
    paused: !!a.paused,
    pending: a.pending,
    uncertain: !!a.uncertain,
  };
}

/** A conta pode receber um vídeo novo AGORA? (online, sem pausa do usuário, sem pausa por cota, sem geração incerta) */
export const accountUsable = (a: FlowAccount, now = Date.now()): boolean => !!a.online && !a.paused && !a.uncertain && (a.cooldownUntil ?? 0) <= now;

/**
 * Resposta de `extensionStatus` → estado da UI.
 *  - `null` + `answeredBefore=false`: a extensão nunca respondeu → `EXTENSAO_NAO_INSTALADA` (como sempre);
 *  - `null` + `answeredBefore=true`: respondia e parou → o texto literal do original (`EXTENSAO_SEM_RESPOSTA; pedido preservado…`).
 */
export function statusFromExtension(raw: ExtensionStatus | null, opts: { answeredBefore?: boolean; originBlocked?: boolean; now?: number } = {}): BridgeStatus {
  const now = opts.now ?? Date.now();
  if (!raw) {
    if (opts.originBlocked) {
      return { ready: false, pending: 0, detail: 'ORIGEM_NAO_AUTORIZADA; a extensão está instalada, mas não aceita este endereço: abra o ícone dela e adicione-o em "Sites autorizados"', checklist: { ...EMPTY_CHECKLIST, extensionInstalled: true }, originBlocked: true };
    }
    if (opts.answeredBefore) return { ready: false, pending: 0, detail: ERR_NO_RESPONSE, checklist: { ...EMPTY_CHECKLIST, extensionInstalled: true } };
    return notInstalledStatus();
  }
  const accounts = raw.accounts.map(toFlowAccount);
  const usable = accounts.filter((a) => accountUsable(a, now));
  const flowTabOpen = raw.health?.state === 'healthy' || raw.health?.state === 'not-ready' || accounts.some((a) => a.online);
  const pending = accounts.reduce((n, a) => n + (a.pending ?? 0), 0);
  const ready = usable.length > 0;

  let detail: string;
  if (ready) {
    const best = [...usable].sort((a, b) => (b.credits ?? -1) - (a.credits ?? -1))[0];
    detail = `Flow ligado: ${best.email}${best.credits != null ? ` · ${best.credits} créditos` : ''}${usable.length > 1 ? ` (+${usable.length - 1} conta${usable.length === 2 ? '' : 's'})` : ''}`;
  } else if (accounts.some((a) => a.online && (a.cooldownUntil ?? 0) > now)) {
    const until = Math.max(...accounts.filter((a) => (a.cooldownUntil ?? 0) > now).map((a) => a.cooldownUntil as number));
    detail = `COTA_PAUSADA; a conta do Flow atingiu o limite e fica em pausa até ${untilLabel(until, now)} (o Zerum não troca de conta sozinho para furar a cota)`;
  } else if (accounts.some((a) => a.online && a.paused)) {
    detail = 'CONTA_PAUSADA; você pausou a conta no ícone da extensão — retome lá para gerar';
  } else if (accounts.some((a) => a.online && a.uncertain)) {
    detail = 'CONFERINDO_GERACAO; uma geração ficou incerta e está sendo conferida (nada novo é gerado nesta conta até acabar)';
  } else {
    detail = raw.health?.detail ?? 'FLOW_FECHADO; abra o Flow pelo ícone da extensão, entre na sua conta e abra um projeto';
  }

  return {
    ready,
    pending,
    detail,
    checklist: { extensionInstalled: true, extensionConnected: true, flowTabOpen, accountChosen: usable.length > 0 },
    version: raw.version,
    accounts,
  };
}

/**
 * "contas" = a build do original com o painel "Contas Flow · candidata" (a pílula vira "○ Contas Flow");
 * "reconectar" = pílula clássica. O padrão do clone é "reconectar" (texto pedido pelo dono).
 */
export type PillMode = 'reconectar' | 'contas';

export function pillLabel(s: Pick<BridgeStatus, 'ready' | 'pending'>, mode: PillMode): string {
  if (s.ready) return `● Flow ligado${s.pending ? ` · ${s.pending} em andamento` : ''}`;
  return mode === 'contas' ? '○ Contas Flow' : '○ sem Flow · clique pra reconectar';
}
