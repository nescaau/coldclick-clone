/**
 * Testes de integração dos serviços sobre um SQLite REAL numa pasta temporária (ZERUM_DATA_DIR).
 * Os módulos são importados dinamicamente: config.ts lê a variável de ambiente no momento do import.
 * O relógio da simulação é controlado (Date.now simulado): nada depende de timers reais.
 */
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import crypto from 'node:crypto';
import { afterAll, afterEach, beforeAll, describe, expect, it, vi } from 'vitest';
import { buildMp4 } from './domain/mp4-fixture';
import { zipToBuffer } from './domain/zip';

const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'zerum-test-'));
process.env.ZERUM_DATA_DIR = dir;
process.env.ZERUM_SIM_SCENE_MS = '1000';

type Mods = {
  conv: typeof import('./services/conversation-service');
  director: typeof import('./services/director-service');
  batch: typeof import('./services/batch-service');
  prod: typeof import('./services/production-service');
  viral: typeof import('./services/viral-service');
  avatar: typeof import('./services/avatar-service');
  settings: typeof import('./services/settings-service');
  bridge: typeof import('./services/bridge-service');
  feedback: typeof import('./services/feedback-service');
  boot: typeof import('./services/bootstrap');
  events: typeof import('./repo/events');
  viralRepo: typeof import('./repo/virals');
  batchRepo: typeof import('./repo/batches');
  config: typeof import('./config');
};
let m: Mods;

/** MP4 sintético com metadados reais; `salt` muda o hash. */
let saltSeq = 1;
const mp4 = (o: Parameters<typeof buildMp4>[0] = {}) => buildMp4({ ...o, salt: saltSeq++ });
const PNG = (n = 0) => Uint8Array.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, n, 1, 2, 3]);

let clock = 1_700_000_000_000;
const advance = (ms: number) => {
  clock += ms;
  m.prod.tickBatches(clock);
};

beforeAll(async () => {
  vi.spyOn(Date, 'now').mockImplementation(() => clock);
  const { ensureBootstrapped } = await import('./services/bootstrap');
  ensureBootstrapped();
  m = {
    conv: await import('./services/conversation-service'),
    director: await import('./services/director-service'),
    batch: await import('./services/batch-service'),
    prod: await import('./services/production-service'),
    viral: await import('./services/viral-service'),
    avatar: await import('./services/avatar-service'),
    settings: await import('./services/settings-service'),
    bridge: await import('./services/bridge-service'),
    feedback: await import('./services/feedback-service'),
    boot: await import('./services/bootstrap'),
    events: await import('./repo/events'),
    viralRepo: await import('./repo/virals'),
    batchRepo: await import('./repo/batches'),
    config: await import('./config'),
  };
});

afterEach(() => {
  m.settings.patchSettings({ simulation: true, simFailEvery: 0, parallel: 2, autoApprove: false });
});

afterAll(() => {
  vi.restoreAllMocks();
  globalThis.__zerumDb?.close();
  globalThis.__zerumDb = undefined;
  fs.rmSync(dir, { recursive: true, force: true });
});

const say = (id: string, text: string) => m.director.sendMessage(id, { text, attachments: [] });

describe('banco próprio', () => {
  it('cria data/zerum.db na pasta configurada (sem tocar em nenhum outro banco)', () => {
    expect(m.config.DB_PATH).toBe(path.join(dir, 'zerum.db'));
    expect(fs.existsSync(m.config.DB_PATH)).toBe(true);
  });

  it('o log geral do app registra a recuperação da memória local', () => {
    expect(m.events.listRecentEvents('app', m.events.APP_LOG_REF).some((e) => /Memória local recuperada/.test(e.message))).toBe(true);
  });
});

describe('conversas', () => {
  it('nasce "Nova conversa" em modo viral, com as opções padrão (balão ligado, #FFC400, Inglês)', () => {
    const c = m.conv.createConversation();
    expect(c.title).toBe('Nova conversa');
    expect(c.mode).toBe('viral');
    expect(c.options).toEqual({ word: '', batchName: '', bubbleOn: true, bubbleColor: '#FFC400', language: 'en' });
    expect(c.messages).toEqual([]);
    expect(m.conv.listAll().some((x) => x.id === c.id)).toBe(true);
    expect(m.events.listEvents('conversation', c.id)[0].message).toBe('Conversa criada.');
  });

  it('opções persistem sanitizadas; a cor escolhida vira padrão das próximas conversas', () => {
    const c = m.conv.createConversation();
    const r = m.conv.patchConversation(c.id, { options: { word: 'Quero!', batchName: 'Ação 1', bubbleColor: '#3b82f6', language: 'es', bubbleOn: false } });
    expect(r.options).toEqual({ word: 'Quero', batchName: 'Acao1', bubbleOn: false, bubbleColor: '#3B82F6', language: 'es' });
    expect(m.conv.getDetail(c.id).options.word).toBe('Quero');
    expect(m.conv.createConversation().options.bubbleColor).toBe('#3B82F6');
    m.conv.patchConversation(c.id, { options: { bubbleColor: '#FFC400' } });
  });

  it('renomear é manual: o título automático não sobrescreve depois', () => {
    const c = m.conv.createConversation({ mode: 'ideia' });
    m.conv.patchConversation(c.id, { title: 'Meu lote' });
    say(c.id, 'uma enfermeira de 60 anos');
    expect(m.conv.getDetail(c.id).title).toBe('Meu lote');
  });

  it('trocar de conversa: o histórico de mensagens do Diretor persiste em cada uma', () => {
    const a = m.conv.createConversation({ mode: 'ideia' });
    const b = m.conv.createConversation({ mode: 'ideia' });
    say(a.id, 'faz 2 vídeos de uma receita');
    say(b.id, 'um vídeo de skincare');
    expect(m.conv.getDetail(a.id).messages.map((x) => x.role)).toEqual(['aluna', 'diretor']);
    expect(m.conv.getDetail(a.id).messages[0].text).toBe('faz 2 vídeos de uma receita');
    expect(m.conv.getDetail(b.id).messages[0].text).toBe('um vídeo de skincare');
  });

  it('assertConversationExists → 404 feminino; conversa inexistente → 404', () => {
    const c = m.conv.createConversation();
    expect(() => m.conv.assertConversationExists(c.id)).not.toThrow();
    expect(() => m.conv.assertConversationExists('nao-existe')).toThrow('Conversa não encontrada');
    expect(() => m.conv.getDetail('nao-existe')).toThrow('Conversa não encontrada');
    expect(() => say('nao-existe', 'oi')).toThrow(/não encontrad/);
  });

  it('apagar remove a conversa, as mensagens, os planos e os eventos dela', () => {
    const c = m.conv.createConversation({ mode: 'ideia' });
    const r = say(c.id, 'oi');
    expect(r.plan).not.toBeNull();
    m.events.logEvent('conversation', c.id, 'evento da conversa');
    m.conv.removeConversation(c.id);
    expect(() => m.conv.getDetail(c.id)).toThrow();
    expect(m.events.listEvents('conversation', c.id)).toEqual([]);
    expect(m.director.confirmPlan.bind(null, r.plan!.id)).toThrow(/Plano não encontrado/);
  });
});

