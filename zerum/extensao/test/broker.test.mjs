/**
 * Broker da extensão: máquina de estados, idempotência, journal, cota (429 → 24 h) e o estado `unknown`.
 * Tudo sem Chrome: kv em memória + relógio controlado.
 */
import { describe, expect, it } from 'vitest';
import { BrokerError } from '../background/broker.js';
import { memoryKv } from '../lib/kv.js';
import { BROKER_STATES, DELIVERY_GRACE_MS, JOURNAL_RETENTION_MS, LIVE_LIMIT_MS, PRESENCE_TTL_MS, QUEUED_TTL_MS, QUOTA_PAUSE_MS, RECONCILE_TTL_MS, RELOAD_WITHOUT_IDS_TTL_MS, SOFT_PAUSE_MS, TRANSITIONS, canTransition, forbidsResubmit, isTerminal } from '../lib/protocol.js';
import { PROJECT_B, beat, ctx, deliverClip, makeEnv, order, videoArgs } from './helpers.mjs';

/** Enfileira e despacha uma ordem; devolve a ordem como a aba a recebe (com `lease`). */
async function dispatched(env, o = {}) {
  await beat(env.broker); // a conta precisa estar online
  const q = await env.broker.enqueue(order(o));
  const hb = await beat(env.broker);
  const got = hb.orders.find((x) => x.id === q.id);
  expect(got, 'a ordem foi despachada').toBeTruthy();
  return got;
}

const ev = (o, state, extra = {}) => ({ id: o.id, lease: o.lease, eventId: `e-${o.id}-${state}-${Math.random()}`, state, ...extra });

describe('máquina de estados', () => {
  it('tabela de transições: queued → dispatched → accepted → completed | failed | unknown', () => {
    expect(TRANSITIONS).toEqual({
      queued: ['dispatched', 'failed'],
      dispatched: ['accepted', 'failed', 'unknown'],
      accepted: ['completed', 'failed', 'unknown'],
      unknown: ['completed', 'failed'],
      completed: [],
      failed: [],
    });
    expect(isTerminal('completed') && isTerminal('failed')).toBe(true);
    expect(canTransition('unknown', 'queued')).toBe(false);
    expect(canTransition('unknown', 'dispatched')).toBe(false);
    expect(BROKER_STATES.filter((s) => !forbidsResubmit(s))).toEqual(['queued']);
  });

  it('fluxo feliz: queued → dispatched → accepted → completed, com o MP4 guardado no journal', async () => {
    const env = makeEnv();
    const sent = await dispatched(env);
    expect(sent).toMatchObject({ state: 'dispatched', cmd: 'generate.video', mode: 'run' });
    expect(sent.lease).toBeTruthy();
    expect(sent.args[0].prompt).toBe('A woman says hello'); // a aba recebe os argumentos completos

    await beat(env.broker, { events: [ev(sent, 'accepted', { resume: { phase: 'gerando', tileId: 'tile-1' } })] });
    expect(await env.broker.get({ id: sent.id })).toMatchObject({ state: 'accepted', resume: { tileId: 'tile-1' } });

    const clip = await deliverClip(env.media, sent.id);
    const r = await beat(env.broker, { events: [ev(sent, 'completed', { result: clip })] });
    expect(r.ack).toHaveLength(1);
    const done = await env.broker.get({ id: sent.id });
    expect(done.state).toBe('completed');
    expect(done.result).toMatchObject({ bytes: clip.bytes, mimeType: 'video/mp4', mediaRef: clip.mediaRef });
    expect(done.result.sha256).toMatch(/^[0-9a-f]{64}$/);
    expect(JSON.stringify(done)).not.toMatch(/fingerprint|lease|"worker"/); // a visão pública não vaza internos
  });

  it('um `completed` que chega com o `accepted` perdido passa por `accepted` antes (tabela respeitada)', async () => {
    const env = makeEnv();
    const sent = await dispatched(env);
    const clip = await deliverClip(env.media, sent.id);
    await beat(env.broker, { events: [ev(sent, 'completed', { result: clip })] });
    expect((await env.broker.get({ id: sent.id })).state).toBe('completed');
  });

  it('`completed` sem os bytes do MP4 no journal NÃO vale: a geração aconteceu, o arquivo não → unknown (incerto), nunca falha silenciosa', async () => {
    const env = makeEnv();
    const sent = await dispatched(env);
    await beat(env.broker, { events: [ev(sent, 'accepted', { resume: { tileId: 'tile-1' } })] });
    await beat(env.broker, { events: [ev(sent, 'completed', { result: { bytes: 999 } })] });
    expect(await env.broker.get({ id: sent.id })).toMatchObject({ state: 'unknown', error: 'MIDIA_NAO_ENTREGUE' });
  });

  it('terminal não sai do lugar: evento tardio é confirmado (ack) e ignorado', async () => {
    const env = makeEnv();
    const sent = await dispatched(env);
    await beat(env.broker, { events: [ev(sent, 'failed', { error: 'CONTEUDO_RECUSADO' })] });
    const late = ev(sent, 'completed', { result: { bytes: 1 } });
    const r = await beat(env.broker, { events: [late] });
    expect(r.ack).toEqual([late.eventId]);
    expect((await env.broker.get({ id: sent.id })).state).toBe('failed');
  });

  it('evento de lease antiga (ordem já re-despachada) é confirmado e NÃO altera nada', async () => {
    const env = makeEnv();
    const sent = await dispatched(env);
    const stale = { ...ev(sent, 'failed', { error: 'X' }), lease: 'lease-velha' };
    const r = await beat(env.broker, { events: [stale] });
    expect(r.ack).toEqual([stale.eventId]);
    expect((await env.broker.get({ id: sent.id })).state).toBe('dispatched');
  });
});

