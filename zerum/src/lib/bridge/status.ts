/**
 * Estado da ponte exibido na UI (pílula, banner, modal "CONECTAR O FLOW") e a interface do executor.
 *
 * NESTA FASE só existe o `NullFlowExecutor`: sempre desligado, sem falar com extensão nem rede.
 * A fase futura troca a implementação por uma que usa o protocolo de protocol.ts, sem mexer na UI.
 */
import { ERR_NO_RESPONSE, type FlowContext } from './protocol';
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
}

export interface FlowAccount extends FlowContext {
  email?: string;
  credits?: number;
}

export interface SubmitInput {
  jobId: string;
  context: FlowContext;
  command: string;
  args: unknown;
}

/** Contrato do executor (fase futura). Implementação real: extensão Chrome via window.postMessage. */
export interface FlowExecutor {
  status(): Promise<BridgeStatus>;
  accounts(): Promise<FlowAccount[]>;
  submit(input: SubmitInput): Promise<OperationRecord>;
  get(key: string): Promise<OperationRecord | null>;
  /** Só leitura: nunca repete o submit. */
  reconcile(key: string): Promise<OperationRecord | null>;
}

export const NOT_READY_DETAIL = ERR_NO_RESPONSE;

export class NullFlowExecutor implements FlowExecutor {
  async status(): Promise<BridgeStatus> {
    return {
      ready: false,
      pending: 0,
      detail: NOT_READY_DETAIL,
      checklist: { extensionInstalled: false, extensionConnected: false, flowTabOpen: false, accountChosen: false },
    };
  }
  async accounts(): Promise<FlowAccount[]> {
    return [];
  }
  async submit(): Promise<OperationRecord> {
    throw new Error('EXECUTOR_INDISPONIVEL: a geração real é fase futura (extensão); nenhum pedido foi enviado');
  }
  async get(): Promise<OperationRecord | null> {
    return null;
  }
  async reconcile(): Promise<OperationRecord | null> {
    return null;
  }
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