describe('Diretor: pedido → PLANO com passos → confirmação → lote em Produção', () => {
  it('o pedido vira um plano que REQUER confirmação; nada é criado antes de confirmar', () => {
    const c = m.conv.createConversation({ mode: 'ideia' });
    m.conv.patchConversation(c.id, { options: { word: 'link', batchName: 'Umbigo', language: 'de' } });
    const r = m.director.sendMessage(c.id, { text: 'faz 3 vídeos de uma enfermeira de 60 anos', attachments: [{ nome: 'ref.png' }] });

    expect(r.batch).toBeNull();
    expect(r.plan).toMatchObject({ requerConfirmacao: true, state: 'pendente', params: { quantity: 3, language: 'de', word: 'link', batchName: 'Umbigo' } });
    expect(r.plan!.steps.length).toBeGreaterThanOrEqual(4);
    expect(r.plan!.steps.some((s) => s.gastaCredito)).toBe(true);
    expect(r.conversation.messages.map((x) => x.role)).toEqual(['aluna', 'diretor']);
    expect(r.conversation.messages[0].attachments).toEqual([{ nome: 'ref.png' }]);
    expect(r.conversation.messages[1].plan?.id).toBe(r.plan!.id);
    expect(r.conversation.messages[1].text).toMatch(/Confira o plano aqui embaixo e clique em Executar \d passos/);
    expect(r.conversation.title).toBe('Faz 3 vídeos de uma enfermeira de 60 anos');
    expect(m.prod.conversationBatches(c.id)).toEqual([]);
  });

  it('refinar ("faz 20"): o plano anterior vira "substituído" e o novo parte dos parâmetros atuais', () => {
    const c = m.conv.createConversation({ mode: 'ideia' });
    const a = say(c.id, 'quero adaptado, 3 vídeos');
    const b = say(c.id, 'faz 20');
    const det = m.conv.getDetail(c.id);
    expect(det.messages.find((x) => x.plan?.id === a.plan!.id)?.plan?.state).toBe('substituido');
    expect(b.plan!.params).toMatchObject({ quantity: 20, path: 'adaptar' });
    expect(() => m.director.confirmPlan(a.plan!.id)).toThrow(/não está mais valendo/);
  });

  it('confirmar cria o lote com N vídeos e cenas, registra o log e responde "Executando o que você confirmou…"', () => {
    const c = m.conv.createConversation({ mode: 'ideia' });
    const r = say(c.id, '2 vídeos');
    const out = m.director.confirmPlan(r.plan!.id);

    expect(out.batch).toMatchObject({ state: 'na_fila', quantity: 2, source: 'diretor', viralId: null, path: 'igual' });
    expect(out.batch.videos).toHaveLength(2);
    expect(out.batch.videos[0]).toMatchObject({ state: 'fila', scenesTotal: 4, simulated: true });
    const msgs = out.conversation.messages;
    expect(msgs.at(-1)?.text).toMatch(/Executando o que você confirmou, na ordem\. A produção aparece aqui ao lado e em Produção; cada vídeo pronto entra em Vídeos\./);
    expect(msgs.at(-1)?.text).toMatch(/Feito: lote ".*" montado com 2 vídeos/);
    expect(msgs.find((x) => x.plan)?.plan?.state).toBe('executado');
    const log = m.prod.batchEvents(out.batch.id).map((e) => e.message);
    expect(log.some((l) => /Simulação local ligada/.test(l))).toBe(true);
    expect(m.prod.listProduction().some((b) => b.id === out.batch.id)).toBe(true);
    expect(() => m.director.confirmPlan(r.plan!.id)).toThrow(/já foi executado/);
  });

  it('cancelar o plano: nada vira lote', () => {
    const c = m.conv.createConversation({ mode: 'ideia' });
    const r = say(c.id, '5 vídeos');
    const det = m.director.cancelPlan(r.plan!.id);
    expect(det.messages.find((x) => x.plan)?.plan?.state).toBe('cancelado');
    expect(m.prod.conversationBatches(c.id)).toEqual([]);
    expect(() => m.director.cancelPlan(r.plan!.id)).toThrow(/não está pendente/);
  });

  it('"Aprovar tudo automaticamente" (⚙): o plano executa sem clique e registra no log', () => {
    m.settings.patchSettings({ autoApprove: true });
    const c = m.conv.createConversation({ mode: 'ideia' });
    const r = say(c.id, '1 vídeo');
    expect(r.batch).not.toBeNull();
    expect(r.plan?.state).toBe('executado');
    expect(m.events.listEvents('conversation', c.id).some((e) => /executado automaticamente/.test(e.message))).toBe(true);
  });

  it('modo viral sem viral: NÃO monta plano, orienta a arrastar o viral', () => {
    const c = m.conv.createConversation({ mode: 'viral' });
    const r = say(c.id, 'faz 5');
    expect(r.plan).toBeNull();
    expect(r.conversation.messages.at(-1)?.text).toMatch(/arraste o vídeo viral/i);
  });

  it('pedido vazio é recusado; só anexo pede texto', () => {
    const c = m.conv.createConversation();
    expect(() => say(c.id, '   ')).toThrow(/Escreva o pedido/);
    const r = m.director.sendMessage(c.id, { text: '', attachments: [{ nome: 'a.png' }] });
    expect(r.plan).toBeNull();
    expect(r.conversation.messages.at(-1)?.text).toMatch(/Me conta/);
  });

  it('o plano do viral usa o viral da conversa e os avatares marcados no rodízio', () => {
    const v = m.viral.storeViral({ name: 'plano.mp4', bytes: mp4({ durationS: 16 }) }).viral;
    const a1 = m.avatar.createAvatar({ name: 'Ana', description: '', gender: 'mulher' });
    const a2 = m.avatar.createAvatar({ name: 'Bia', description: '', gender: 'mulher' });
    const c = m.conv.createConversation({ viralId: v.id });
    const r = say(c.id, 'quero igual, 3 vídeos');
    expect(r.plan!.steps[0].texto).toContain('plano');
    const b = m.director.confirmPlan(r.plan!.id).batch;
    expect(b).toMatchObject({ viralId: v.id, viralName: 'plano.mp4', quantity: 3 });
    expect(b.videos[0].scenesTotal).toBe(2); // 16 s → 2 cenas de 8 s
    expect(new Set(b.videos.map((x) => x.avatarName))).toEqual(new Set([a1.name, a2.name]));
    m.avatar.removeAvatar(a1.id);
    m.avatar.removeAvatar(a2.id);
  });
});