describe('enqueue: validações e idempotência (resposta perdida nunca duplica a geração)', () => {
  it('a mesma chave devolve a MESMA ordem — antes e depois de despachada', async () => {
    const env = makeEnv();
    await beat(env.broker);
    const a = await env.broker.enqueue(order());
    const b = await env.broker.enqueue(order());
    expect(b.id).toBe(a.id);
    await beat(env.broker);
    const c = await env.broker.enqueue(order());
    expect(c.id).toBe(a.id);
    expect(c.state).toBe('dispatched');
    expect((await env.broker.snapshot()).orders).toHaveLength(1);
  });

  it('a mesma chave com OUTRO conteúdo é recusada (CHAVE_REUTILIZADA_COM_OUTRO_PEDIDO)', async () => {
    const env = makeEnv();
    await beat(env.broker);
    await env.broker.enqueue(order());
    await expect(env.broker.enqueue(order({ args: videoArgs({ prompt: 'outra coisa' }) }))).rejects.toMatchObject({ code: 'CHAVE_REUTILIZADA_COM_OUTRO_PEDIDO' });
  });

  it('o /u/N é só endereço: mudar o accountPath não muda a identidade do pedido', async () => {
    const env = makeEnv();
    await beat(env.broker);
    const a = await env.broker.enqueue(order());
    const b = await env.broker.enqueue(order({ context: ctx('ana@gmail.com', undefined, '/u/2') }));
    expect(b.id).toBe(a.id);
  });

  it('recusa contexto inválido, comando desconhecido e argumentos de vídeo ruins (400, nada gravado)', async () => {
    const env = makeEnv();
    await beat(env.broker);
    await expect(env.broker.enqueue(order({ context: { accountId: 'x', projectId: 'y', accountPath: '' } }))).rejects.toMatchObject({ code: 'CONTEXTO_INVALIDO', status: 400 });
    await expect(env.broker.enqueue(order({ cmd: 'rm -rf' }))).rejects.toMatchObject({ code: 'COMANDO_INVALIDO' });
    await expect(env.broker.enqueue(order({ key: '' }))).rejects.toMatchObject({ code: 'COMANDO_INVALIDO' });
    await expect(env.broker.enqueue(order({ args: [{ prompt: '', aspectRatio: '9:16' }] }))).rejects.toMatchObject({ code: 'PROMPT_OBRIGATORIO' });
    await expect(env.broker.enqueue(order({ args: [{ prompt: 'x', aspectRatio: '1:1' }] }))).rejects.toMatchObject({ code: 'ASPECTO_NAO_SUPORTADO' });
    await expect(env.broker.enqueue(order({ args: videoArgs({ firstFrame: { mimeType: 'image/gif', base64: 'AAAA' } }) }))).rejects.toMatchObject({ code: 'IMAGEM_MIME_NAO_SUPORTADO' });
    await expect(env.broker.enqueue(order({ args: videoArgs({ firstFrame: { mimeType: 'image/png', base64: '***' } }) }))).rejects.toMatchObject({ code: 'IMAGEM_BASE64_INVALIDO' });
    expect((await env.broker.snapshot()).orders).toHaveLength(0);
  });

  it('conta sem aba executora (ou com a presença vencida em 90 s) → CONTA_PROJETO_OFFLINE', async () => {
    const env = makeEnv();
    await expect(env.broker.enqueue(order())).rejects.toMatchObject({ code: 'CONTA_PROJETO_OFFLINE' });
    await beat(env.broker);
    env.advance(PRESENCE_TTL_MS);
    await expect(env.broker.enqueue(order())).rejects.toMatchObject({ code: 'CONTA_PROJETO_OFFLINE' });
    await expect(env.broker.enqueue(order({ context: ctx('ana@gmail.com', PROJECT_B) }))).rejects.toMatchObject({ code: 'CONTA_PROJETO_OFFLINE' });
  });

  it('tentativa: só a tentativa atual do job é aceita (TENTATIVA_SUPERADA); beginAttempt abre a próxima', async () => {
    const env = makeEnv();
    await beat(env.broker);
    await expect(env.broker.enqueue(order({ attempt: 1 }))).rejects.toMatchObject({ code: 'TENTATIVA_SUPERADA' });
    const first = await env.broker.enqueue(order());
    await expect(env.broker.job({ jobId: 'cena:v1:0', context: ctx() }, true)).rejects.toMatchObject({ code: 'JOB_AINDA_TEM_OPERACAO_PENDENTE' });
    const hb = await beat(env.broker);
    await beat(env.broker, { events: [ev(hb.orders[0], 'failed', { error: 'FLOW_ERRO' })] });
    expect((await env.broker.get({ id: first.id })).state).toBe('failed');
    expect(await env.broker.job({ jobId: 'cena:v1:0', context: ctx() })).toEqual({ attempt: 0 });
    expect(await env.broker.job({ jobId: 'cena:v1:0', context: ctx() }, true)).toEqual({ attempt: 1 });
    const second = await env.broker.enqueue(order({ attempt: 1, key: 'k2' }));
    expect(second.id).not.toBe(first.id);
    await expect(env.broker.enqueue(order({ attempt: 0, key: 'k3' }))).rejects.toMatchObject({ code: 'TENTATIVA_SUPERADA' });
  });

  it('o job fica FIXADO na conta/projeto onde começou (JOB_FIXADO_EM_OUTRA_CONTA)', async () => {
    const env = makeEnv();
    await beat(env.broker);
    await beat(env.broker, { context: ctx('bia@gmail.com'), worker: 'w2' });
    await env.broker.enqueue(order());
    await expect(env.broker.enqueue(order({ context: ctx('bia@gmail.com'), key: 'k9' }))).rejects.toMatchObject({ code: 'JOB_FIXADO_EM_OUTRA_CONTA' });
    await expect(env.broker.job({ jobId: 'cena:v1:0', context: ctx('bia@gmail.com') })).rejects.toMatchObject({ code: 'JOB_FIXADO_EM_OUTRA_CONTA' });
  });

  it('duas abas na mesma conta: a segunda é recusada enquanto a primeira está viva', async () => {
    const env = makeEnv();
    await beat(env.broker);
    await expect(beat(env.broker, { worker: 'w2' })).rejects.toMatchObject({ code: 'CONTA_JA_TEM_ABA_EXECUTORA' });
    env.advance(PRESENCE_TTL_MS + 1);
    await expect(beat(env.broker, { worker: 'w2' })).resolves.toBeTruthy(); // a primeira morreu: a segunda assume
  });

  it('despacho respeita a capacidade da aba (e o teto de 4 em voo)', async () => {
    const env = makeEnv();
    await beat(env.broker);
    for (let i = 0; i < 6; i++) await env.broker.enqueue(order({ jobId: `cena:v${i}:0`, key: `k${i}` }));
    expect((await beat(env.broker, { capacity: 2 })).orders).toHaveLength(2);
    expect((await beat(env.broker, { capacity: 2 })).orders).toHaveLength(0); // já tem 2 em voo
    expect((await beat(env.broker, { capacity: 9 })).orders).toHaveLength(2); // teto de 4 em voo
  });

  it('a fila é por conta: ordens de outra conta/projeto não vão para esta aba', async () => {
    const env = makeEnv();
    await beat(env.broker);
    await beat(env.broker, { context: ctx('bia@gmail.com'), worker: 'w2' });
    await env.broker.enqueue(order({ context: ctx('bia@gmail.com') }));
    expect((await beat(env.broker)).orders).toHaveLength(0);
    expect((await beat(env.broker, { context: ctx('bia@gmail.com'), worker: 'w2' })).orders).toHaveLength(1);
  });
});

