/**
 * Estado da ponte no SERVIDOR.
 *
 * Só o navegador fala com a extensão (window.postMessage). A página do Zerum consulta a extensão e INFORMA aqui o que viu
 * (`reportHeartbeat`, a cada ~5 s); o servidor guarda esse retrato por 15 s. Disso saem três decisões:
 *
 *  1. o status mostrado na UI (`getBridgeStatus`): sem retrato fresco = sem extensão = `EXTENSAO_NAO_INSTALADA` (como antes);
 *  2. o MODO de execução (`executionMode`):
 *       'simulado' → ⚙ "Simulação local" ligada: o relógio avança as cenas (selo SIMULADO), a extensão não é usada;
 *       'real'     → simulação desligada E extensão pronta: os lotes são executados pelo Flow, pela ponte;
 *       'espera'   → simulação desligada e sem extensão: os lotes ficam na fila, nada avança (comportamento de sempre);
 *  3. quem é a aba "líder": só UMA aba do Zerum executa de cada vez (duas abas a pedir geração gastariam crédito em dobro).
 *
 * Nada aqui fala com extensão nem com rede.
 */
import type { z } from 'zod';
import type { BridgeHeartbeatSchema } from '../schemas';
import { APP_LOG_REF, logEvent } from '../repo/events';
import { notInstalledStatus, NullFlowExecutor, type BridgeStatus, type FlowExecutor } from '../bridge/status';
import type { ExecutionMode } from '../bridge/work';
import { isSimulation } from './settings-service';

export type { ExecutionMode };

/** Quanto tempo vale o último retrato da extensão informado pela página. */
export const SNAPSHOT_TTL_MS = 15_000;
/** Quanto tempo uma aba continua "líder" sem bater o coração. */
export const LEADER_TTL_MS = 20_000;

interface Mirror {
  snapshot: { at: number; pumpId: string; status: BridgeStatus } | null;
  leader: { pumpId: string; until: number } | null;
}
declare global {
  // eslint-disable-next-line no-var
  var __zerumBridge: Mirror | undefined;
}
const mirror = (): Mirror => (globalThis.__zerumBridge ??= { snapshot: null, leader: null });

let override: FlowExecutor | null = null;
const fallback = new NullFlowExecutor();

/** Ponto de injeção de testes (e de qualquer executor que o servidor possa alcançar). */
export const setExecutor = (e: FlowExecutor | null): void => {
  override = e;
};

/** Zera o retrato e a liderança (testes). */
export const resetBridge = (): void => {
  globalThis.__zerumBridge = undefined;
};

export type Heartbeat = z.infer<typeof BridgeHeartbeatSchema>;

/**
 * A página informa o estado da extensão. Devolve se esta aba é a líder (a única que pode pedir geração) e o modo atual.
 * Registra no log quando a extensão aparece/some ou o Flow fica pronto/indisponível (sem repetir a cada batida).
 */
export function reportHeartbeat(input: Heartbeat, now = Date.now()): { leader: boolean; mode: ExecutionMode; status: BridgeStatus } {
  const m = mirror();
  const before = m.snapshot && now - m.snapshot.at < SNAPSHOT_TTL_MS ? m.snapshot.status : null;
  const status = input.status as BridgeStatus;
  m.snapshot = { at: now, pumpId: input.pumpId, status };

  if (!before && status.checklist.extensionInstalled) logEvent('app', APP_LOG_REF, `Extensão do Flow conectada${status.version ? ` (v${status.version})` : ''}: ${status.detail}`);
  else if (before && before.ready !== status.ready) logEvent('app', APP_LOG_REF, status.ready ? `Flow pronto: ${status.detail}` : `Flow indisponível: ${status.detail}`, status.ready ? 'info' : 'aviso');

  const free = !m.leader || m.leader.until <= now || m.leader.pumpId === input.pumpId;
  if (free) m.leader = { pumpId: input.pumpId, until: now + LEADER_TTL_MS };
  return { leader: m.leader!.pumpId === input.pumpId, mode: executionMode(now), status };
}

export const isLeader = (pumpId: string, now = Date.now()): boolean => {
  const l = mirror().leader;
  return !!l && l.pumpId === pumpId && l.until > now;
};

/** Há um retrato fresco da extensão? */
export const bridgeFresh = (now = Date.now()): boolean => {
  const s = mirror().snapshot;
  return !!s && now - s.at < SNAPSHOT_TTL_MS;
};

/** O que fazer com os lotes agora (ver o cabeçalho). */
export function executionMode(now = Date.now()): ExecutionMode {
  if (isSimulation()) return 'simulado';
  const s = mirror().snapshot;
  return s && now - s.at < SNAPSHOT_TTL_MS && s.status.ready ? 'real' : 'espera';
}

/** Estado exibido: o executor injetado (testes), senão o retrato fresco da extensão, senão "sem extensão". */
export async function getBridgeStatus(now = Date.now()): Promise<BridgeStatus> {
  if (override) return override.status();
  const s = mirror().snapshot;
  if (s && now - s.at < SNAPSHOT_TTL_MS) return s.status;
  return s?.status.checklist.extensionInstalled ? { ...notInstalledStatus(), detail: s.status.detail, checklist: { ...s.status.checklist, extensionConnected: false, flowTabOpen: false, accountChosen: false } } : fallback.status();
}

export const getBridgeAccounts = () => (override ?? fallback).accounts();