describe('Produção: lote → vídeos → cenas (simulação local com relógio controlado)', () => {
  const newBatch = (n: number, o: { viral?: boolean } = {}) => {
    const viral = o.viral ? m.viral.storeViral({ name: `prod${saltSeq}.mp4`, bytes: mp4({ durationS: 16 }) }).viral : null;
    const c = m.conv.createConversation({ mode: o.viral ? 'viral' : 'ideia', viralId: viral?.id });
    const p = say(c.id, `${n} vídeos`).plan!;
    return m.director.confirmPlan(p.id).batch;
  };

  it('progresso por cena e "vídeos simultâneos": só 2 geram ao mesmo tempo; terminam e liberam vaga', () => {
    m.settings.patchSettings({ parallel: 2 });
    const b = newBatch(3, { viral: true }); // 16 s → 2 cenas por vídeo
    advance(0);
    let cur = m.prod.getBatchDTO(b.id);
    expect(cur.state).toBe('rodando');
    expect(cur.videos.map((v) => v.state)).toEqual(['gerando', 'gerando', 'fila']);
    expect(cur.videos[0].scenes.map((s) => s.state)).toEqual(['gerando', 'fila']);

    advance(1000);
    cur = m.prod.getBatchDTO(b.id);
    expect(cur.videos[0]).toMatchObject({ scenesDone: 1, state: 'gerando' });
    expect(cur.videos[0].scenes.map((s) => s.state)).toEqual(['pronto', 'gerando']);

    advance(1000);
    cur = m.prod.getBatchDTO(b.id);
    expect(cur.videos.map((v) => v.state)).toEqual(['pronto', 'pronto', 'gerando']);
    advance(5000);
    cur = m.prod.getBatchDTO(b.id);
    expect(cur.state).toBe('pronto');
    expect(cur.videos.every((v) => v.state === 'pronto' && v.scenes.every((s) => s.state === 'pronto'))).toBe(true);
    const log = m.prod.batchEvents(b.id).map((e) => e.message);
    expect(log.some((l) => /Vídeo 1: cena 1\/2 pronta/.test(l))).toBe(true);
    expect(log.at(-1)).toMatch(/produção encerrada — 3\/3 prontos/);
  });

  it('cancelamento: esvazia a fila, o que já estava pronto fica; cancelar de novo não faz nada', () => {
    m.settings.patchSettings({ parallel: 1 });
    const b = newBatch(3);
    advance(0);
    advance(4000); // 4 cenas = vídeo 1 pronto; vídeo 2 começa
    advance(500);
    const c = m.prod.cancelBatch(b.id);
    expect(c.state).toBe('cancelado');
    expect(c.videos.map((v) => v.state)).toEqual(['pronto', 'cancelado', 'cancelado']);
    expect(c.videos[1].error).toMatch(/cancelado \(as cenas já prontas ficam guardadas\)/);
    expect(m.prod.cancelBatch(b.id).state).toBe('cancelado');
    advance(60000);
    expect(m.prod.getBatchDTO(b.id).videos.map((v) => v.state)).toEqual(['pronto', 'cancelado', 'cancelado']); // nada reavança
    expect(m.prod.listReadyGroups().some((g) => g.batchId === b.id)).toBe(true); // o pronto continua em Vídeos
  });

  it('"Parar depois dos atuais" → parado; "Continuar de onde parou" retoma', () => {
    m.settings.patchSettings({ parallel: 1 });
    const b = newBatch(2);
    advance(0);
    const s = m.prod.stopBatch(b.id);
    expect(s.stopRequested).toBe(true);
    advance(10000);
    let cur = m.prod.getBatchDTO(b.id);
    expect(cur.state).toBe('parado');
    expect(cur.videos.map((v) => v.state)).toEqual(['pronto', 'fila']);
    cur = m.prod.resumeBatch(b.id);
    expect(cur.stopRequested).toBe(false);
    advance(10000);
    expect(m.prod.getBatchDTO(b.id).state).toBe('pronto');
    expect(() => m.prod.resumeBatch(b.id)).toThrow(/não está parado/);
  });

  it('estado "falhou" (teste de falha ligado no ⚙): mostra a cena que falhou e "Regerar" refaz só o que faltou', () => {
    m.settings.patchSettings({ parallel: 2, simFailEvery: 2 });
    const b = newBatch(2);
    advance(0);
    advance(20000);
    let cur = m.prod.getBatchDTO(b.id);
    expect(cur.state).toBe('falhou');
    expect(cur.videos.map((v) => v.state)).toEqual(['pronto', 'falhou']);
    expect(cur.videos[1]).toMatchObject({ failScene: 1, scenesDone: 1 });
    expect(cur.videos[1].error).toMatch(/O Google não conseguiu terminar esta cena \(cena 2\) em 3 tentativas/);
    expect(cur.videos[1].scenes.map((s) => s.state)).toEqual(['pronto', 'falhou', 'fila', 'fila']);

    cur = m.prod.retryFailed(b.id);
    expect(cur.videos[1].state).toBe('gerando'); // a cena 1 pronta ficou; recomeça da 2
    expect(cur.videos[1].scenesDone).toBe(1);
    advance(20000);
    cur = m.prod.getBatchDTO(b.id);
    expect(cur.state).toBe('pronto');
    expect(m.prod.batchEvents(b.id).some((l) => /regerar todas as cenas com falha — 1 vídeo\(s\)/.test(l.message))).toBe(true);
    expect(() => m.prod.retryFailed(b.id)).toThrow(/Nenhum vídeo com falha/);
  });

  it('falha REAL: o arquivo do viral sumiu do disco → o vídeo falha com a causa, sem simular sucesso', () => {
    const b = newBatch(1, { viral: true });
    const viral = m.viralRepo.getViral(b.viralId!)!;
    fs.rmSync(path.join(m.config.VIRALS_DIR, `${viral.hash}.mp4`));
    advance(0);
    const cur = m.prod.getBatchDTO(b.id);
    expect(cur.videos[0].state).toBe('falhou');
    expect(cur.videos[0].error).toMatch(/arquivo do viral não está mais neste computador/);
  });

  it('simulação desligada (⚙): o lote fica na fila esperando o executor — nada avança sozinho', () => {
    m.settings.patchSettings({ simulation: false });
    const b = newBatch(1);
    advance(0);
    advance(100000);
    const cur = m.prod.getBatchDTO(b.id);
    expect(cur.state).toBe('na_fila');
    expect(cur.videos[0].state).toBe('fila');
    expect(m.prod.batchEvents(b.id).some((l) => /aguardando o executor do Flow \(fase futura\)/.test(l.message))).toBe(true);
  });

  it('aprovar lote → sai da Produção (os vídeos ficam em Vídeos); só depois de terminar', () => {
    const b = newBatch(1);
    advance(0);
    expect(() => m.prod.approveBatch(b.id)).toThrow(/Espere o lote terminar/);
    advance(20000);
    expect(m.prod.approveBatch(b.id).archived).toBe(true);
    expect(m.prod.listProduction().some((x) => x.id === b.id)).toBe(false);
    expect(m.prod.listReadyGroups().some((g) => g.batchId === b.id)).toBe(true);
  });

  it('descartar lote apaga vídeos e log; descartar vídeo remove só ele (e o lote vazio)', () => {
    const a = newBatch(2);
    advance(0);
    advance(20000);
    m.prod.removeVideo(m.prod.getBatchDTO(a.id).videos[0].id);
    expect(m.prod.getBatchDTO(a.id).videos).toHaveLength(1);
    m.prod.removeVideo(m.prod.getBatchDTO(a.id).videos[0].id);
    expect(() => m.prod.getBatchDTO(a.id)).toThrow(/Lote não encontrado/); // sem vídeos, o lote some

    const b = newBatch(1);
    expect(() => m.prod.removeVideo(m.prod.getBatchDTO(b.id).videos[0].id)).toThrow(/Cancele o lote/); // em andamento
    m.prod.discardBatch(b.id);
    expect(() => m.prod.batchEvents(b.id)).toThrow(/não encontrad/);
    expect(m.events.listEvents('batch', b.id)).toEqual([]);
  });

  it('Vídeos: só os prontos, por lote; download local com nome Nome_12345.mp4 (viral, ou clipe de teste sem viral)', () => {
    const c1 = m.conv.createConversation({ mode: 'ideia' });
    m.conv.patchConversation(c1.id, { options: { batchName: 'Umbigo' } });
    const semViral = m.director.confirmPlan(say(c1.id, '2 vídeos').plan!.id).batch;
    const comViral = newBatch(1, { viral: true });
    advance(0);
    advance(60000);

    const g = m.prod.listReadyGroups();
    const gSem = g.find((x) => x.batchId === semViral.id)!;
    expect(gSem.videos).toHaveLength(2);
    expect(gSem.videos[0].downloadName).toMatch(/^Umbigo_\d{5}\.mp4$/);
    expect(gSem.videos[0].downloadName).not.toBe(gSem.videos[1].downloadName); // "código diferente em cada vídeo"

    const mSem = m.prod.videoMedia(gSem.videos[0].id);
    expect(mSem.kind).toBe('bytes'); // sem viral: clipe de teste embutido
    expect(mSem.size).toBeGreaterThan(1000);
    const mVir = m.prod.videoMedia(g.find((x) => x.batchId === comViral.id)!.videos[0].id);
    expect(mVir.kind).toBe('file'); // com viral: o próprio arquivo local
    expect(fs.existsSync((mVir as { path: string }).path)).toBe(true);
  });

  it('vídeo que ainda não está pronto não baixa (409); "Baixar todos os prontos" vira zip com nomes únicos', async () => {
    const b = newBatch(2);
    expect(() => m.prod.videoMedia(b.videos[0].id)).toThrow(/ainda não está pronto/);
    expect(() => m.prod.readyZipEntries(b.id)).toThrow(/Nenhum vídeo pronto/);
    advance(0);
    advance(60000);
    const z = m.prod.readyZipEntries(b.id);
    expect(z.entries).toHaveLength(2);
    expect(new Set(z.entries.map((e) => e.name)).size).toBe(2);
    const buf = await zipToBuffer(z.entries);
    expect(new DataView(buf.buffer, buf.byteOffset).getUint32(0, true)).toBe(0x04034b50);
  });

  it('lote manual: viral + quantidade + caminho/variação/avatares; a roleta conta as combinações usadas', () => {
    const v = m.viral.storeViral({ name: 'manual.mp4', bytes: mp4() }).viral;
    const before = m.settings.getSettings().roletaUsed;
    const b = m.batch.createManualBatch({ viralId: v.id, quantity: 2, path: 'adaptar', variation: 'roleta', avatarIds: [], newAvatars: 2, options: { word: 'yes' }, notes: 'sem o copo' });
    expect(b).toMatchObject({ source: 'manual', state: 'na_fila', quantity: 2, word: 'yes', viralId: v.id, path: 'adaptar', variation: 'roleta', notes: 'sem o copo' });
    expect(b.videos.map((x) => x.avatarName)).toEqual(['Avatar novo 1', 'Avatar novo 2']);
    expect(m.settings.getSettings().roletaUsed).toBe(before + 2);
    expect(b.videos[0].scenes[0].fala).toMatch(/fala nova sobre o mesmo assunto/); // adaptar: sem IA, o texto diz isso
    expect(() => m.batch.createManualBatch({ viralId: 'x', quantity: 1, path: 'igual', variation: 'sem', avatarIds: [], newAvatars: 0, options: {}, notes: '' })).toThrow(/não encontrad/);
  });

  it('lotes de versão anterior (sem vídeos) são atualizados no bootstrap', () => {
    const legacy = m.batchRepo.insertBatch({ conversationId: null, viralId: null, source: 'manual', title: 'antigo', quantity: 2, word: '', batchName: '', bubbleOn: true, bubbleColor: '#FFC400', language: 'en', requestText: '', path: 'igual', variation: 'sem', avatars: [], notes: '' });
    expect(m.prod.materializeLegacyBatches()).toBeGreaterThanOrEqual(1);
    expect(m.prod.getBatchDTO(legacy.id).videos).toHaveLength(2);
    expect(m.prod.materializeLegacyBatches()).toBe(0); // idempotente
  });

  it('lote v1 "preparando" entra PARADO e nenhum tick o executa sem ação do usuário', () => {
    const db = globalThis.__zerumDb as import("better-sqlite3").Database;
    db.prepare("INSERT INTO batches (id, source, title, quantity, state) VALUES ('legacy-v1','manual','v1 preparando',3,'preparando')").run();
    expect(m.prod.materializeLegacyBatches()).toBeGreaterThanOrEqual(1);
    const row = m.batchRepo.getBatchRow('legacy-v1')!;
    expect(row).toMatchObject({ state: 'parado', stop_requested: 1 });
    // O primeiro GET (e todos os ticks seguintes, mesmo muito tempo depois) não podem iniciar nada.
    advance(0);
    advance(10 * 60_000);
    const dto = m.prod.getBatchDTO('legacy-v1');
    expect(dto.state).toBe('parado');
    expect(dto.videos).toHaveLength(3);
    expect(dto.videos.every((v) => v.state === 'fila' && v.scenesDone === 0)).toBe(true);
    expect(m.prod.batchEvents('legacy-v1').some((e) => /PARADO/.test(e.message))).toBe(true);
    // Só a ação do usuário ("Continuar de onde parou") põe o lote para rodar.
    m.prod.resumeBatch('legacy-v1');
    advance(0);
    expect(m.prod.getBatchDTO('legacy-v1').state).toBe('rodando');
  });

  it('palavra do comentário ACENTUADA no pedido chega ao lote (regressão: capturava "do")', () => {
    const c = m.conv.createConversation({ mode: 'ideia' });
    const r = say(c.id, 'quero 2 vídeos, palavra do comentário LINK');
    expect(r.plan!.params.word).toBe('LINK');
    const b = m.director.confirmPlan(r.plan!.id).batch;
    expect(b.word).toBe('LINK');
    expect(b.bubbleOn).toBe(true);
  });

  it('log de lote grande: a janela é das ÚLTIMAS linhas (a mais nova aparece), em ordem ascendente', () => {
    m.settings.patchSettings({ parallel: 4 });
    const b = newBatch(50, { viral: true });
    advance(0);
    for (let i = 0; i < 400; i++) advance(1000);
    expect(m.prod.getBatchDTO(b.id).state).toBe('pronto');
    // Garante >400 linhas mesmo que a simulação logue menos: enche o meio do log e fecha de novo.
    for (let i = 0; i < 455; i++) m.events.logEvent('batch', b.id, `linha de enchimento ${i}`);
    m.events.logEvent('batch', b.id, 'Lote: produção encerrada — 50/50 prontos.');
    const log = m.prod.batchEvents(b.id);
    expect(log).toHaveLength(400);
    expect(log[log.length - 1].message).toBe('Lote: produção encerrada — 50/50 prontos.');
    expect(log.map((e) => e.id)).toEqual([...log.map((e) => e.id)].sort((x, y) => x - y)); // ascendente
    expect(log.some((e) => /Lote criado/.test(e.message))).toBe(false); // a janela descartou o começo, não o fim
  });

  it('log de lote grande COM a simulação real: as últimas linhas são do fim da produção (vídeos finais + encerramento)', () => {
    m.settings.patchSettings({ parallel: 4 });
    const b = newBatch(50, { viral: true });
    advance(0);
    for (let i = 0; i < 400; i++) advance(1000);
    const all = (globalThis.__zerumDb as import('better-sqlite3').Database)
      .prepare("SELECT COUNT(*) AS n FROM events WHERE scope='batch' AND ref_id = ?")
      .get(b.id) as { n: number };
    const log = m.prod.batchEvents(b.id);
    expect(log.length).toBe(Math.min(400, all.n));
    expect(log[log.length - 1].message).toMatch(/produção encerrada — 50\/50/);
    expect(log.some((e) => /vídeo 50\b/i.test(e.message))).toBe(true);
  });
});