describe('cota: 429/QUOTA/COTA pausam a conta por 24 h; INCOMUM por 5 min', () => {
  it('429 → pausa de 24 h: não aceita ordem nova, não despacha a fila, e volta depois do prazo', async () => {
    const env = makeEnv();
    const sent = await dispatched(env);
    await env.broker.enqueue(order({ jobId: 'cena:v2:0', key: 'k2' })); // já na fila
    const hit = env.clock.t;
    await beat(env.broker, { events: [ev(sent, 'failed', { error: 'COTA_HTTP_429' })] });

    const [acc] = await env.broker.list();
    expect(acc.cooldownUntil).toBe(hit + QUOTA_PAUSE_MS);
    expect(QUOTA_PAUSE_MS).toBe(24 * 60 * 60 * 1000);
    await expect(env.broker.enqueue(order({ jobId: 'cena:v3:0', key: 'k3' }))).rejects.toMatchObject({ code: 'CONTA_EM_PAUSA_COTA', retryable: true, retryAt: hit + QUOTA_PAUSE_MS });
    const hb = await beat(env.broker);
    expect(hb.orders).toHaveLength(0); // a ordem que estava na fila NÃO sai durante a pausa
    expect(hb.cooldownUntil).toBe(hit + QUOTA_PAUSE_MS);

    env.advance(QUOTA_PAUSE_MS - 1000);
    await beat(env.broker);
    await expect(env.broker.enqueue(order({ jobId: 'cena:v3:0', key: 'k3' }))).rejects.toMatchObject({ code: 'CONTA_EM_PAUSA_COTA' });
    env.advance(2000);
    await beat(env.broker);
    const next = await env.broker.enqueue(order({ jobId: 'cena:v3:0', key: 'k3' }));
    expect(next.state).toBe('queued');
    expect((await beat(env.broker)).orders.length).toBeGreaterThan(0); // a fila volta a andar
  });

  it('as variações do texto de cota (QUOTA, COTA, 429) e do limite suave (UNUSUAL, INCOMUM, RESOURCE_EXHAUSTED)', async () => {
    for (const [error, ms] of [
      ['PUBLIC_ERROR_DAILY_QUOTA_REACHED', QUOTA_PAUSE_MS],
      ['COTA', QUOTA_PAUSE_MS],
      ['HTTP 429', QUOTA_PAUSE_MS],
      ['INCOMUM', SOFT_PAUSE_MS],
      ['UNUSUAL_ACTIVITY', SOFT_PAUSE_MS],
      ['RESOURCE_EXHAUSTED', SOFT_PAUSE_MS],
    ]) {
      const env = makeEnv();
      const sent = await dispatched(env);
      const hit = env.clock.t;
      await beat(env.broker, { events: [ev(sent, 'failed', { error })] });
      expect((await env.broker.list())[0].cooldownUntil, error).toBe(hit + ms);
    }
    expect(SOFT_PAUSE_MS).toBe(5 * 60 * 1000);
  });

  it('erro comum não pausa; sem troca automática de conta aqui (a outra conta segue livre)', async () => {
    const env = makeEnv();
    await beat(env.broker, { context: ctx('bia@gmail.com'), worker: 'w2' });
    const sent = await dispatched(env);
    await beat(env.broker, { events: [ev(sent, 'failed', { error: 'CONTEUDO_RECUSADO' })] });
    const accounts = await env.broker.list();
    expect(accounts.find((a) => a.context.accountId === 'ana@gmail.com').cooldownUntil).toBe(0);
    // cota na Ana não bloqueia a Bia
    const s2 = await dispatched(env, { jobId: 'cena:v2:0', key: 'k2' });
    await beat(env.broker, { events: [ev(s2, 'failed', { error: '429' })] });
    const bia = await env.broker.enqueue(order({ context: ctx('bia@gmail.com'), jobId: 'cena:v9:0', key: 'k9' }));
    expect(bia.state).toBe('queued');
  });

  it('pausar a conta pelo usuário: não recebe ordem nova nem despacha a fila; retomar libera', async () => {
    const env = makeEnv();
    await beat(env.broker);
    const q = await env.broker.enqueue(order());
    await env.broker.setPaused('ANA@gmail.com', true);
    await expect(env.broker.enqueue(order({ jobId: 'cena:v2:0', key: 'k2' }))).rejects.toMatchObject({ code: 'CONTA_PAUSADA_PELO_USUARIO' });
    expect((await beat(env.broker)).orders).toHaveLength(0);
    expect((await env.broker.list())[0].paused).toBe(true);
    await env.broker.setPaused('ana@gmail.com', false);
    expect((await beat(env.broker)).orders.map((o) => o.id)).toEqual([q.id]);
  });
});

