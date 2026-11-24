/**
 * Driver do Flow (sequência de passos) sobre a página falsa, com relógio virtual. Prova a regra de ouro:
 * falha ANTES do clique = failed (nada enviado); incerteza DEPOIS do clique = unknown; watch só LÊ.
 */
import { describe, expect, it } from 'vitest';
import { DriverError, createFlowDriver, DEFAULTS } from '../drivers/flow-driver.js';
import { createMockPage } from './mock-page.mjs';
import { CREDITS_RE, PROJECT_PATH_RE, SELECTORS } from '../drivers/selectors.js';
import { ERROR_CODES, errorCodeFromFlowText } from '../lib/protocol.js';

function make(pageOpts) {
  const clock = { t: 1_000_000 };
  const page = createMockPage(pageOpts);
  const driver = createFlowDriver({ page, sleep: async (ms) => void (clock.t += ms), now: () => clock.t });
  return { clock, page, driver };
}
const spec = (o = {}) => ({ prompt: 'A woman says hello', aspectRatio: '9:16', ...o });
const clicks = (page) => page.calls.filter((c) => c === 'clickGenerate').length;
const caught = async (p) => {
  try {
    await p;
  } catch (e) {
    return e;
  }
  throw new Error('não lançou');
};

describe('identidade e créditos', () => {
  it('pronta quando há e-mail e projeto; senão diz o que falta', async () => {
    expect(await make().driver.identify()).toMatchObject({ ready: true, email: 'ana@gmail.com', reason: '' });
    expect(await make({ loggedIn: false }).driver.identify()).toMatchObject({ ready: false, reason: 'SEM_CONTA_LOGADA' });
    expect(await make({ projectId: '' }).driver.identify()).toMatchObject({ ready: false, reason: 'ABRA_UM_PROJETO_NO_FLOW' });
  });

  it('créditos: inteiro ou null (nunca inventa)', async () => {
    expect(await make({ credits: 42 }).driver.credits()).toBe(42);
    expect(await make({ credits: null }).driver.credits()).toBeNull();
    expect(await make({ credits: -3 }).driver.credits()).toBeNull();
  });

  it('probe: identidade + elemento por elemento', async () => {
    const r = await make({ missing: ['outputsOne'] }).driver.probe();
    expect(r.identity.ready).toBe(true);
    expect(r.elements.outputsOne).toMatchObject({ found: false, count: 0 });
    expect(r.elements.promptBox.found).toBe(true);
  });
});