describe('virais (upload local real + leitura honesta)', () => {
  it('guarda em data/virais/<sha256>.mp4 com metadados REAIS (duração, dimensões, áudio) e análise local vazia', () => {
    const { viral, reused } = m.viral.storeViral({ name: 'REF viral.mp4', bytes: mp4({ durationS: 32, width: 1080, height: 1920 }) });
    expect(reused).toBe(false);
    expect(viral).toMatchObject({ name: 'REF viral.mp4', state: 'analisado', durationS: 32, width: 1080, height: 1920, hasAudio: true, corrected: false, gancho: '' });
    expect(viral.analysis).toMatchObject({ origem: 'local', pessoas: [], transcricao: '', estrutura: '', enquadramento: 'vertical 1080×1920' });
    expect(fs.readdirSync(m.config.VIRALS_DIR).some((f) => /^[0-9a-f]{64}\.mp4$/.test(f))).toBe(true);
    const log = m.viral.viralEvents(viral.id).map((e) => e.message);
    expect(log.some((l) => /somente neste computador/.test(l))).toBe(true);
    expect(log.some((l) => /duração 32 s · 1080×1920 · com faixa de áudio/.test(l))).toBe(true);
    expect(log.some((l) => /A IA do Diretor não assistiu o vídeo \(fase futura\)/.test(l))).toBe(true);
  });

  it('MP4 sem moov é guardado mesmo assim, sem inventar duração', () => {
    const bytes = Uint8Array.from([0, 0, 0, 0x18, 0x66, 0x74, 0x79, 0x70, 0x69, 0x73, 0x6f, 0x6d, 0, 0, 0, 0, saltSeq++, 0, 0, 0, 0, 0, 0, 0]);
    const { viral } = m.viral.storeViral({ name: 'sem-moov.mp4', bytes });
    expect(viral).toMatchObject({ durationS: null, width: null, hasAudio: null });
    expect(m.viral.viralEvents(viral.id).some((e) => /Não consegui ler os metadados/.test(e.message))).toBe(true);
  });

  it('o mesmo conteúdo não é guardado duas vezes (dedupe por hash)', () => {
    const bytes = mp4();
    const a = m.viral.storeViral({ name: 'a.mp4', bytes });
    const b = m.viral.storeViral({ name: 'outro-nome.mp4', bytes });
    expect(b.reused).toBe(true);
    expect(b.viral.id).toBe(a.viral.id);
  });

  it('recusa não-MP4, extensão errada, vazio e grande demais', () => {
    expect(() => m.viral.storeViral({ name: 'a.mp4', bytes: new Uint8Array(64) })).toThrow(/MP4 válido/);
    expect(() => m.viral.storeViral({ name: 'a.mov', bytes: mp4() })).toThrow(/\.mp4/);
    expect(() => m.viral.storeViral({ name: 'a.mp4', bytes: new Uint8Array(0) })).toThrow(/vazio/);
    expect(() => m.viral.storeViral({ name: 'a.mp4', bytes: { length: 61 * 1024 * 1024 } as unknown as Uint8Array })).toThrow(/60 MB/);
  });

  it('"A leitura errou? Corrigir": guarda a correção, deriva o gancho, mantém a original e "voltar à original" desfaz', () => {
    const v = m.viral.storeViral({ name: 'corrigir.mp4', bytes: mp4() }).viral;
    const fix = m.viral.correctAnalysis(v.id, {
      pessoas: [{ sexo: 'f', fala: true, descricao: 'mulher loira, 40 anos', roupa: 'vestido branco' }],
      rosto: true,
      legenda: true,
      tela: 'pátio de concreto',
      acoes: 'agacha e mostra o frasco',
      transcricao: 'Let me show you what actually works. Get a pot of water going.',
      estrutura: 'Hook (00:00 - 00:03)',
      enquadramento: 'vertical',
    });
    expect(fix).toMatchObject({ corrected: true, gancho: 'Let me show you what actually works.' });
    expect(fix.analysis).toMatchObject({ origem: 'corrigida', rosto: true });
    // 2ª correção não sobrescreve a original guardada
    m.viral.correctAnalysis(v.id, { ...fix.analysis!, estrutura: 'outra' });
    const back = m.viral.revertAnalysis(v.id);
    expect(back).toMatchObject({ corrected: false, gancho: '' });
    expect(back.analysis?.origem).toBe('local');
    expect(() => m.viral.revertAnalysis(v.id)).toThrow(/não tem correção/);
  });

  it('a transcrição corrigida alimenta o roteiro das cenas do lote (modo "Igual ao viral")', () => {
    const v = m.viral.storeViral({ name: 'fala.mp4', bytes: mp4({ durationS: 16 }) }).viral;
    m.viral.correctAnalysis(v.id, { pessoas: [], rosto: false, legenda: false, tela: '', acoes: '', transcricao: 'Primeira frase. Segunda frase.', estrutura: '', enquadramento: '' });
    const b = m.batch.createManualBatch({ viralId: v.id, quantity: 1, path: 'igual', variation: 'sem', avatarIds: [], newAvatars: 0, options: {}, notes: '' });
    expect(b.videos[0].scenes.map((s) => s.fala)).toEqual(['Primeira frase.', 'Segunda frase.']);
  });

  it('viralMedia aponta o arquivo local; some do disco → 404', () => {
    const v = m.viral.storeViral({ name: 'media.mp4', bytes: mp4() }).viral;
    const media = m.viral.viralMedia(v.id);
    expect(media.size).toBeGreaterThan(0);
    fs.rmSync(media.path);
    expect(() => m.viral.viralMedia(v.id)).toThrow(/não está mais neste computador/);
  });

  it('anexar a conversa vazia fica na mesma conversa e o Diretor anuncia os dados lidos; trocar com mensagens abre conversa NOVA', () => {
    const v1 = m.viral.storeViral({ name: 'v1.mp4', bytes: mp4({ durationS: 32 }) }).viral;
    const v2 = m.viral.storeViral({ name: 'v2.mp4', bytes: mp4() }).viral;
    const c = m.conv.createConversation();
    const a = m.conv.attachViral(c.id, v1.id);
    expect(a.id).toBe(c.id);
    expect(a.viral?.id).toBe(v1.id);
    expect(a.messages).toHaveLength(1);
    expect(a.messages[0]).toMatchObject({ role: 'diretor' });
    expect(a.messages[0].text).toMatch(/^Li os dados do viral "v1": 32 s · /);
    expect(a.messages[0].text).toMatch(/O que você quer fazer\?$/);
    expect(m.conv.attachViral(c.id, v1.id).messages).toHaveLength(1); // mesmo viral de novo: sem anúncio duplicado

    const plan = say(c.id, '3 vídeos').plan!;
    expect(plan.params.viralId).toBe(v1.id);
    const trocada = m.conv.attachViral(c.id, v2.id);
    expect(trocada.id).not.toBe(c.id); // "Trocar o viral abre uma conversa nova com ele"
    expect(trocada.viral?.id).toBe(v2.id);
    expect(m.conv.getDetail(c.id).viral?.id).toBe(v1.id);
  });

  it('trocar o viral numa conversa com mensagens aplica os OUTROS campos do PATCH (à conversa nova), sem descartar nada', () => {
    const v1 = m.viral.storeViral({ name: 'p1.mp4', bytes: mp4() }).viral;
    const v2 = m.viral.storeViral({ name: 'p2.mp4', bytes: mp4() }).viral;
    const c = m.conv.createConversation({ viralId: v1.id });
    say(c.id, '2 vídeos');
    const nova = m.conv.patchConversation(c.id, { viralId: v2.id, mode: 'ideia', title: 'Outro lote', options: { word: 'yes' } });
    expect(nova.id).not.toBe(c.id);
    expect(nova).toMatchObject({ mode: 'ideia', title: 'Outro lote', viral: { id: v2.id } });
    expect(nova.options.word).toBe('yes');
    expect(m.conv.getDetail(c.id)).toMatchObject({ viral: { id: v1.id }, mode: 'viral' });
    expect(m.conv.getDetail(c.id).options.word).toBe('');
  });

  it('nome longo (134 caracteres) com .mp4 é aceito: a extensão é validada antes do corte e preservada', () => {
    const longo = 'a'.repeat(130) + '.mp4';
    const { viral } = m.viral.storeViral({ name: longo, bytes: mp4() });
    expect(viral.name.length).toBe(120);
    expect(viral.name.endsWith('.mp4')).toBe(true);
    expect(() => m.viral.storeViral({ name: 'a'.repeat(130) + '.mov', bytes: mp4() })).toThrow(/.mp4/);
  });

  it('corrida no UNIQUE(hash): o arquivo do registro vencedor NÃO é apagado', () => {
    const bytes = mp4();
    const first = m.viral.storeViral({ name: 'w.mp4', bytes }).viral;
    const file = `${crypto.createHash('sha256').update(bytes).digest('hex')}.mp4`;
    expect(fs.existsSync(path.join(m.config.VIRALS_DIR, file))).toBe(true);
    const spy = vi.spyOn(m.viralRepo, 'getViralByHash').mockReturnValueOnce(undefined);
    const second = m.viral.storeViral({ name: 'w2.mp4', bytes });
    spy.mockRestore();
    expect(second.viral.id).toBe(first.id);
    expect(second.reused).toBe(true);
    expect(fs.existsSync(path.join(m.config.VIRALS_DIR, file))).toBe(true);
  });

  it('tirar o viral (null) mantém a conversa', () => {
    const v = m.viral.storeViral({ name: 'v3.mp4', bytes: mp4() }).viral;
    const c = m.conv.createConversation({ viralId: v.id });
    expect(m.conv.patchConversation(c.id, { viralId: null }).viral).toBeNull();
  });

  it('apagar o viral remove o arquivo e solta as referências sem apagar lotes/conversas', () => {
    const v = m.viral.storeViral({ name: 'v4.mp4', bytes: mp4() }).viral;
    const c = m.conv.createConversation({ viralId: v.id });
    const before = fs.readdirSync(m.config.VIRALS_DIR).length;
    m.viral.removeViral(v.id);
    expect(fs.readdirSync(m.config.VIRALS_DIR).length).toBe(before - 1);
    expect(m.conv.getDetail(c.id).viral).toBeNull();
    expect(() => m.viral.removeViral(v.id)).toThrow(/não encontrad/);
  });

  it('virais de versão anterior (sem análise) recebem os metadados no bootstrap', () => {
    const v = m.viral.storeViral({ name: 'legado.mp4', bytes: mp4({ durationS: 20 }) }).viral;
    globalThis.__zerumDb!.prepare('UPDATE virals SET analysis = NULL, duration_s = NULL WHERE id = ?').run(v.id);
    expect(m.viral.backfillViralMeta()).toBeGreaterThanOrEqual(1);
    expect(m.viral.getViralDTO(v.id)).toMatchObject({ durationS: 20, state: 'analisado' });
  });
});

