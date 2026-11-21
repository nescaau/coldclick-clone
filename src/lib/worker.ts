/**
 * Loop do worker em background: dispara `runTick()` (services/job-runner.ts) a cada segundo,
 * dentro do próprio processo do Next. Só controla o ciclo de vida do timer — as regras estão no executor.
 */
import { nowIso } from './db';
import { runnerConcurrency, runTick, simulatedFailureRate } from './services/job-runner';

const TICK_MS = 1000;

interface WorkerState {
  timer: NodeJS.Timeout | null;
  ticks: number;
  lastTickAt: string | null;
  lastError: string | null;
}

declare global {
  // eslint-disable-next-line no-var
  var __coldclickWorker: WorkerState | undefined;
}

// Em globalThis para sobreviver ao hot-reload do `next dev` (senão haveria vários loops).
const state: WorkerState = (globalThis.__coldclickWorker ??= { timer: null, ticks: 0, lastTickAt: null, lastError: null });

function safeTick(): void {
  state.ticks++;
  state.lastTickAt = nowIso();
  try {
    runTick();
    state.lastError = null;
  } catch (e) {
    state.lastError = e instanceof Error ? e.message : String(e);
    console.error('[worker]', e);
  }
}

/** Inicia o loop (idempotente). */
export function startWorker(): void {
  if (state.timer) return;
  state.timer = setInterval(safeTick, TICK_MS);
  state.timer.unref(); // não impede o processo de encerrar
}

export function stopWorker(): void {
  if (state.timer) clearInterval(state.timer);
  state.timer = null;
}

/** Executa um ciclo agora (depuração), registrando-o nas estatísticas. */
export function tickNow(): void {
  safeTick();
}

export function getWorkerStatus() {
  return {
    running: state.timer !== null,
    ticks: state.ticks,
    lastTickAt: state.lastTickAt,
    lastError: state.lastError,
    tickIntervalMs: TICK_MS,
    concurrency: runnerConcurrency,
    simulatedFailureRate: simulatedFailureRate(),
  };
}