describe('submitVideo: um clique, e só se tudo estiver certo', () => {
  it('caminho feliz: prepara → anexa → escreve → clica UMA vez → devolve a identidade do cartão novo', async () => {
    const { page, driver } = make();
    const sub = await driver.submitVideo(spec({ firstFrame: { mimeType: 'image/png', base64: 'AAAA' } }));
    expect(sub.tileId).toBe('tile-1');
    expect(clicks(page)).toBe(1);
    expect(page.calls.filter((c) => /^(prepare|attach|typePrompt|clickGenerate)/.test(c))).toEqual(['prepare:9:16:-:frame', 'attachFirstFrame', 'typePrompt', 'clickGenerate']);
  });

  it('não confunde com cartões que já existiam nem com os de OUTRAS ordens (exclude)', async () => {
    const { page, driver } = make();
    page.state.tiles.push({ id: 'velho', text: 'x', outcome: { kind: 'hang' }, reads: 0 });
    page.queueOutcome({ kind: 'ready', id: 'novo-1' });
    const a = await driver.submitVideo(spec());
    expect(a.tileId).toBe('novo-1');
    page.queueOutcome({ kind: 'ready', id: 'novo-2' });
    const b = await driver.submitVideo(spec({ prompt: 'Outra cena' }), { exclude: ['novo-1'] });
    expect(b.tileId).toBe('novo-2');
  });

  it('escolhe o cartão que traz o início do prompt quando aparecem vários novos de uma vez', async () => {
    const { page, driver } = make();
    page.queueOutcome({ kind: 'ready', id: 'novo-A' });
    const original = page.snapshotTiles.bind(page);
    // simula o Flow mostrando 2 cartões novos ao mesmo tempo depois do clique (um é de outra pessoa/aba)
    page.snapshotTiles = async () => {
      const t = await original();
      return page.calls.includes('clickGenerate') ? [{ id: 'intruso', text: 'outro texto', state: 'pending' }, ...t] : t;
    };
    expect((await driver.submitVideo(spec())).tileId).toBe('novo-A');
  });

  it('seletor ausente / botão sumido ANTES do clique → failed, sem clicar', async () => {
    for (const missing of ['promptBox', 'generateButton', 'aspectPortrait', 'outputsOne']) {
      const { page, driver } = make({ missing: [missing] });
      const e = await caught(driver.submitVideo(spec()));
      expect(e).toBeInstanceOf(DriverError);
      expect(e).toMatchObject({ code: `SELETOR_AUSENTE:${missing}`, state: 'failed' });
      expect(clicks(page)).toBe(0);
    }
  });

  it('prompt que não ficou escrito igual → failed PROMPT_NAO_ESCRITO, sem clicar', async () => {
    const { page, driver } = make();
    page.readPrompt = async () => 'texto cortado';
    expect(await caught(driver.submitVideo(spec()))).toMatchObject({ code: 'PROMPT_NAO_ESCRITO', state: 'failed' });
    expect(clicks(page)).toBe(0);
  });

  it('recusa NA HORA (toast de cota) → failed COTA, com o texto do Flow', async () => {
    const { page, driver } = make({ outcomes: [{ kind: 'refuse', error: 'Daily quota exceeded (429)' }] });
    const e = await caught(driver.submitVideo(spec()));
    expect(e).toMatchObject({ code: ERROR_CODES.quota, state: 'failed' });
    expect(e.errorText).toMatch(/quota/i);
    expect(clicks(page)).toBe(1);
  });

  it('alerta de recusa conhecida que PERSISTE alguns segundos sem cartão novo → failed (créditos, política, incomum, cota)', async () => {
    const cases = [
      ['Not enough credits to generate this video', ERROR_CODES.credits],
      ['This prompt was blocked by our safety policy', ERROR_CODES.policy],
      ['Unusual activity detected', ERROR_CODES.unusual],
    ];
    for (const [text, code] of cases) {
      const { clock, page, driver } = make({ outcomes: [{ kind: 'refuse', error: text }] });
      const t0 = clock.t;
      expect(await caught(driver.submitVideo(spec()))).toMatchObject({ code, state: 'failed' });
      expect(clock.t - t0).toBeGreaterThanOrEqual(DEFAULTS.errorPersistMs); // não decide na primeira leitura
      expect(clicks(page)).toBe(1);
    }
  });

  it('alerta lido depois do clique que some, ou que é genérico → NUNCA failed: vira unknown (pode ter cobrado)', async () => {
    // toast passageiro de cota: aparece numa leitura e some, sem cartão
    const a = make({ outcomes: [{ kind: 'refuse', error: 'Daily quota exceeded (429)', transient: true }] });
    expect(await caught(a.driver.submitVideo(spec()))).toMatchObject({ code: 'ENVIO_NAO_CONFIRMADO', state: 'unknown', errorText: expect.stringMatching(/quota/i) });
    expect(clicks(a.page)).toBe(1);
    // alerta genérico (palpite do seletor) mesmo que fique na tela
    const b = make({ outcomes: [{ kind: 'refuse', error: 'Algo deu errado' }] });
    expect(await caught(b.driver.submitVideo(spec()))).toMatchObject({ code: 'ENVIO_NAO_CONFIRMADO', state: 'unknown' });
    expect(clicks(b.page)).toBe(1);
  });

  it('alerta lido mas o cartão aparece depois → segue o cartão (o Flow aceitou o pedido)', async () => {
    const { page, driver } = make();
    const real = page.snapshotTiles.bind(page);
    let reads = 0;
    page.readErrors = async () => 'Daily quota exceeded (429)'; // aviso velho/de outra coisa na tela
    page.snapshotTiles = async () => (page.calls.includes('clickGenerate') && ++reads < 3 ? [] : real());
    expect((await driver.submitVideo(spec())).tileId).toBe('tile-1');
    expect(clicks(page)).toBe(1);
  });

  it('clicou e o cartão não apareceu em 60 s → unknown ENVIO_NAO_CONFIRMADO (pode ter gerado), nunca failed', async () => {
    const { clock, page, driver } = make({ outcomes: [{ kind: 'silent' }] });
    const t0 = clock.t;
    expect(await caught(driver.submitVideo(spec()))).toMatchObject({ code: 'ENVIO_NAO_CONFIRMADO', state: 'unknown' });
    expect(clock.t - t0).toBeGreaterThanOrEqual(DEFAULTS.confirmMs);
    expect(clicks(page)).toBe(1);
  });

  it('erro INESPERADO depois do clique é "incerto"; antes do clique é "failed"', async () => {
    const a = make();
    a.page.snapshotTiles = async () => {
      if (a.page.calls.includes('clickGenerate')) throw new Error('boom');
      return [];
    };
    expect(await caught(a.driver.submitVideo(spec()))).toMatchObject({ state: 'unknown' });
    const b = make();
    b.page.typePrompt = async () => {
      throw new Error('boom');
    };
    expect(await caught(b.driver.submitVideo(spec()))).toMatchObject({ state: 'failed' });
  });
});