describe('avatares (biblioteca local com foto)', () => {
  it('CRUD com sexo e descrição; criar sem foto é "Sem foto"', () => {
    const a = m.avatar.createAvatar({ name: 'Loretta', description: 'enfermeira', gender: 'mulher' });
    expect(a).toMatchObject({ gender: 'mulher', hasPhoto: false, origin: 'manual' });
    expect(m.avatar.listAllAvatars().some((x) => x.id === a.id)).toBe(true);
    expect(m.avatar.editAvatar(a.id, { name: 'Loretta B.', description: '', gender: 'homem' })).toMatchObject({ name: 'Loretta B.', gender: 'homem' });
    m.avatar.removeAvatar(a.id);
    expect(() => m.avatar.removeAvatar(a.id)).toThrow(/não encontrad/);
  });

  it('"Enviar minha foto": valida pelo conteúdo, guarda em data/avatares/<sha256>.<ext> e dá nome pelo arquivo', () => {
    const a = m.avatar.createAvatarFromPhoto({ fileName: 'maria_silva.png', bytes: PNG(1) });
    expect(a).toMatchObject({ name: 'maria silva', hasPhoto: true, origin: 'foto', gender: '' });
    const p = m.avatar.avatarPhoto(a.id);
    expect(p.mime).toBe('image/png');
    expect(fs.existsSync(p.path)).toBe(true);
    expect(path.dirname(p.path)).toBe(m.config.AVATARS_DIR);
    expect(() => m.avatar.createAvatarFromPhoto({ fileName: 'x.png', bytes: new TextEncoder().encode('<svg/>') })).toThrow(/não é uma foto/);
    m.avatar.removeAvatar(a.id);
    expect(fs.existsSync(p.path)).toBe(false); // ninguém mais usa a foto: sai do disco
  });

  it('foto compartilhada só sai do disco quando o último avatar que a usa é apagado; trocar a foto remove a antiga', () => {
    const a = m.avatar.createAvatarFromPhoto({ fileName: 'a.png', bytes: PNG(2) });
    const b = m.avatar.createAvatarFromPhoto({ fileName: 'b.png', bytes: PNG(2) });
    const file = m.avatar.avatarPhoto(a.id).path;
    m.avatar.removeAvatar(a.id);
    expect(fs.existsSync(file)).toBe(true);
    const trocado = m.avatar.replacePhoto(b.id, PNG(3));
    expect(trocado.hasPhoto).toBe(true);
    expect(fs.existsSync(file)).toBe(false);
    m.avatar.removeAvatar(b.id);
  });

  it('"Gerar N": cria N cartões SEM foto (o rosto gerado é fase futura) e avisa no log', () => {
    const made = m.avatar.generateAvatars(4);
    expect(made).toHaveLength(4);
    expect(made.every((x) => !x.hasPhoto && x.origin === 'gerado')).toBe(true);
    expect(m.events.listRecentEvents('app', m.events.APP_LOG_REF, 5).some((e) => /fase futura/.test(e.message))).toBe(true);
    expect(m.avatar.removeAvatars(made.map((x) => x.id))).toBe(4);
    expect(() => m.avatar.removeAvatars([])).toThrow(/Marque pelo menos um/);
  });

  it('"Baixar todos (zip)": foto de cada avatar (arquivo = nome) + avatares.json; sem avatares → 404', async () => {
    for (const x of m.avatar.listAllAvatars()) m.avatar.removeAvatar(x.id);
    expect(() => m.avatar.avatarsZipEntries()).toThrow(/Nenhum avatar salvo pra baixar/);
    m.avatar.createAvatarFromPhoto({ fileName: 'Ana.png', bytes: PNG(4) });
    m.avatar.createAvatar({ name: 'Sem Foto', description: 'x', gender: 'mulher' });
    const entries = m.avatar.avatarsZipEntries();
    expect(entries.map((e) => e.name)).toEqual(['Ana.png', 'avatares.json']);
    const zip = await zipToBuffer(entries);
    const text = Buffer.from(zip).toString('latin1');
    expect(text).toContain('"nome": "Sem Foto"');
    expect(text).toContain('"foto": null');
  });
});

