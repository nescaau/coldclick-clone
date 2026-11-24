/**
 * Escolha da conta do Flow para o PRÓXIMO clipe (regras puras, testadas).
 *
 *  - "Troca automática de conta" desligada: usa a conta escolhida pelo usuário (ou a única/melhor se ele não escolheu);
 *  - ligada: segue na conta atual enquanto ela tiver `minCredits` ou mais; abaixo disso troca para a conta com mais saldo;
 *    se nenhuma tem o mínimo, PAUSA (texto literal do original: "Troca automática pausada: … nenhuma outra conta tem N créditos");
 *  - NUNCA usa conta offline, pausada pelo usuário, com geração incerta ou em pausa por cota — e a troca automática jamais
 *    serve para "furar" a cota: uma conta em pausa de 24 h simplesmente não é candidata.
 */
import { accountUsable, type FlowAccount } from './status';

export interface PickInput {
  accounts: readonly FlowAccount[];
  /** A conta que o usuário escolheu em "Contas Flow" (e-mail). */
  selected?: string | null;
  /** A conta usada no clipe anterior (a troca só acontece quando ela deixa de servir). */
  current?: string | null;
  autoSwitch: boolean;
  minCredits: number;
  now?: number;
}

export interface Pick {
  account: FlowAccount | null;
  /** Por que não há conta (vazio quando há). Mostrado em "Contas Flow" e no log. */
  reason: string;
}

const byCredits = (a: FlowAccount, b: FlowAccount) => (b.credits ?? -1) - (a.credits ?? -1) || String(a.email).localeCompare(String(b.email));
const same = (a: FlowAccount, id: string | null | undefined) => !!id && a.accountId.toLowerCase() === id.toLowerCase();

export function pickAccount(i: PickInput): Pick {
  const now = i.now ?? Date.now();
  const usable = i.accounts.filter((a) => accountUsable(a, now));
  if (usable.length === 0) {
    const online = i.accounts.filter((a) => a.online);
    if (online.some((a) => (a.cooldownUntil ?? 0) > now)) return { account: null, reason: 'COTA_PAUSADA; todas as contas do Flow estão em pausa por cota' };
    if (online.some((a) => a.paused)) return { account: null, reason: 'CONTA_PAUSADA; a conta está pausada no ícone da extensão' };
    if (online.some((a) => a.uncertain)) return { account: null, reason: 'CONFERINDO_GERACAO; aguardando a conferência de uma geração incerta' };
    return { account: null, reason: 'SEM_CONTA_PRONTA; abra o Flow num projeto, na sua conta' };
  }

  if (!i.autoSwitch) {
    const chosen = i.selected ? usable.find((a) => same(a, i.selected)) : undefined;
    if (i.selected && !chosen) return { account: null, reason: `CONTA_ESCOLHIDA_INDISPONIVEL; ${i.selected} não está pronta (aba fechada, em pausa ou com geração incerta)` };
    const account = chosen ?? [...usable].sort(byCredits)[0];
    if (account.credits === 0) return { account: null, reason: `SEM_CREDITOS; ${account.email} está com 0 créditos` };
    return { account, reason: '' };
  }

  const min = Math.max(0, Math.floor(i.minCredits));
  const funded = usable.filter((a) => a.credits == null || a.credits >= min); // saldo desconhecido não bloqueia
  if (funded.length === 0) return { account: null, reason: `Troca automática pausada: nenhuma conta tem ${min} créditos` };
  const sticky = funded.find((a) => same(a, i.current)) ?? funded.find((a) => same(a, i.selected));
  return { account: sticky ?? [...funded].sort(byCredits)[0], reason: '' };
}

/** Texto curto da conta para listas/selects. */
export function accountLabel(a: FlowAccount, now = Date.now()): string {
  const saldo = a.credits == null ? 'saldo desconhecido' : `${a.credits} créditos`;
  if ((a.cooldownUntil ?? 0) > now) return `${a.email} · em pausa por cota até ${new Date(a.cooldownUntil as number).toLocaleTimeString('pt-BR', { hour: '2-digit', minute: '2-digit' })}`;
  if (a.paused) return `${a.email} · pausada por você`;
  if (!a.online) return `${a.email} · aba do Flow fechada`;
  return `${a.email} · ${saldo}`;
}
