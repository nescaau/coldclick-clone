import { describe, expect, it } from 'vitest';
import {
  BROKER_STATES,
  QUOTA_PAUSE_MS,
  SOFT_PAUSE_MS,
  canTransition,
  classifyRefusal,
  forbidsResubmit,
  isTerminal,
  pauseUntil,
} from './broker';
import { BRIDGE_ACTIONS, BRIDGE_TIMEOUT_MS, BridgeRequestSchema, BridgeResponseSchema, ERR_NO_RESPONSE, matchResponse } from './protocol';
import { NOT_READY_DETAIL, NullFlowExecutor, pillLabel } from './status';

describe('protocolo zre', () => {
  it('constantes literais do original', () => {
    expect(BRIDGE_TIMEOUT_MS).toBe(25_000);
    expect(ERR_NO_RESPONSE).toBe('EXTENSAO_SEM_RESPOSTA; pedido preservado, não gerar outra vez');
  });

  it('não tem a ação "connect" (era a troca de sessão 001 → código de membro)', () => {
    expect(BRIDGE_ACTIONS).not.toContain('connect');
    expect(BridgeRequestSchema.safeParse({ zre: 'request', id: 'a', action: 'connect' }).success).toBe(false);
  });

  it('valida pedidos: id 1..128, ação conhecida', () => {
    expect(BridgeRequestSchema.safeParse({ zre: 'request', id: 'x', action: 'enqueue', payload: {} }).success).toBe(true);
    expect(BridgeRequestSchema.safeParse({ zre: 'request', id: '', action: 'enqueue' }).success).toBe(false);
    expect(BridgeRequestSchema.safeParse({ zre: 'request', id: 'x'.repeat(129), action: 'get' }).success).toBe(false);
    expect(BridgeRequestSchema.safeParse({ zre: 'response', id: 'x', action: 'get' }).success).toBe(false);
  });

  it('resposta precisa de result ou error', () => {
    expect(BridgeResponseSchema.safeParse({ zre: 'response', id: 'x' }).success).toBe(false);
    expect(BridgeResponseSchema.safeParse({ zre: 'response', id: 'x', result: { ok: true } }).success).toBe(true);
    expect(BridgeResponseSchema.safeParse({ zre: 'response', id: 'x', error: 'AGUARDE_PAREAMENTO' }).success).toBe(true);
  });

  it('matchResponse só aceita ids pendentes', () => {
    const pend = new Set(['a']);
    expect(matchResponse(pend, { zre: 'response', id: 'a', result: 1 })?.id).toBe('a');
    expect(matchResponse(pend, { zre: 'response', id: 'b', result: 1 })).toBeNull();
    expect(matchResponse(pend, 'lixo')).toBeNull();
  });
});

describe('broker', () => {
  it('fluxo feliz queued → dispatched → accepted → completed', () => {
    expect(canTransition('queued', 'dispatched')).toBe(true);
    expect(canTransition('dispatched', 'accepted')).toBe(true);
    expect(canTransition('accepted', 'completed')).toBe(true);
  });

  it('terminais não saem; unknown só resolve por reconciliação (nunca volta a enfileirar)', () => {
    expect(isTerminal('completed')).toBe(true);
    expect(isTerminal('failed')).toBe(true);
    expect(canTransition('unknown', 'queued')).toBe(false);
    expect(canTransition('unknown', 'dispatched')).toBe(false);
    expect(canTransition('unknown', 'completed')).toBe(true);
    expect(canTransition('completed', 'failed')).toBe(false);
  });

  it('só `queued` pode ser reenviado; todo o resto proíbe segundo submit', () => {
    expect(BROKER_STATES.filter((s) => !forbidsResubmit(s))).toEqual(['queued']);
  });

  it('classifica recusas e pausa: cota 24 h, incomum 5 min', () => {
    expect(classifyRefusal('HTTP 429 too many')).toBe('cota');
    expect(classifyRefusal('PUBLIC_ERROR_DAILY_QUOTA_REACHED')).toBe('cota');
    expect(classifyRefusal('UNUSUAL_ACTIVITY')).toBe('incomum');
    expect(classifyRefusal('RESOURCE_EXHAUSTED')).toBe('incomum');
    expect(classifyRefusal('tudo certo')).toBeNull();
    expect(pauseUntil('cota', 1000)).toBe(1000 + QUOTA_PAUSE_MS);
    expect(pauseUntil('incomum', 1000)).toBe(1000 + SOFT_PAUSE_MS);
    expect(QUOTA_PAUSE_MS).toBe(86_400_000);
  });
});

describe('estado da ponte', () => {
  it('pílula: textos do original', () => {
    expect(pillLabel({ ready: false, pending: 0 }, 'reconectar')).toBe('○ sem Flow · clique pra reconectar');
    expect(pillLabel({ ready: false, pending: 0 }, 'contas')).toBe('○ Contas Flow');
    expect(pillLabel({ ready: true, pending: 0 }, 'reconectar')).toBe('● Flow ligado');
    expect(pillLabel({ ready: true, pending: 2 }, 'contas')).toBe('● Flow ligado · 2 em andamento');
  });

  it('NullFlowExecutor: sempre desligado, sem contas, e recusa gerar', async () => {
    const ex = new NullFlowExecutor();
    const st = await ex.status();
    expect(st.ready).toBe(false);
    expect(st.detail).toBe(NOT_READY_DETAIL);
    expect(st.detail).not.toMatch(/pedido preservado/);
    expect(Object.values(st.checklist).every((v) => v === false)).toBe(true);
    expect(await ex.accounts()).toEqual([]);
    await expect(ex.submit()).rejects.toThrow(/EXECUTOR_INDISPONIVEL/);
  });
});
