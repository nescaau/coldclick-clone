/**
 * Contas Google (Flow): cadastro, ordem de prioridade e rotação.
 * As DECISÕES da rotação vêm de lib/rotation.ts (puro); aqui orquestramos leitura, decisão e gravação
 * dentro de transações para que reservas simultâneas nunca estourem a cota de uma conta.
 */
import { randomUUID } from 'node:crypto';
import { transaction } from '../db';
import { AppError, conflict, notFound } from '../errors';
import {
  deleteAccountRow,
  findAccountRow,
  getRotationStateRow,
  insertAccountRow,
  listAccountRows,
  recordAccountUsage,
  resetCycle,
  swapAccountPositions,
  updateAccountRow,
  type AccountRow,
} from '../repo/accounts';
import {
  accountAvailability,
  eligibleAccounts,
  pickAccount,
  planRotation,
  shouldAdvanceCycle,
  type GenKind,
  type RotationAccount,
  type RotationPlan,
} from '../rotation';
import type { AccountsOverviewDTO, GoogleAccountDTO, RotationStateDTO } from '../types';
import { listBrowsers } from './extension-service';

const toRotation = (r: AccountRow): RotationAccount => ({
  id: r.id,
  email: r.email,
  position: r.position,
  credits: r.credits,
  enabled: r.enabled === 1,
  cycleVideos: r.cycle_videos,
  cycleImages: r.cycle_images,
});

const displayName = (r: AccountRow) => r.label?.trim() || r.email.split('@')[0];

function toDTO(r: AccountRow, priority: number, sessionEmails: Set<string>): GoogleAccountDTO {
  // Créditos reservados por gerações em andamento: a fase 2 passa a calculá-los a partir dos itens ativos.
  const reservedCredits = 0;
  return {
    id: r.id,
    email: r.email,
    name: displayName(r),
    credits: r.credits,
    reservedCredits,
    availableCredits: Math.max(0, r.credits - reservedCredits),
    enabled: r.enabled === 1,
    priority,
    cycleVideos: r.cycle_videos,
    cycleImages: r.cycle_images,
    totalVideos: r.total_videos,
    totalImages: r.total_images,
    lastUsedAt: r.last_used_at,
    creditsUpdatedAt: r.credits_updated_at,
    availability: accountAvailability(toRotation(r)),
    sessionActive: sessionEmails.has(r.email),
  };
}

export function getRotationState(): RotationStateDTO {
  const r = getRotationStateRow();
  return { cycle: r.cycle, cycleStartedAt: r.cycle_started_at };
}

export function getAccountsOverview(): AccountsOverviewDTO {
  const rows = listAccountRows();
  // E-mails com sessão do Flow aberta em algum Chrome online (reportado pela extensão).
  const sessionEmails = new Set(
    listBrowsers()
      .filter((b) => b.online && b.flowSessionActive && b.flowAccountEmail)
      .map((b) => b.flowAccountEmail!.toLowerCase()),
  );
  const accounts = rows.map((r, i) => toDTO(r, i + 1, sessionEmails));
  return {
    accounts,
    total: accounts.length,
    eligible: eligibleAccounts(rows.map(toRotation)).length,
    openSessions: accounts.filter((a) => a.sessionActive).length,
    rotation: getRotationState(),
  };
}

/** Quantidade de contas elegíveis para a rotação agora (usada na confirmação do trabalho). */
export const countEligibleAccounts = (): number => eligibleAccounts(listAccountRows().map(toRotation)).length;

export function addAccount(input: { email: string; label?: string; credits: number }): void {
  const email = input.email.trim().toLowerCase();
  if (listAccountRows().some((a) => a.email === email)) throw conflict('Esta conta já está cadastrada');
  insertAccountRow({ id: randomUUID(), email, label: input.label?.trim() || null, credits: input.credits });
}

export function updateAccount(
  id: string,
  patch: { label?: string | null; credits?: number; enabled?: boolean; move?: 'up' | 'down' },
): void {
  transaction(() => {
    const current = findAccountRow(id);
    if (!current) throw notFound('Conta');
    updateAccountRow(id, {
      label: patch.label === undefined ? undefined : patch.label?.trim() || null,
      credits: patch.credits,
      enabled: patch.enabled,
    });
    if (patch.move) {
      const rows = listAccountRows();
      const index = rows.findIndex((r) => r.id === id);
      const neighbor = rows[patch.move === 'up' ? index - 1 : index + 1];
      if (neighbor) swapAccountPositions(rows[index], neighbor);
    }
  });
}

export function removeAccount(id: string): void {
  if (!deleteAccountRow(id)) throw notFound('Conta');
}

/** Zera os contadores do ciclo e inicia o próximo. */
export function advanceCycle(): RotationStateDTO {
  transaction(resetCycle);
  return getRotationState();
}

export type AcquireResult =
  | { ok: true; account: GoogleAccountDTO; cycle: number }
  | { ok: false; reason: 'no_accounts' | 'cycle_exhausted' };

/**
 * Reserva uma conta para uma geração (incrementa os contadores do ciclo atomicamente).
 * Se `autoAdvance` e só faltar cota (há contas aptas), inicia um novo ciclo e tenta de novo.
 * O orquestrador da fase 2 chama isto antes de cada geração enviada à extensão.
 */
export function acquireAccount(kind: GenKind, opts: { autoAdvance?: boolean } = {}): AcquireResult {
  return transaction((): AcquireResult => {
    let rows = listAccountRows();
    let picked = pickAccount(rows.map(toRotation), kind);

    if (!picked && opts.autoAdvance && shouldAdvanceCycle(rows.map(toRotation), kind)) {
      resetCycle();
      rows = listAccountRows();
      picked = pickAccount(rows.map(toRotation), kind);
    }
    if (!picked) {
      return { ok: false, reason: shouldAdvanceCycle(rows.map(toRotation), kind) ? 'cycle_exhausted' : 'no_accounts' };
    }

    recordAccountUsage(picked.id, kind);
    const updated = listAccountRows();
    const index = updated.findIndex((r) => r.id === picked!.id);
    return { ok: true, account: toDTO(updated[index], index + 1, new Set()), cycle: getRotationState().cycle };
  });
}

/** Dry-run: mostra como `count` gerações seriam distribuídas, sem gravar nada. */
export function previewRotation(kind: GenKind, count: number): RotationPlan {
  if (count < 1) throw new AppError(400, 'Informe uma quantidade maior que zero');
  return planRotation(listAccountRows().map(toRotation), kind, count, getRotationState().cycle);
}