describe('unknown: incerto nunca vira nova geração', () => {
  it('executor mudo por 3 min → unknown (EXECUTOR_SEM_RESPOSTA); a conta fica bloqueada para ordens novas', async () => {
    const env = makeEnv();
    const sent = await dispatched(env);
    await beat(env.broker, { events: [ev(sent, 'accepted', { resume: { phase: 'gerando' } })] });
    env.advance(LIVE_LIMIT_MS);
    const o = await env.broker.get({ id: sent.id });
    expect(o).toMatchObject({ state: 'unknown', error: 'EXECUTOR_SEM_RESPOSTA' });
    await beat(env.broker);
    await expect(env.broker.enqueue(order({ jobId: 'cena:v2:0', key: 'k2' }))).rejects.toMatchObject({ code: 'CONTA_COM_OPERACAO_INCERTA' });
  });

  it('unknown SEM identificação da geração: nada a reler; vira falha EXPLÍCITA em 55 s ("liberada"), sem re-despachar', async () => {
    const env = makeEnv();
    const sent = await dispatched(env);
    await beat(env.broker, { events: [ev(sent, 'unknown', { error: 'ABA_RECARREGADA_SEM_REENVIO', executionFinished: true })] });
    const mid = await beat(env.broker); // a aba bate de novo: a ordem NÃO volta
    expect(mid.orders).toHaveLength(0);
    expect((await env.broker.get({ id: sent.id })).state).toBe('unknown');
    env.advance(RELOAD_WITHOUT_IDS_TTL_MS);
    const failed = await env.broker.get({ id: sent.id });
    expect(failed).toMatchObject({ state: 'failed', error: 'RECONCILIACAO_EXPIRADA_LIBERADA_PARA_NOVA_TENTATIVA', releasedUncertain: true });
    expect(RELOAD_WITHOUT_IDS_TTL_MS).toBe(55_000);
  });

  it('unknown COM identificação (aba do clipe): a própria aba recebe a ordem em modo "resume" (só ler) e conclui SEM nova geração', async () => {
    const env = makeEnv();
    const sent = await dispatched(env);
    await beat(env.broker, { events: [ev(sent, 'accepted', { resume: { tileId: 'tile-7', phase: 'gerando' } })] });
    // A mesma batida que relata o incerto já recebe a releitura (reconciliação automática, sem ninguém pedir).
    const hb = await beat(env.broker, { events: [ev(sent, 'unknown', { error: 'ABA_RECARREGADA_SEM_REENVIO', executionFinished: true })] });
    expect((await env.broker.get({ id: sent.id })).state).toBe('unknown');
    expect(hb.orders).toHaveLength(1);
    const back = hb.orders[0];
    expect(back).toMatchObject({ id: sent.id, mode: 'resume', state: 'unknown' });
    expect(back.resume.tileId).toBe('tile-7');
    expect(back.lease).not.toBe(sent.lease);
    expect((await beat(env.broker)).orders).toHaveLength(0); // não é despachada duas vezes

    // progresso da releitura não muda o estado; o veredito sim — e só completed|failed saem de unknown
    await beat(env.broker, { events: [ev(back, 'accepted', { resume: { phase: 'relendo' } })] });
    expect((await env.broker.get({ id: sent.id })).state).toBe('unknown');
    const clip = await deliverClip(env.media, sent.id);
    await beat(env.broker, { events: [ev(back, 'completed', { result: clip })] });
    expect((await env.broker.get({ id: sent.id })).state).toBe('completed');
  });

  it('executor mudo COM identificação: o `unknown` por tempo esgotado também volta, na batida seguinte, para releitura', async () => {
    const env = makeEnv();
    const sent = await dispatched(env);
    await beat(env.broker, { events: [ev(sent, 'accepted', { resume: { tileId: 'tile-9' } })] });
    env.advance(LIVE_LIMIT_MS);
    const hb = await beat(env.broker);
    expect(hb.orders).toHaveLength(1);
    expect(hb.orders[0]).toMatchObject({ id: sent.id, mode: 'resume', error: 'EXECUTOR_SEM_RESPOSTA' });
  });

  it('unknown com identificação que ninguém reconcilia em 12 min: falha explícita (CANDIDATOS_NAO_RECONCILIADOS_SEM_REENVIO)', async () => {
    const env = makeEnv();
    const sent = await dispatched(env);
    await beat(env.broker, { events: [ev(sent, 'accepted', { resume: { tileId: 'tile-7' } })] });
    await beat(env.broker, { events: [ev(sent, 'unknown', { error: 'X', executionFinished: true })] });
    env.advance(RECONCILE_TTL_MS);
    expect(await env.broker.get({ id: sent.id })).toMatchObject({ state: 'failed', error: 'CANDIDATOS_NAO_RECONCILIADOS_SEM_REENVIO' });
  });

  it('geração VIVA (accepted, aba mandando progresso) NÃO é derrubada aos 12 min: o `completed` tardio é aceito, sem lease inválida', async () => {
    const env = makeEnv();
    const sent = await dispatched(env);
    await beat(env.broker, { events: [ev(sent, 'accepted', { resume: { tileId: 'tile-lenta', phase: 'gerando' } })] });
    // 14 min de Flow lento, com a aba acompanhando (progresso a cada 2 min < LIVE_LIMIT_MS)
    for (let i = 0; i < 7; i++) {
      env.advance(2 * 60_000);
      await beat(env.broker, { events: [ev(sent, 'accepted', { resume: { tileId: 'tile-lenta', phase: 'gerando', progress: i } })] });
    }
    expect(RECONCILE_TTL_MS).toBeLessThan(14 * 60_000);
    expect(await env.broker.get({ id: sent.id })).toMatchObject({ state: 'accepted' });
    expect((await env.broker.get({ id: sent.id })).error).toBeUndefined();

    const clip = await deliverClip(env.media, sent.id);
    const r = await beat(env.broker, { events: [ev(sent, 'completed', { result: clip })] });
    expect(r.ack).toHaveLength(1);
    expect(await env.broker.get({ id: sent.id })).toMatchObject({ state: 'completed', result: { bytes: clip.bytes } });
  });

  it('o prazo de 12 min conta só a partir do `unknown`: accepted antigo que vira incerto ainda ganha os 12 min inteiros', async () => {
    const env = makeEnv();
    const sent = await dispatched(env);
    await beat(env.broker, { events: [ev(sent, 'accepted', { resume: { tileId: 'tile-1' } })] });
    env.advance(RECONCILE_TTL_MS - 60_000);
    await beat(env.broker, { events: [ev(sent, 'unknown', { error: 'ABA_RECARREGADA_SEM_REENVIO', executionFinished: true })] });
    env.advance(RECONCILE_TTL_MS - 60_000);
    expect((await env.broker.get({ id: sent.id })).state).toBe('unknown');
    env.advance(60_000);
    expect(await env.broker.get({ id: sent.id })).toMatchObject({ state: 'failed', error: 'CANDIDATOS_NAO_RECONCILIADOS_SEM_REENVIO' });
  });

  it('trocar de projeto na mesma aba deixa o que estava em voo INCERTO (ROTA_ALTERADA_RECONCILIAR), sem perder nem repetir', async () => {
    const env = makeEnv();
    const sent = await dispatched(env);
    await beat(env.broker, { events: [ev(sent, 'accepted', { resume: { tileId: 'tile-1' } })] });
    await beat(env.broker, { context: ctx('ana@gmail.com', PROJECT_B) });
    expect(await env.broker.get({ id: sent.id })).toMatchObject({ state: 'unknown', error: 'ROTA_ALTERADA_RECONCILIAR' });
    // voltando ao projeto original, a releitura é dada à aba
    const back = await beat(env.broker);
    expect(back.orders.map((o) => o.id)).toEqual([sent.id]);
    expect(back.orders[0].mode).toBe('resume');
  });

  it('reconcile(): terminal devolve o estado; incerta sem IDs aguarda o prazo; em andamento sem IDs recusa; id inexistente = 404', async () => {
    const env = makeEnv();
    const sent = await dispatched(env);
    await expect(env.broker.reconcile({ id: sent.id })).rejects.toMatchObject({ code: 'OPERACAO_NAO_PRECISA_RECONCILIAR' });
    await beat(env.broker, { events: [ev(sent, 'unknown', { error: 'X', executionFinished: true })] });
    expect((await env.broker.reconcile({ id: sent.id })).state).toBe('unknown');
    env.advance(RELOAD_WITHOUT_IDS_TTL_MS);
    expect((await env.broker.reconcile({ id: sent.id })).state).toBe('failed');
    await expect(env.broker.reconcile({ id: 'nada' })).rejects.toMatchObject({ status: 404 });
  });

  it('recoverJob: reconciliando → liberado; concluído reaproveita a tentativa', async () => {
    const env = makeEnv();
    const sent = await dispatched(env);
    const hb = await beat(env.broker, { events: [ev(sent, 'accepted', { resume: { tileId: 't' } }), ev(sent, 'unknown', { error: 'X', executionFinished: true })] });
    const rec = await env.broker.recoverJob({ jobId: 'cena:v1:0', context: ctx() });
    expect(rec).toMatchObject({ status: 'reconciling', operationId: sent.id, hasCandidates: true });
    const clip = await deliverClip(env.media, sent.id);
    await beat(env.broker, { events: [ev(hb.orders[0], 'completed', { result: clip })] });
    expect(await env.broker.recoverJob({ jobId: 'cena:v1:0', context: ctx() })).toMatchObject({ status: 'completed', operationId: sent.id });
    expect(await env.broker.job({ jobId: 'cena:v1:0', context: ctx() }, true)).toEqual({ attempt: 0 }); // reaproveita a tentativa
    expect(await env.broker.recoverJob({ jobId: 'outro', context: ctx() })).toMatchObject({ status: 'released', operationId: null });
  });

  it('ordem que nunca saiu do navegador (queued) expira em 10 min — seguro refazer, nada foi enviado ao Google', async () => {
    const env = makeEnv();
    await beat(env.broker);
    const q = await env.broker.enqueue(order());
    env.advance(QUEUED_TTL_MS);
    expect(await env.broker.get({ id: q.id })).toMatchObject({ state: 'failed', error: 'NAO_DESPACHADA_EXPIRADA' });
  });
});

