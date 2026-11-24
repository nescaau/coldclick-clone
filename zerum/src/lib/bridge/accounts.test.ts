/** Escolha da conta do Flow e mapeamento do estado da extensão para a UI. */
import { describe, expect, it } from 'vitest';
import { accountLabel, pickAccount } from './accounts';
import type { ExtensionStatus } from './protocol';
import { ERR_NO_RESPONSE } from './protocol';
import { NOT_READY_DETAIL, accountUsable, statusFromExtension, type FlowAccount } from './status';

const NOW = 1_700_000_000_000;
const P = '11111111-1111-4111-8111-111111111111';
const acc = (email: string, o: Partial<FlowAccount> = {}): FlowAccount => ({ accountId: email, email, projectId: P, accountPath: '', online: true, credits: 100, cooldownUntil: 0, paused: false, pending: 0, uncertain: false, ...o });
const pick = (accounts: FlowAccount[], o: Partial<Parameters<typeof pickAccount>[0]> = {}) => pickAccount({ accounts, autoSwitch: false, minCredits: 20, now: NOW, ...o });

describe('accountUsable', () => {
  it('online, sem pausa do usuário, sem pausa por cota e sem geração incerta', () => {
    expect(accountUsable(acc('a@x.com'), NOW)).toBe(true);
    expect(accountUsable(acc('a@x.com', { online: false }), NOW)).toBe(false);
    expect(accountUsable(acc('a@x.com', { paused: true }), NOW)).toBe(false);
    expect(accountUsable(acc('a@x.com', { uncertain: true }), NOW)).toBe(false);
    expect(accountUsable(acc('a@x.com', { cooldownUntil: NOW + 1 }), NOW)).toBe(false);
    expect(accountUsable(acc('a@x.com', { cooldownUntil: NOW }), NOW)).toBe(true); // a pausa acabou
  });
});

describe('pickAccount — troca automática desligada', () => {
  it('usa a escolhida; sem escolha, a com mais créditos', () => {
    const a = acc('a@x.com', { credits: 10 });
    const b = acc('b@x.com', { credits: 300 });
    expect(pick([a, b], { selected: 'a@x.com' }).account?.email).toBe('a@x.com');
    expect(pick([a, b]).account?.email).toBe('b@x.com');
    expect(pick([a, b], { selected: 'B@X.com' }).account?.email).toBe('b@x.com'); // e-mail sem diferenciar caixa
  });

  it('a escolhida indisponível NÃO troca sozinha (CONTA_ESCOLHIDA_INDISPONIVEL)', () => {
    const r = pick([acc('a@x.com', { cooldownUntil: NOW + 1000 }), acc('b@x.com')], { selected: 'a@x.com' });
    expect(r.account).toBeNull();
    expect(r.reason).toMatch(/^CONTA_ESCOLHIDA_INDISPONIVEL/);
  });

  it('conta com 0 créditos não gera; saldo desconhecido (null) não bloqueia', () => {
    expect(pick([acc('a@x.com', { credits: 0 })]).reason).toMatch(/^SEM_CREDITOS/);
    expect(pick([acc('a@x.com', { credits: null })]).account?.email).toBe('a@x.com');
  });

  it('sem conta utilizável: o motivo é o mais útil (cota → pausa → incerta → sem conta)', () => {
    expect(pick([acc('a@x.com', { cooldownUntil: NOW + 5 })]).reason).toMatch(/^COTA_PAUSADA/);
    expect(pick([acc('a@x.com', { paused: true })]).reason).toMatch(/^CONTA_PAUSADA/);
    expect(pick([acc('a@x.com', { uncertain: true })]).reason).toMatch(/^CONFERINDO_GERACAO/);
    expect(pick([]).reason).toMatch(/^SEM_CONTA_PRONTA/);
    expect(pick([acc('a@x.com', { online: false })]).reason).toMatch(/^SEM_CONTA_PRONTA/);
  });
});

describe('pickAccount — troca automática ligada', () => {
  const auto = (accounts: FlowAccount[], o: Partial<Parameters<typeof pickAccount>[0]> = {}) => pick(accounts, { autoSwitch: true, ...o });

  it('fica na conta atual enquanto ela tiver o mínimo de créditos (sem trocar à toa)', () => {
    const a = acc('a@x.com', { credits: 25 });
    const b = acc('b@x.com', { credits: 900 });
    expect(auto([a, b], { current: 'a@x.com' }).account?.email).toBe('a@x.com');
  });

  it('abaixo do mínimo troca para a conta com mais créditos', () => {
    const a = acc('a@x.com', { credits: 19 });
    const b = acc('b@x.com', { credits: 50 });
    const c = acc('c@x.com', { credits: 400 });
    expect(auto([a, b, c], { current: 'a@x.com' }).account?.email).toBe('c@x.com');
  });

  it('nenhuma conta com o mínimo → pausa, com o texto do original ("Troca automática pausada … N créditos")', () => {
    const r = auto([acc('a@x.com', { credits: 5 }), acc('b@x.com', { credits: 7 })], { minCredits: 20 });
    expect(r.account).toBeNull();
    expect(r.reason).toBe('Troca automática pausada: nenhuma conta tem 20 créditos');
  });

  it('a troca automática NUNCA é um jeito de furar a cota: conta em pausa de 24 h não é candidata', () => {
    const a = acc('a@x.com', { credits: 999, cooldownUntil: NOW + 24 * 3600_000 });
    const b = acc('b@x.com', { credits: 30 });
    expect(auto([a, b]).account?.email).toBe('b@x.com');
    expect(auto([a]).account).toBeNull();
  });

  it('saldo desconhecido conta como "serve" (a extensão ainda não leu os créditos)', () => {
    expect(auto([acc('a@x.com', { credits: null })]).account?.email).toBe('a@x.com');
  });

  it('prefere a escolhida pelo usuário quando não há "atual" e ela serve', () => {
    expect(auto([acc('a@x.com', { credits: 50 }), acc('b@x.com', { credits: 500 })], { selected: 'a@x.com' }).account?.email).toBe('a@x.com');
  });
});