describe('watch: só lê a grade', () => {
  it('acompanha até ficar pronto e devolve onde ler o vídeo; reporta progresso', async () => {
    const { page, driver } = make({ outcomes: [{ kind: 'ready', reads: 3 }] });
    const { tileId } = await driver.submitVideo(spec());
    const progress = [];
    const seen = await driver.watch({ tileId }, { onProgress: (p) => progress.push(p) });
    expect(seen.media).toEqual({ url: expect.stringMatching(/^https:\/\/flow-content\.google\/video\//), mimeType: 'video/mp4' });
    expect(progress.length).toBeGreaterThan(0);
    expect(progress[0]).toMatchObject({ phase: 'gerando' });
    expect(clicks(page)).toBe(1); // watch nunca clica em gerar
  });

  it('falha declarada no cartão → failed com o código da causa (cota, conteúdo recusado, genérico)', async () => {
    const cases = [
      ['Failed: you have exceeded your quota', 'COTA'],
      ['Failed: prompt blocked by safety policy', 'CONTEUDO_RECUSADO'],
      ['Failed: Something went wrong', 'FLOW_FALHOU'],
    ];
    for (const [text, code] of cases) {
      const { driver } = make({ outcomes: [{ kind: 'failed', error: text }] });
      const { tileId } = await driver.submitVideo(spec());
      const e = await caught(driver.watch({ tileId }));
      expect(e).toMatchObject({ code, state: 'failed' });
    }
  });

  it('cartão sumiu por 90 s → unknown CARTAO_NAO_ENCONTRADO (reconciliável)', async () => {
    const { driver } = make();
    expect(await caught(driver.watch({ tileId: 'nao-existe' }))).toMatchObject({ code: 'CARTAO_NAO_ENCONTRADO', state: 'unknown' });
  });

  it('prazo esgotado (12 min) → unknown GERACAO_AINDA_PENDENTE; sem tileId → unknown SEM_ID_PARA_RECONCILIAR', async () => {
    const { driver } = make({ outcomes: [{ kind: 'hang' }] });
    const { tileId } = await driver.submitVideo(spec());
    expect(await caught(driver.watch({ tileId }))).toMatchObject({ code: 'GERACAO_AINDA_PENDENTE', state: 'unknown' });
    expect(await caught(driver.watch({}))).toMatchObject({ code: 'SEM_ID_PARA_RECONCILIAR', state: 'unknown' });
  });

  it('cancelamento (AbortSignal) → unknown CANCELADO', async () => {
    const { driver } = make({ outcomes: [{ kind: 'hang' }] });
    const { tileId } = await driver.submitVideo(spec());
    const ac = new AbortController();
    ac.abort();
    expect(await caught(driver.watch({ tileId }, { signal: ac.signal }))).toMatchObject({ code: 'CANCELADO', state: 'unknown' });
  });
});

describe('mapa de erros do Flow (texto → código estável) e padrões de seletor', () => {
  it('cota, atividade incomum, créditos, política e genérico — em PT/EN/ES', () => {
    const t = errorCodeFromFlowText;
    expect(t('You have reached your daily quota')).toBe('COTA');
    expect(t('Muitas solicitações (429)')).toBe('COTA');
    expect(t('Limite diário atingido')).toBe('COTA');
    expect(t('Unusual activity detected')).toBe('INCOMUM');
    expect(t('Atividade incomum')).toBe('INCOMUM');
    expect(t('Not enough credits')).toBe('CREDITOS_INSUFICIENTES');
    expect(t('Sem créditos')).toBe('CREDITOS_INSUFICIENTES');
    expect(t('Blocked by safety policy')).toBe('CONTEUDO_RECUSADO');
    expect(t('Algo deu errado')).toBe('FLOW_ERRO');
    expect(t('')).toBe('FLOW_ERRO');
  });

  it('URL do projeto (verificada) e leitura de créditos', () => {
    const id = '11111111-1111-4111-8111-111111111111';
    expect(PROJECT_PATH_RE.exec(`/project/${id}`)[2]).toBe(id);
    expect(PROJECT_PATH_RE.exec(`/u/2/project/${id}/`)).toMatchObject({ 1: '/u/2', 2: id });
    expect(PROJECT_PATH_RE.test('/project/not-a-uuid')).toBe(false);
    expect(Number(CREDITS_RE.exec('1,250 AI credits')[1].replace(/[.,]/g, ''))).toBe(1250);
    expect(CREDITS_RE.exec('Créditos: 80')).toBeNull(); // só "N créditos" (número antes): evita ler outro número
  });

  it('todo elemento tem estratégias e um status honesto (verificado | palpite)', () => {
    for (const [name, spec] of Object.entries(SELECTORS)) {
      expect(spec.strategies.length, name).toBeGreaterThan(0);
      expect(['verificado', 'palpite'], name).toContain(spec.status);
    }
    expect(SELECTORS.accountButton.status).toBe('verificado'); // o único padrão que vem de código em produção (0.4.18)
  });
});