describe('journal: sobrevive a reinício e protege contra falha de gravação', () => {
  it('reiniciar o service worker (novo Broker sobre o mesmo storage) preserva ordens, jobs, contas e mídia', async () => {
    const env = makeEnv();
    const sent = await dispatched(env);
    await beat(env.broker, { events: [ev(sent, 'accepted', { resume: { tileId: 't1' } })] });
    const clip = await deliverClip(env.media, sent.id);
    await beat(env.broker, { events: [ev(sent, 'completed', { result: clip })] });
    const second = await env.broker.enqueue(order({ jobId: 'cena:v2:0', key: 'k2' }));

    const reborn = env.remake(); // processo novo, memória vazia
    expect((await reborn.get({ id: sent.id })).state).toBe('completed');
    expect((await reborn.get({ id: sent.id })).result.bytes).toBe(clip.bytes);
    expect((await reborn.get({ id: second.id })).state).toBe('queued');
    expect(await reborn.job({ jobId: 'cena:v1:0', context: ctx() })).toEqual({ attempt: 0 });
    expect((await reborn.list())[0].context.accountId).toBe('ana@gmail.com');
    // e a deduplicação continua valendo depois do reinício
    expect((await reborn.enqueue(order())).id).toBe(sent.id);
  });

  it('o journal não guarda o pedido (com a imagem) depois que a ordem termina; a impressão digital fica para deduplicar', async () => {
    const env = makeEnv();
    const img = { mimeType: 'image/png', base64: 'AAAA'.repeat(1000) };
    await beat(env.broker);
    const q = await env.broker.enqueue(order({ args: videoArgs({ firstFrame: img }) }));
    expect(JSON.stringify(env.kv.dump())).toContain(img.base64);
    const hb = await beat(env.broker);
    await beat(env.broker, { events: [ev(hb.orders[0], 'failed', { error: 'FLOW_ERRO' })] });
    expect(JSON.stringify(env.kv.dump())).not.toContain(img.base64);
    expect((await env.broker.enqueue(order({ args: videoArgs({ firstFrame: img }) }))).id).toBe(q.id);
  });

  it('falha ao gravar: o cache em memória é descartado e o estado volta ao que está no storage (nada fantasma)', async () => {
    const env = makeEnv();
    await beat(env.broker);
    env.kv.failNextSet = true;
    await expect(env.broker.enqueue(order())).rejects.toThrow('STORAGE_FALHOU');
    expect((await env.broker.snapshot()).orders).toHaveLength(0); // a ordem "gravada pela metade" não existe
    const again = await env.broker.enqueue(order());
    expect(again.state).toBe('queued');
  });

  it('poda: remove só ordens TERMINAIS antigas (e os bytes), nunca o que está em andamento', async () => {
    const env = makeEnv();
    const sent = await dispatched(env);
    const clip = await deliverClip(env.media, sent.id);
    await beat(env.broker, { events: [ev(sent, 'completed', { result: clip })] });
    const live = await env.broker.enqueue(order({ jobId: 'cena:v2:0', key: 'k2' }));
    env.advance(JOURNAL_RETENTION_MS + 1);
    await beat(env.broker);
    expect(await env.broker.prune()).toEqual({ removed: 1 });
    await expect(env.broker.get({ id: sent.id })).rejects.toMatchObject({ status: 404 });
    expect(await env.media.meta(sent.id)).toBeNull();
    expect((await env.broker.get({ id: live.id })).id).toBe(live.id);
  });

  it('"Limpar" manual (deliveredOnly): NUNCA apaga MP4 concluído que o site ainda não leu; apaga o já entregue (após a folga) e as falhas', async () => {
    const env = makeEnv();
    const a = await dispatched(env); // concluída e NÃO baixada
    await beat(env.broker, { events: [ev(a, 'completed', { result: await deliverClip(env.media, a.id) })] });
    const b = await env.broker.enqueue(order({ jobId: 'cena:v2:0', key: 'k2' }));
    const hb = await beat(env.broker);
    const bSent = hb.orders.find((x) => x.id === b.id);
    await beat(env.broker, { events: [ev(bSent, 'completed', { result: await deliverClip(env.media, b.id) })] }); // concluída E baixada
    await env.broker.markDownloaded({ id: b.id });
    const c = await env.broker.enqueue(order({ jobId: 'cena:v3:0', key: 'k3' }));
    const cSent = (await beat(env.broker)).orders.find((x) => x.id === c.id);
    await beat(env.broker, { events: [ev(cSent, 'failed', { error: 'CONTEUDO_RECUSADO' })] });

    env.advance(1000);
    // dentro da folga: a baixada também fica; só a falha sai
    expect(await env.broker.prune({ olderThanMs: 0, deliveredOnly: true })).toEqual({ removed: 1, kept: 2 });
    env.advance(DELIVERY_GRACE_MS);
    expect(await env.broker.prune({ olderThanMs: 0, deliveredOnly: true })).toEqual({ removed: 1, kept: 1 });
    // a não baixada continua lá, com os bytes, e pode ser baixada
    expect((await env.broker.get({ id: a.id })).state).toBe('completed');
    expect((await env.media.meta(a.id))?.done).toBe(true);
    await expect(env.broker.get({ id: b.id })).rejects.toMatchObject({ status: 404 });
    // e nada de `downloadedAt` vaza na visão pública
    await env.broker.markDownloaded({ id: a.id });
    expect(JSON.stringify(await env.broker.get({ id: a.id }))).not.toMatch(/downloadedAt/);
  });

  it('mediaState: devolve a conta dona da mídia concluída', async () => {
    const env = makeEnv();
    const sent = await dispatched(env);
    const clip = await deliverClip(env.media, sent.id);
    await beat(env.broker, { events: [ev(sent, 'completed', { result: clip })] });
    expect((await env.broker.mediaState({ mediaId: clip.mediaRef })).context).toMatchObject({ accountId: 'ana@gmail.com' });
    expect(await env.broker.mediaState({ mediaId: 'desconhecida' })).toEqual({ context: null });
  });
});

describe('BrokerError', () => {
  it('carrega código estável e status HTTP-like', () => {
    const e = new BrokerError('CONTA_EM_PAUSA_COTA', 409, { retryAt: 5 });
    expect(e).toMatchObject({ code: 'CONTA_EM_PAUSA_COTA', status: 409, retryAt: 5, message: 'CONTA_EM_PAUSA_COTA' });
  });
});

describe('storage: kv em memória espelha o chrome.storage (cópia por JSON, escrita atômica)', () => {
  it('não há aliasing entre o que se grava e o que se lê', async () => {
    const kv = memoryKv();
    const v = { a: [1] };
    await kv.set({ k: v });
    v.a.push(2);
    expect((await kv.get(['k'])).k).toEqual({ a: [1] });
  });
});