describe('accountLabel', () => {
  it('mostra créditos, pausa por cota (com a hora), pausa do usuário e aba fechada', () => {
    expect(accountLabel(acc('a@x.com', { credits: 42 }), NOW)).toBe('a@x.com · 42 créditos');
    expect(accountLabel(acc('a@x.com', { credits: null }), NOW)).toMatch(/saldo desconhecido/);
    expect(accountLabel(acc('a@x.com', { cooldownUntil: NOW + 3_600_000 }), NOW)).toMatch(/em pausa por cota até \d{2}:\d{2}/);
    expect(accountLabel(acc('a@x.com', { paused: true }), NOW)).toMatch(/pausada por você/);
    expect(accountLabel(acc('a@x.com', { online: false }), NOW)).toMatch(/aba do Flow fechada/);
  });
});

// ─── status vindo da extensão ──────────────────────────────────────────────────────────────────────────────────────
const raw = (o: Partial<ExtensionStatus> = {}): ExtensionStatus => ({
  installed: true,
  paired: true,
  version: '0.1.0',
  protocol: 'zerum-local-flow-v1',
  health: { state: 'healthy', detail: 'Flow ligado' },
  accounts: [{ context: { accountId: 'ana@gmail.com', projectId: P, accountPath: '' }, online: true, heartbeatAgeMs: 1000, presenceTtlMs: 90000, cooldownUntil: 0, credits: 80, creditsAt: NOW, pending: 2, paused: false, uncertain: false }],
  ...o,
});

describe('statusFromExtension', () => {
  it('sem resposta e nunca respondeu → EXTENSAO_NAO_INSTALADA (o comportamento de sempre, sem "pedido preservado")', () => {
    const s = statusFromExtension(null, { now: NOW });
    expect(s).toMatchObject({ ready: false, pending: 0, detail: NOT_READY_DETAIL });
    expect(s.detail).toMatch(/^EXTENSAO_NAO_INSTALADA;/);
    expect(s.detail).not.toMatch(/pedido preservado/);
    expect(Object.values(s.checklist).every((v) => v === false)).toBe(true);
  });

  it('respondia e parou → o texto literal do original: EXTENSAO_SEM_RESPOSTA; pedido preservado…', () => {
    const s = statusFromExtension(null, { answeredBefore: true, now: NOW });
    expect(s.detail).toBe(ERR_NO_RESPONSE);
    expect(s.checklist).toEqual({ extensionInstalled: true, extensionConnected: false, flowTabOpen: false, accountChosen: false });
  });

  it('origem não autorizada: instalada, mas bloqueada (diz como resolver)', () => {
    const s = statusFromExtension(null, { originBlocked: true, now: NOW });
    expect(s).toMatchObject({ ready: false, originBlocked: true });
    expect(s.detail).toMatch(/Sites autorizados/);
  });

  it('conectada: pronta, conta e créditos no detalhe, em andamento somado, checklist completo', () => {
    const s = statusFromExtension(raw(), { now: NOW });
    expect(s).toMatchObject({ ready: true, pending: 2, version: '0.1.0' });
    expect(s.detail).toBe('Flow ligado: ana@gmail.com · 80 créditos');
    expect(s.checklist).toEqual({ extensionInstalled: true, extensionConnected: true, flowTabOpen: true, accountChosen: true });
    expect(s.accounts?.[0]).toMatchObject({ email: 'ana@gmail.com', credits: 80, online: true });
  });

  it('só conta em pausa por cota → NÃO está pronta, e o detalhe diz até que horas (COTA_PAUSADA)', () => {
    const r = raw();
    r.accounts[0].cooldownUntil = NOW + 24 * 3600_000;
    const s = statusFromExtension(r, { now: NOW });
    expect(s.ready).toBe(false);
    expect(s.detail).toMatch(/^COTA_PAUSADA; .*até amanhã \d{2}:\d{2} \(o Zerum/); // 24 h depois = amanhã, não só "HH:mm"
    expect(s.detail).toMatch(/não troca de conta sozinho/);
    expect(s.checklist.flowTabOpen).toBe(true);
    expect(s.checklist.accountChosen).toBe(false);
  });

  it('aba do Flow aberta sem login/projeto → não pronta, com o motivo da extensão', () => {
    const s = statusFromExtension(raw({ accounts: [], health: { state: 'not-ready', detail: 'Entre na sua conta Google no Flow.' } }), { now: NOW });
    expect(s).toMatchObject({ ready: false, detail: 'Entre na sua conta Google no Flow.' });
    expect(s.checklist).toMatchObject({ extensionInstalled: true, flowTabOpen: true, accountChosen: false });
  });

  it('com duas contas prontas, mostra a de mais créditos e quantas há a mais', () => {
    const r = raw();
    r.accounts.push({ ...r.accounts[0], context: { ...r.accounts[0].context, accountId: 'bia@gmail.com' }, credits: 500 });
    expect(statusFromExtension(r, { now: NOW }).detail).toBe('Flow ligado: bia@gmail.com · 500 créditos (+1 conta)');
  });
});
