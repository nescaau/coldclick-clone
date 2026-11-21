/**
 * Executor de trabalhos (fase 1: SIMULADO) — a máquina de estados da fila.
 *
 *   pending ──start──▶ running (ready_at = agora + latência simulada) ──resolve──▶ done
 *                                                                              └─▶ pending (nova tentativa)
 *                                                                              └─▶ failed  (limite atingido)
 *
 * - Um trabalho por vez, em ordem de criação, com até CONCURRENCY itens simultâneos.
 * - Cada variação tem uma imagem-base e um vídeo; o vídeo só inicia quando a imagem está pronta.
 * - Falhas são simuladas (COLDCLICK_SIM_FAILURE_RATE) para exercitar a UI de falhas/parcial.
 * - Cada item tem até MAX_ATTEMPTS_PER_ITEM tentativas, limitadas pelo teto de gerações do trabalho
 *   (a "folga" da estimativa). Esgotado o teto, os itens restantes falham.
 * - O estado `running` fica no banco (ready_at): reiniciar o servidor retoma de onde parou.
 *
 * Fase 2: `startItems` passa a pedir uma conta ao account-service (`acquireAccount`) e a delegar a
 * geração real à extensão; `resolveDueItems` passa a receber o resultado dela.
 */
import { transaction } from '../db';
import { MAX_ATTEMPTS_PER_ITEM } from '../estimate';
import { addJobEvent } from '../repo/job-events';
import { renderPlaceholderSvg } from '../placeholders';
import {
  countOpenItems,
  countRunningItems,
  findOldestQueuedJob,
  findRunningJob,
  finishJob,
  getGenerationBudget,
  getImageItemStatus,
  getOutcomeCounts,
  incrementFailedAttempts,
  interruptPendingItems,
  listDueRunningItems,
  listPendingItems,
  markItemDone,
  markItemFailed,
  markItemInterrupted,
  markItemPending,
  markJobRunning,
  startItemAttempt,
  type ActiveJobRow,
} from '../repo/job-items';
import { saveTextSync } from '../storage';
import type { ItemKind } from '../types';

const CONCURRENCY = 3;
const speed = () => Number(process.env.COLDCLICK_SIM_SPEED ?? 1) || 1;
const failureRate = () => {
  const raw = Number(process.env.COLDCLICK_SIM_FAILURE_RATE ?? 0.1);
  return Number.isFinite(raw) ? Math.min(1, Math.max(0, raw)) : 0.1;
};

export const simulatedFailureRate = failureRate;
export const runnerConcurrency = CONCURRENCY;

/** Latência simulada: imagens são mais rápidas que vídeos. */
const simulatedLatencyMs = (kind: ItemKind) =>
  (kind === 'image' ? 2000 + Math.random() * 2000 : 5000 + Math.random() * 4000) * speed();

/** A variação N usa o avatar (N-1) mod total; sem avatares ("Pessoa original") usa o nome do trabalho. */
function avatarNameFor(avatarsJson: string, variation: number, fallback: string): string {
  try {
    const avatars = JSON.parse(avatarsJson) as Array<{ name: string }>;
    return avatars.length ? avatars[(variation - 1) % avatars.length].name : fallback;
  } catch {
    return fallback;
  }
}

/** Conclui os itens "em andamento" cujo tempo simulado já passou. */
function resolveDueItems(now: number): void {
  for (const item of listDueRunningItems(now)) {
    transaction(() => {
      if (Math.random() >= failureRate()) {
        const rel = `outputs/${item.job_id}/${item.kind}-${String(item.variation).padStart(3, '0')}-t${item.attempts}.svg`;
        saveTextSync(
          rel,
          renderPlaceholderSvg({
            kind: item.kind,
            variation: item.variation,
            format: item.format,
            avatarName: avatarNameFor(item.avatars_json, item.variation, item.avatar_name),
            model: item.model,
            resolution: item.resolution,
          }),
        );
        markItemDone(item.id, rel);
        return;
      }

      incrementFailedAttempts(item.job_id);
      const canRetry = item.attempts < MAX_ATTEMPTS_PER_ITEM && item.generations_used < item.max_generations;
      if (canRetry) markItemPending(item.id);
      else if (item.attempts >= MAX_ATTEMPTS_PER_ITEM) markItemFailed(item.id, `Falha simulada após ${item.attempts} tentativas`, 'running');
      else markItemInterrupted(item.id, 'running'); // teto esgotado: interrupção, não falha do item
    });
  }
}

/** Trabalho a processar: o que já está em andamento ou, senão, o mais antigo da fila. */
function activateJob(): ActiveJobRow | null {
  return transaction(() => {
    const running = findRunningJob();
    if (running) return running;
    const queued = findOldestQueuedJob();
    if (queued) {
      markJobRunning(queued.id);
      addJobEvent(queued.id, 'Geração iniciada');
    }
    return queued;
  });
}

/** Inicia itens pendentes até preencher a concorrência, respeitando a dependência imagem → vídeo. */
function startItems(jobId: string, now: number): void {
  let slots = CONCURRENCY - countRunningItems(jobId);
  if (slots <= 0) return;

  for (const item of listPendingItems(jobId)) {
    if (slots <= 0) break;

    if (item.kind === 'video') {
      const image = getImageItemStatus(jobId, item.variation);
      if (image === 'failed') {
        markItemFailed(item.id, 'Imagem-base indisponível', 'pending');
        continue;
      }
      if (image === 'cancelled') {
        markItemInterrupted(item.id, 'pending'); // imagem-base interrompida pelo teto → o vídeo também
        continue;
      }
      if (image !== 'done') continue; // aguarda a imagem-base
    }

    const budget = getGenerationBudget(jobId);
    if (budget.used >= budget.max) {
      // Créditos/cota esgotados: o lote é INTERROMPIDO (não vira uma pilha de falhas).
      if (interruptPendingItems(jobId) > 0) addJobEvent(jobId, 'Geração interrompida: teto de gerações atingido', 'failed');
      return;
    }

    startItemAttempt(item.id, jobId, Math.round(now + simulatedLatencyMs(item.kind)));
    slots--;
  }
}

/** Se não sobrou nada a fazer, fecha o trabalho com o status final adequado. */
function finalizeIfIdle(jobId: string): void {
  if (countOpenItems(jobId) > 0) return;
  const c = getOutcomeCounts(jobId);
  // Interrompido por cota/créditos → "parcial" mesmo com 0 vídeos e 0 falhas (estado visto na referência).
  const status = c.itemsDone === c.itemsTotal ? 'completed' : c.interrupted > 0 || c.videosDone > 0 ? 'partial' : 'failed';
  finishJob(
    jobId,
    status,
    status === 'failed' ? 'Nenhum vídeo pôde ser gerado' : c.interrupted > 0 ? 'Geração interrompida: teto de gerações do trabalho atingido' : null,
  );
  addJobEvent(
    jobId,
    status === 'completed' ? 'Geração concluída' : status === 'partial' ? 'Geração finalizada parcialmente' : 'Geração falhou',
    status === 'failed' ? 'failed' : 'done',
  );
}

/** Um ciclo do executor. Chamado pelo loop (worker.ts) e por POST /api/worker. */
export function runTick(now: number = Date.now()): void {
  resolveDueItems(now);
  const job = activateJob();
  if (job) {
    startItems(job.id, now);
    finalizeIfIdle(job.id);
  }
}