describe('configurações, feedback e ponte', () => {
  it('padrões do original (troca automática desligada, 20 créditos, 4 simultâneos, Nano Banana Pro, legenda #FFFF00) e persistência', () => {
    const s = m.settings.getSettings();
    expect(s).toMatchObject({ autoSwitch: false, minCredits: 20, imageModel: 'Nano Banana Pro', flowCopy: true, autoApprove: false, apiKeyMasked: null });
    expect(s.subtitle).toMatchObject({ color: '#FFFF00', words: 3, position: 'embaixo', saved: false });
    m.settings.patchSettings({ parallel: 4 }); // padrão do original
    expect(m.settings.getSettings().parallel).toBe(4);
    expect(m.settings.patchSettings({ minCredits: 35, autoSwitch: true })).toMatchObject({ autoSwitch: true, minCredits: 35 });
    m.settings.patchSettings({ minCredits: 20, autoSwitch: false });
  });

  it('valida simultâneos e modelo de imagem; legenda salva como padrão persiste normalizada', () => {
    expect(() => m.settings.patchSettings({ parallel: 9 })).toThrow(/de 1 a 4/);
    expect(() => m.settings.patchSettings({ imageModel: 'Inventado' })).toThrow(/desconhecido/);
    const s = m.settings.patchSettings({ subtitle: { color: '22d3ee', font: 'Anton', saved: true } });
    expect(s.subtitle).toMatchObject({ color: '#22D3EE', font: 'Anton', saved: true, words: 3 });
  });

  it('chave própria: guardada só no banco, a leitura devolve só "••••1234"; apagar remove', () => {
    expect(() => m.settings.saveApiKey('curta')).toThrow(/chave inteira/);
    const s = m.settings.saveApiKey('sk-segredo-1234');
    expect(s.apiKeyMasked).toBe('••••1234');
    expect(JSON.stringify(m.settings.getSettings())).not.toContain('segredo');
    expect(m.settings.removeApiKey().apiKeyMasked).toBeNull();
  });

  it('feedback fica só no banco local', () => {
    expect(m.feedback.sendFeedback({ kind: 'bug', text: 'algo quebrou' }).id).toBeTruthy();
  });

  it('ponte: executor nulo → sempre desligada; é substituível (fase futura)', async () => {
    expect((await m.bridge.getBridgeStatus()).ready).toBe(false);
    m.bridge.setExecutor({
      status: async () => ({ ready: true, pending: 1, detail: '', checklist: { extensionInstalled: true, extensionConnected: true, flowTabOpen: true, accountChosen: true } }),
      accounts: async () => [],
      submit: async () => {
        throw new Error('x');
      },
      get: async () => null,
      reconcile: async () => null,
    });
    expect((await m.bridge.getBridgeStatus()).ready).toBe(true);
  });
});
