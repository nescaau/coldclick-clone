/**
 * Lógica PURA de rotação de contas Google (Flow) e chaves Gemini.
 *
 * Nenhuma função aqui toca no banco: recebem um "retrato" do estado e devolvem a decisão.
 * Os serviços (services/account-service, services/gemini-key-service) chamam estas funções
 * dentro de transações, e a extensão (fase 2) reutiliza exatamente a mesma decisão.
 *
 * Regras de negócio (plataforma original):
 *  - A ORDEM (prioridade) define qual conta é usada primeiro; a troca é automática.
 *  - Conta só é usada com no MÍNIMO 40 créditos e se estiver ativa na rotação.
 *  - No máximo 2 vídeos e 2 imagens por conta em cada CICLO; esgotadas as cotas das contas aptas,
 *    um novo ciclo começa (contadores zerados) — desde que ainda existam contas com créditos.
 *  - Chaves Gemini: começam sempre pela primeira; só avançam para a próxima após uma rejeição
 *    confirmada. A próxima geração recomeça pela primeira.
 */
import type { AccountAvailability } from './types';

export const ROTATION_RULES = {
  minCredits: 40,
  maxVideosPerCycle: 2,
  maxImagesPerCycle: 2,
} as const;

export type GenKind = 'video' | 'image';

export interface RotationAccount {
  id: string;
  email: string;
  /** Ordem de prioridade (menor = usada primeiro). */
  position: number;
  credits: number;
  /** "Usar na rotação". */
  enabled: boolean;
  cycleVideos: number;
  cycleImages: number;
}

const cycleCount = (a: RotationAccount, kind: GenKind) => (kind === 'video' ? a.cycleVideos : a.cycleImages);
const cycleLimit = (kind: GenKind) =>
  kind === 'video' ? ROTATION_RULES.maxVideosPerCycle : ROTATION_RULES.maxImagesPerCycle;

/** Situação da conta no ciclo atual (independente do tipo de geração). */
export function accountAvailability(a: RotationAccount): AccountAvailability {
  if (!a.enabled) return 'disabled';
  if (a.credits < ROTATION_RULES.minCredits) return 'low_credits';
  const videosLeft = a.cycleVideos < ROTATION_RULES.maxVideosPerCycle;
  const imagesLeft = a.cycleImages < ROTATION_RULES.maxImagesPerCycle;
  return videosLeft || imagesLeft ? 'available' : 'cycle_exhausted';
}

/** A conta pode atender uma geração deste tipo agora? */
export function canServe(a: RotationAccount, kind: GenKind): boolean {
  return a.enabled && a.credits >= ROTATION_RULES.minCredits && cycleCount(a, kind) < cycleLimit(kind);
}

const byPosition = (a: RotationAccount, b: RotationAccount) => a.position - b.position || a.id.localeCompare(b.id);

/**
 * Escolhe a próxima conta: a PRIMEIRA, na ordem de prioridade, que ainda pode atender este tipo.
 * Quando ela esgota a cota do ciclo, a seguinte assume (troca automática).
 */
export function pickAccount(accounts: RotationAccount[], kind: GenKind): RotationAccount | null {
  return accounts.filter((a) => canServe(a, kind)).sort(byPosition)[0] ?? null;
}

/**
 * Há contas aptas (ativas e com créditos) que só estão sem cota neste ciclo?
 * Se sim, vale a pena iniciar um novo ciclo; se não, falta conta/crédito de fato.
 */
export function shouldAdvanceCycle(accounts: RotationAccount[], kind: GenKind): boolean {
  const funded = accounts.filter((a) => a.enabled && a.credits >= ROTATION_RULES.minCredits);
  return funded.length > 0 && !funded.some((a) => canServe(a, kind));
}

/** Contas elegíveis para a rotação (ativas e com saldo mínimo). */
export const eligibleAccounts = <T extends RotationAccount>(accounts: T[]): T[] =>
  accounts.filter((a) => a.enabled && a.credits >= ROTATION_RULES.minCredits);

/** Capacidade total de gerações por ciclo com as contas atualmente aptas. */
export function cycleCapacity(accounts: RotationAccount[]): { videos: number; images: number; accounts: number } {
  const funded = eligibleAccounts(accounts);
  return {
    accounts: funded.length,
    videos: funded.length * ROTATION_RULES.maxVideosPerCycle,
    images: funded.length * ROTATION_RULES.maxImagesPerCycle,
  };
}

export interface RotationStep {
  index: number;
  cycle: number;
  accountId: string;
  email: string;
}

export interface RotationPlan {
  steps: RotationStep[];
  /** Quantas gerações não puderam ser atendidas (sem contas aptas). */
  shortfall: number;
  /** Ciclos adicionais iniciados durante a simulação. */
  cyclesAdvanced: number;
  finalCycle: number;
}

/**
 * Simulação (dry-run) de `count` gerações do mesmo tipo, sem persistir nada.
 * Útil para conferir a distribuição antes de disparar um trabalho.
 */
export function planRotation(
  accounts: RotationAccount[],
  kind: GenKind,
  count: number,
  startCycle = 1,
): RotationPlan {
  // Cópia: a simulação não pode alterar o estado real.
  const sim = accounts.map((a) => ({ ...a }));
  const steps: RotationStep[] = [];
  let cycle = startCycle;
  let cyclesAdvanced = 0;

  for (let i = 0; i < count; i++) {
    let acc = pickAccount(sim, kind);
    if (!acc && shouldAdvanceCycle(sim, kind)) {
      for (const a of sim) {
        a.cycleVideos = 0;
        a.cycleImages = 0;
      }
      cycle++;
      cyclesAdvanced++;
      acc = pickAccount(sim, kind);
    }
    if (!acc) return { steps, shortfall: count - i, cyclesAdvanced, finalCycle: cycle };

    if (kind === 'video') acc.cycleVideos++;
    else acc.cycleImages++;
    steps.push({ index: i + 1, cycle, accountId: acc.id, email: acc.email });
  }
  return { steps, shortfall: 0, cyclesAdvanced, finalCycle: cycle };
}

/* ------------------------------------------------------------------ */
/* Chaves Gemini                                                       */
/* ------------------------------------------------------------------ */

export interface RotationKey {
  id: string;
  /** Ordem de tentativa (menor = primeira). */
  position: number;
}

/**
 * Próxima chave a tentar: a primeira da ordem, ignorando as já rejeitadas NESTA geração
 * (`rejectedIds`). Uma geração nova começa com `rejectedIds` vazio, ou seja, pela primeira chave.
 */
export function pickKey<T extends RotationKey>(keys: T[], rejectedIds: readonly string[] = []): T | null {
  return (
    keys
      .filter((k) => !rejectedIds.includes(k.id))
      .sort((a, b) => a.position - b.position || a.id.localeCompare(b.id))[0] ?? null
  );
}

/**
 * Falhas que PERMITEM tentar a próxima chave: autenticação, quota/limite e validação.
 * Timeout/erro de rede (status 0/5xx sem confirmação) NÃO trocam de chave — evita cobrança duplicada.
 */
export function isDefinitiveKeyRejection(httpStatus: number): boolean {
  return httpStatus === 400 || httpStatus === 401 || httpStatus === 403 || httpStatus === 429;
}
