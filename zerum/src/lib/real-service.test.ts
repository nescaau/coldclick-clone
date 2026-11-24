/**
 * Execução REAL no servidor (reserva de cenas, resultado, montagem, falhas, retomada) sobre um SQLite de verdade em
 * pasta temporária. O relógio é controlado (Date.now simulado) e as "extensões" são simuladas pelos dados que chegam
 * (a cadeia completa com a extensão de verdade está em extensao/test/chain.test.mjs).
 */
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { afterAll, afterEach, beforeAll, describe, expect, it, vi } from 'vitest';
import { buildMp4 } from './domain/mp4-fixture';
import { buildClip } from './domain/mp4-concat-fixture';
import { readMp4Tracks } from './domain/mp4-concat';
import { zipToBuffer } from './domain/zip';

const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'zerum-real-'));
process.env.ZERUM_DATA_DIR = dir;
process.env.ZERUM_SIM_SCENE_MS = '1000';

type Mods = {
  conv: typeof import('./services/conversation-service');
  director: typeof import('./services/director-service');
  prod: typeof import('./services/production-service');
  viral: typeof import('./services/viral-service');
  avatar: typeof import('./services/avatar-service');
  settings: typeof import('./services/settings-service');
  bridge: typeof import('./services/bridge-service');
  real: typeof import('./services/real-service');
  files: typeof import('./services/flow-files');
  videosRepo: typeof import('./repo/videos');
  config: typeof import('./config');
};
let m: Mods;
let clock = 1_800_000_000_000;
const advance = (ms: number) => (clock += ms);

const ANA = 'ana@gmail.com';
const BIA = 'bia@gmail.com';
const P = '11111111-1111-4111-8111-111111111111';
const account = (email: string, o: Record<string, unknown> = {}) => ({ accountId: email, email, projectId: P, accountPath: '', credits: 200, online: true, cooldownUntil: 0, paused: false, pending: 0, uncertain: false, ...o });
const ready = (accounts = [account(ANA)], pumpId = 'p1') =>
  m.bridge.reportHeartbeat({
    pumpId,
    status: { ready: true, pending: 0, detail: 'Flow ligado', version: '0.1.0', checklist: { extensionInstalled: true, extensionConnected: true, flowTabOpen: true, accountChosen: true }, accounts },
  });

let seq = 1;
const clipBytes = (o: Partial<Parameters<typeof buildClip>[0]> = {}) => buildClip({ videoFrames: 25, audioFrames: 40, seed: seq++, ...o }).bytes;

/** Lote com `quantity` vídeos de `scenes` cenas, com a fala preenchida (a transcrição do viral). */
function mkBatch(o: { quantity?: number; scenes?: number; transcript?: string; notes?: string } = {}) {
  const scenes = o.scenes ?? 2;
  const viral = m.viral.storeViral({ name: `real${seq++}.mp4`, bytes: buildMp4({ durationS: scenes * 8, salt: seq }) }).viral;
  if (o.transcript !== '') {
    m.viral.correctAnalysis(viral.id, {
      pessoas: [], rosto: true, legenda: false, tela: 'cozinha clara', acoes: 'ela mostra o frasco', enquadramento: 'vertical',
      transcricao: o.transcript ?? Array.from({ length: scenes }, (_, i) => `Frase número ${i + 1} do viral.`).join(' '),
      estrutura: '',
    });
  }
  // Direto pelo serviço (o Diretor guardaria o texto do pedido inteiro como "observações", o que mascararia a cena sem fala).
  return m.prod.openBatch({
    conversationId: null,
    viralId: viral.id,
    source: 'manual',
    title: `Lote ${seq}`,
    requestText: '',
    params: { quantity: o.quantity ?? 1, path: 'igual', variation: 'sem', language: 'en', word: '', batchName: 'Real', bubbleOn: true, bubbleColor: '#FFC400', notes: o.notes ?? '', newAvatars: 0 },
    avatarNames: [],
  });
}
const claim = (o: { pumpId?: string; accountId?: string; available?: string[] } = {}) => m.real.claimWork({ pumpId: o.pumpId ?? 'p1', accountId: o.accountId ?? ANA, available: o.available ?? [ANA] });
const work = (r: ReturnType<typeof claim>) => {
  if (!r.work) throw new Error(`sem trabalho: ${r.reason}`);
  return r.work;
};
const video = (id: string) => m.prod.getBatchDTO(id).videos;
const state = (batchId: string) => m.prod.getBatchDTO(batchId);

beforeAll(async () => {
  vi.spyOn(Date, 'now').mockImplementation(() => clock);
  const { ensureBootstrapped } = await import('./services/bootstrap');
  ensureBootstrapped();
  m = {
    conv: await import('./services/conversation-service'),
    director: await import('./services/director-service'),
    prod: await import('./services/production-service'),
    viral: await import('./services/viral-service'),
    avatar: await import('./services/avatar-service'),
    settings: await import('./services/settings-service'),
    bridge: await import('./services/bridge-service'),
    real: await import('./services/real-service'),
    files: await import('./services/flow-files'),
    videosRepo: await import('./repo/videos'),
    config: await import('./config'),
  };
});

afterEach(() => {
  m.settings.patchSettings({ simulation: true, simFailEvery: 0, parallel: 2, autoSwitch: false, minCredits: 20 });
  m.bridge.resetBridge();
  m.bridge.setExecutor(null);
  // cada teste parte de um banco sem lotes (os vídeos reais "gerando" de um teste não podem ocupar vaga no seguinte)
  for (const b of m.prod.listAllBatches()) m.prod.discardBatch(b.id);
});

afterAll(() => {
  vi.restoreAllMocks();
  globalThis.__zerumDb?.close();
  globalThis.__zerumDb = undefined;
  fs.rmSync(dir, { recursive: true, force: true });
});

describe('modo de execução: simulado | real | espera', () => {
  it('simulação ligada (⚙) → "simulado", mesmo com a extensão pronta: nada é gerado de verdade', () => {
    ready();
    expect(m.bridge.executionMode(clock)).toBe('simulado');
    mkBatch();
    expect(claim()).toMatchObject({ work: null, reason: 'SIMULACAO_LIGADA', mode: 'simulado' });
  });

  it('simulação desligada e SEM extensão → "espera": fila + EXTENSAO_NAO_INSTALADA, nada avança', async () => {
    m.settings.patchSettings({ simulation: false });
    const b = mkBatch();
    expect(m.bridge.executionMode(clock)).toBe('espera');
    expect(claim()).toMatchObject({ work: null, reason: 'EXTENSAO_NAO_CONECTADA', mode: 'espera' });
    m.prod.tickBatches(clock);
    advance(60_000);
    m.prod.tickBatches(clock);
    expect(state(b.id)).toMatchObject({ state: 'na_fila' });
    expect(video(b.id)[0].state).toBe('fila');
    const st = await m.bridge.getBridgeStatus();
    expect(st).toMatchObject({ ready: false });
    expect(st.detail).toMatch(/^EXTENSAO_NAO_INSTALADA;/);
    expect(m.prod.batchEvents(b.id).some((l) => /aguardando o executor do Flow \(EXTENSAO_NAO_INSTALADA/.test(l.message))).toBe(true);
  });

  it('simulação desligada + extensão pronta → "real"; o retrato da extensão vale 15 s (depois volta a "espera")', async () => {
    m.settings.patchSettings({ simulation: false });
    ready();
    expect(m.bridge.executionMode(clock)).toBe('real');
    expect((await m.bridge.getBridgeStatus()).ready).toBe(true);
    advance(14_999);
    expect(m.bridge.executionMode(clock)).toBe('real');
    advance(2);
    expect(m.bridge.executionMode(clock)).toBe('espera');
    expect((await m.bridge.getBridgeStatus()).detail).toMatch(/^EXTENSAO_NAO_INSTALADA|^Flow ligado/); // sem retrato fresco não afirma "ligado"
    expect((await m.bridge.getBridgeStatus()).ready).toBe(false);
  });

  it('extensão instalada mas o Flow NÃO está pronto → "espera" (não gasta nada)', () => {
    m.settings.patchSettings({ simulation: false });
    m.bridge.reportHeartbeat({ pumpId: 'p1', status: { ready: false, pending: 0, detail: 'Entre na sua conta Google no Flow.', checklist: { extensionInstalled: true, extensionConnected: true, flowTabOpen: true, accountChosen: false }, accounts: [] } });
    expect(m.bridge.executionMode(clock)).toBe('espera');
  });

  it('só a aba LÍDER executa; outra aba espera até a líder sumir (20 s)', () => {
    m.settings.patchSettings({ simulation: false });
    expect(ready([account(ANA)], 'p1').leader).toBe(true);
    expect(ready([account(ANA)], 'p2').leader).toBe(false);
    mkBatch();
    expect(claim({ pumpId: 'p2' })).toMatchObject({ work: null, reason: 'OUTRA_ABA_EXECUTANDO' });
    advance(21_000);
    expect(ready([account(ANA)], 'p2').leader).toBe(true);
    expect(claim({ pumpId: 'p2' }).work).not.toBeNull();
  });

  it('a mensagem do Diretor ao confirmar o plano diz a verdade sobre o modo (simulado | espera | real)', () => {
    const confirmed = () => {
      const c = m.conv.createConversation({ mode: 'ideia' });
      const r = m.director.sendMessage(c.id, { text: '1 vídeo', attachments: [] });
      return m.director.confirmPlan(r.plan!.id).conversation.messages.at(-1)!.text;
    };
    expect(confirmed()).toMatch(/A geração está SIMULADA .*\(selo SIMULADO\)/);
    expect(confirmed()).not.toMatch(/fase futura|próxima fase/);

    m.settings.patchSettings({ simulation: false });
    expect(confirmed()).toMatch(/Sem a extensão do Flow conectada \(EXTENSAO_NAO_INSTALADA\), o lote fica na fila e nada é enviado a lugar nenhum/);

    ready();
    const real = confirmed();
    expect(real).toMatch(/cada cena será gerada de verdade na sua conta \(gasta crédito do Flow\)/);
    expect(real).not.toMatch(/SIMULAD/);
  });

  it('com a simulação ligada o tick SIMULA como sempre e marca SIMULADO; real e simulado convivem', () => {
    const b = mkBatch();
    m.prod.tickBatches(clock);
    advance(30_000);
    m.prod.tickBatches(clock);
    expect(video(b.id)[0]).toMatchObject({ state: 'pronto', simulated: true });
    expect(m.prod.videoMedia(video(b.id)[0].id).kind).toMatch(/file|bytes/); // cópia do viral
  });
});

describe('reservar cenas (claim)', () => {
  it('uma cena por vez: prompt com a fala, 9:16, job/chave estáveis, conta fixada; vídeo e lote passam a "gerando"', () => {
    m.settings.patchSettings({ simulation: false });
    ready();
    const b = mkBatch({ scenes: 2 });
    const w = work(claim());
    expect(w).toMatchObject({ sceneIdx: 0, sceneCount: 2, attempt: 0, accountId: ANA, resume: false, reference: null, label: 'Vídeo 1 · cena 1/2' });
    expect(w.jobId).toBe(`cena:${w.videoId}:0`);
    expect(w.opKey).toMatch(/^[0-9a-f]{64}$/);
    expect(w.args).toMatchObject({ aspectRatio: '9:16', durationSeconds: 8 });
    expect(w.args.prompt).toContain('"Frase número 1 do viral."'); // a fala da CENA 1 (não a do vídeo inteiro)
    expect(w.args.prompt).not.toContain('Frase número 2');
    expect(w.args.prompt).toMatch(/cozinha clara/);
    expect(video(b.id)[0]).toMatchObject({ state: 'gerando', attempt: 1 });
    expect(state(b.id).state).toBe('rodando');
    expect(m.prod.batchEvents(b.id).some((l) => /começou a gerar de verdade no Flow/.test(l.message))).toBe(true);
  });

  it('a mesma aba não recebe a cena em voo de novo (reserva); outra cena de OUTRO vídeo só se houver vaga', () => {
    m.settings.patchSettings({ simulation: false, parallel: 1 });
    ready();
    mkBatch({ quantity: 2 });
    const w = work(claim());
    expect(claim()).toMatchObject({ work: null, reason: 'LIMITE_SIMULTANEOS' }); // 1 simultâneo: o 2º vídeo espera
    expect(w.sceneIdx).toBe(0);
    m.settings.patchSettings({ parallel: 2 });
    const w2 = work(claim());
    expect(w2.videoId).not.toBe(w.videoId);
  });

  it('as cenas de um vídeo são em SEQUÊNCIA: a cena 2 só aparece depois que a 1 tem MP4', () => {
    m.settings.patchSettings({ simulation: false, parallel: 1 });
    ready();
    mkBatch({ scenes: 3 });
    const w1 = work(claim());
    expect(claim().work).toBeNull();
    m.real.acceptClip({ videoId: w1.videoId, idx: 0, pumpId: 'p1', orderId: 'o1', mediaRef: 'm1', bytes: clipBytes() });
    const w2 = work(claim());
    expect(w2).toMatchObject({ videoId: w1.videoId, sceneIdx: 1, resume: false });
    expect(w2.opKey).not.toBe(w1.opKey);
  });

  it('sem conta escolhida pela página: espera (SEM_CONTA_ESCOLHIDA), sem iniciar nada', () => {
    m.settings.patchSettings({ simulation: false });
    ready();
    const b = mkBatch();
    expect(claim({ accountId: '' })).toMatchObject({ work: null, reason: 'SEM_CONTA_ESCOLHIDA' });
    expect(video(b.id)[0].state).toBe('fila');
  });

  it('cena SEM fala (transcrição vazia, sem observações): o vídeo falha ANTES de gastar crédito, com a explicação; o próximo vídeo segue', () => {
    m.settings.patchSettings({ simulation: false });
    ready();
    const vazio = mkBatch({ transcript: '' });
    const bom = mkBatch();
    const w = work(claim());
    expect(video(vazio.id)[0]).toMatchObject({ state: 'falhou' });
    expect(video(vazio.id)[0].error).toMatch(/não tem o que falar/);
    expect(video(vazio.id)[0].error).toMatch(/nenhum crédito foi gasto/);
    expect(w.batchId).toBe(bom.id);
    expect(m.prod.batchEvents(vazio.id).some((l) => l.level === 'erro' && /FALHOU/.test(l.message))).toBe(true);
  });

  it('observações do pedido servem de assunto quando a transcrição está vazia', () => {
    m.settings.patchSettings({ simulation: false });
    ready();
    mkBatch({ transcript: '', notes: 'falar do creme noturno' });
    expect(work(claim()).args.prompt).toMatch(/about: .*creme noturno/);
  });

  it('avatar com foto: a cena leva a referência (a página busca a foto); sem foto: só a descrição', () => {
    m.settings.patchSettings({ simulation: false });
    ready();
    const png = new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, ...new Uint8Array(40).fill(1)]);
    const a = m.avatar.createAvatarFromPhoto({ fileName: 'Ana Silva.png', bytes: png });
    m.avatar.editAvatar(a.id, { name: 'Ana Silva', description: 'enfermeira', gender: 'mulher' });
    const viral = m.viral.storeViral({ name: `av${seq++}.mp4`, bytes: buildMp4({ durationS: 8, salt: seq }) }).viral;
    m.viral.correctAnalysis(viral.id, { pessoas: [], rosto: true, legenda: false, tela: '', acoes: '', transcricao: 'Oi, tudo bem?', estrutura: '', enquadramento: '' });
    const batch = m.prod.openBatch({
      conversationId: null, viralId: viral.id, source: 'manual', title: 'Com avatar', requestText: '',
      params: { quantity: 1, path: 'igual', variation: 'sem', language: 'en', word: '', batchName: 'Av', bubbleOn: true, bubbleColor: '#FFC400', notes: '', newAvatars: 0 },
      avatarNames: ['Ana Silva'],
    });
    const w = work(claim());
    expect(w.batchId).toBe(batch.id);
    expect(w.reference).toMatchObject({ avatarId: a.id, mimeType: 'image/png', name: 'Ana Silva.png' });
    expect(w.args.prompt).toMatch(/same one as in the reference image/);
  });
});

describe('resultado: clipe → cena pronta → vídeo pronto (MP4 do Flow, não cópia)', () => {
  it('2 cenas: as duas viram UM MP4 (cenas juntadas); o vídeo fica PRONTO sem selo SIMULADO e o download é esse arquivo', async () => {
    m.settings.patchSettings({ simulation: false });
    ready();
    const b = mkBatch({ scenes: 2 });
    const a = clipBytes({ seed: 11 });
    const c = clipBytes({ seed: 22, videoFrames: 30, audioFrames: 50 });
    const w1 = work(claim());
    const r1 = m.real.acceptClip({ videoId: w1.videoId, idx: 0, pumpId: 'p1', orderId: 'ord-1', mediaRef: 'tile-1', bytes: a });
    expect(r1.finished).toBe(false);
    expect(video(b.id)[0]).toMatchObject({ state: 'gerando', scenesDone: 1 });
    const w2 = work(claim());
    const r2 = m.real.acceptClip({ videoId: w2.videoId, idx: 1, pumpId: 'p1', orderId: 'ord-2', mediaRef: 'tile-2', bytes: c });
    expect(r2.finished).toBe(true);

    const v = video(b.id)[0];
    expect(v).toMatchObject({ state: 'pronto', scenesDone: 2, simulated: false, error: '' });
    expect(state(b.id).state).toBe('pronto');
    expect(v.scenes.map((s) => s.state)).toEqual(['pronto', 'pronto']);

    const media = m.prod.videoMedia(v.id);
    expect(media.kind).toBe('file');
    const out = new Uint8Array(fs.readFileSync((media as { path: string }).path));
    const [vt, at] = readMp4Tracks(out);
    expect(vt.samples).toHaveLength(25 + 30); // todas as amostras de vídeo das duas cenas
    expect(at.samples).toHaveLength(40 + 50);
    expect(media.name).toMatch(/_\d{5}\.mp4$/);
    expect(m.prod.batchEvents(b.id).some((l) => /PRONTO \(2 cenas\) — MP4 baixado do Flow \(conta ana@gmail\.com\)/.test(l.message) && /cenas juntadas/.test(l.message))).toBe(true);
    expect(m.prod.batchEvents(b.id).every((l) => !/simulação local\./.test(l.message) || !/PRONTO/.test(l.message))).toBe(true);

    // "Baixar todos os prontos": o zip leva o MP4 real
    const z = m.prod.readyZipEntries(b.id);
    expect(z.entries).toHaveLength(1);
    const zip = await zipToBuffer(z.entries);
    expect(zip.length).toBeGreaterThan(out.length);
  });

  it('1 cena: o vídeo final É o próprio clipe (nada é regravado)', () => {
    m.settings.patchSettings({ simulation: false });
    ready();
    const b = mkBatch({ scenes: 1 });
    const clip = clipBytes();
    const w = work(claim());
    expect(m.real.acceptClip({ videoId: w.videoId, idx: 0, pumpId: 'p1', orderId: 'o', mediaRef: 't', bytes: clip }).finished).toBe(true);
    const media = m.prod.videoMedia(video(b.id)[0].id) as { path: string; size: number };
    expect(new Uint8Array(fs.readFileSync(media.path))).toEqual(clip);
    expect(m.prod.getBatchDTO(b.id).videos[0].simulated).toBe(false);
  });

  it('arquivos em data/flow/<sha256>.mp4 (nome = hash do conteúdo; o mesmo clipe não é guardado duas vezes)', () => {
    m.settings.patchSettings({ simulation: false });
    ready();
    mkBatch({ scenes: 1 });
    const clip = clipBytes();
    const w = work(claim());
    m.real.acceptClip({ videoId: w.videoId, idx: 0, pumpId: 'p1', orderId: 'o', mediaRef: 't', bytes: clip });
    const files = fs.readdirSync(m.config.FLOW_DIR);
    expect(files.every((f) => /^[0-9a-f]{64}\.mp4$/.test(f))).toBe(true);
    expect(m.files.storeClip(clip).hash + '.mp4').toBe(files.find((f) => f.startsWith(m.files.storeClip(clip).hash)));
  });

  it('clipe inválido é recusado e nada avança: vazio, não-MP4, grande demais, aba errada, cena que não está em voo', () => {
    m.settings.patchSettings({ simulation: false });
    ready();
    const b = mkBatch({ scenes: 2 });
    const w = work(claim());
    const base = { videoId: w.videoId, idx: 0, pumpId: 'p1', orderId: 'o', mediaRef: 't' };
    expect(() => m.real.acceptClip({ ...base, bytes: new Uint8Array(0) })).toThrow(/vazio/);
    expect(() => m.real.acceptClip({ ...base, bytes: new Uint8Array(100) })).toThrow(/não parece um MP4/);
    expect(() => m.real.acceptClip({ ...base, bytes: new Uint8Array(m.real.MAX_CLIP_BYTES + 1) })).toThrow(/passa de/);
    expect(() => m.real.acceptClip({ ...base, pumpId: 'outra', bytes: clipBytes() })).toThrow(/não está mais com esta aba/);
    expect(() => m.real.acceptClip({ ...base, idx: 1, bytes: clipBytes() })).toThrow(/não está mais com esta aba/); // a cena 2 ainda nem começou
    expect(() => m.real.acceptClip({ ...base, videoId: 'nao-existe', bytes: clipBytes() })).toThrow(/não encontrad/);
    expect(video(b.id)[0].scenesDone).toBe(0);
  });

  it('clipes de formatos DIFERENTES não viram um arquivo meio certo: o vídeo falha com a causa e as cenas ficam guardadas (0 crédito para tentar juntar de novo)', () => {
    m.settings.patchSettings({ simulation: false, parallel: 1 });
    ready();
    const b = mkBatch({ scenes: 2 });
    const w1 = work(claim());
    m.real.acceptClip({ videoId: w1.videoId, idx: 0, pumpId: 'p1', orderId: 'o1', mediaRef: 't1', bytes: clipBytes({ width: 720, height: 1280 }) });
    const w2 = work(claim());
    const r = m.real.acceptClip({ videoId: w2.videoId, idx: 1, pumpId: 'p1', orderId: 'o2', mediaRef: 't2', bytes: clipBytes({ width: 1080, height: 1920 }) });
    expect(r.finished).toBe(false);
    const v = video(b.id)[0];
    expect(v.state).toBe('falhou');
    expect(v.error).toMatch(/foram geradas e baixadas, mas não consegui juntá-las/);
    expect(v.error).toMatch(/0 crédito/);
    expect(v.scenes.map((s) => s.state)).toEqual(['pronto', 'pronto']); // as cenas ficam
    // refazer não gera nada de novo: só tenta juntar (e falha de novo, com o mesmo motivo)
    m.prod.retryFailed(b.id);
    expect(claim().work).toBeNull();
    expect(video(b.id)[0].state).toBe('falhou');
  });
});

describe('falhas, troca de conta, cancelar, parar e retomar', () => {
  it('cota (429) SEM troca automática: o vídeo falha dizendo a conta e a hora da volta; o lote encerra com falha', () => {
    m.settings.patchSettings({ simulation: false });
    ready();
    const b = mkBatch({ scenes: 2 });
    const w = work(claim());
    const until = clock + 24 * 3600_000;
    const r = m.real.failScene({ videoId: w.videoId, idx: 0, pumpId: 'p1', orderId: 'o1', code: 'COTA', message: 'quota', kind: 'cota', retryAt: until });
    expect(r.requeued).toBe(false);
    const v = video(b.id)[0];
    expect(v).toMatchObject({ state: 'falhou', failScene: 0 });
    expect(v.error).toMatch(/A conta do Flow ana@gmail\.com atingiu a cota e fica em pausa até amanhã \d{2}:\d{2} — cena 1/); // 24 h depois = amanhã (nunca só "HH:mm", que pareceria minutos)
    expect(v.error).toMatch(/não troca de conta sozinho para furar a cota/);
    expect(state(b.id).state).toBe('falhou');
  });

  it('cota COM troca automática: a cena volta à fila (tentativa +1) e OUTRA conta a refaz — sem gastar a conta pausada', () => {
    m.settings.patchSettings({ simulation: false, autoSwitch: true });
    ready([account(ANA), account(BIA)]);
    const b = mkBatch({ scenes: 2 });
    const w = work(claim({ accountId: ANA, available: [ANA, BIA] }));
    const first = m.real.failScene({ videoId: w.videoId, idx: 0, pumpId: 'p1', orderId: 'o1', code: 'COTA', message: 'q', kind: 'cota', retryAt: clock + 86_400_000 });
    expect(first.requeued).toBe(true);
    expect(video(b.id)[0].state).toBe('fila');
    expect(m.prod.batchEvents(b.id).some((l) => l.level === 'aviso' && /A troca automática vai tentar outra conta/.test(l.message))).toBe(true);
    const again = work(claim({ accountId: BIA, available: [BIA] }));
    expect(again).toMatchObject({ videoId: w.videoId, sceneIdx: 0, attempt: 1, accountId: BIA, resume: false });
    expect(again.opKey).not.toBe(w.opKey); // outra tentativa = outra chave (a ordem antiga ficou terminal na extensão)
  });

  it('falha comum (conteúdo recusado) NÃO troca de conta: o vídeo falha com a causa; "Tentar de novo" mantém as cenas prontas', () => {
    m.settings.patchSettings({ simulation: false, autoSwitch: true, parallel: 1 });
    ready();
    const b = mkBatch({ scenes: 2 });
    const w1 = work(claim());
    m.real.acceptClip({ videoId: w1.videoId, idx: 0, pumpId: 'p1', orderId: 'o1', mediaRef: 't1', bytes: clipBytes() });
    const w2 = work(claim());
    const f = m.real.failScene({ videoId: w2.videoId, idx: 1, pumpId: 'p1', orderId: 'o2', code: 'CONTEUDO_RECUSADO', message: 'blocked', kind: 'outro' });
    expect(f.requeued).toBe(false);
    expect(video(b.id)[0]).toMatchObject({ state: 'falhou', failScene: 1, scenesDone: 1 });
    expect(video(b.id)[0].error).toMatch(/recusou o conteúdo da cena 2/);

    m.prod.retryFailed(b.id);
    expect(video(b.id)[0]).toMatchObject({ state: 'fila', scenesDone: 1 }); // a cena 1 (com MP4) ficou
    const again = work(claim());
    expect(again).toMatchObject({ videoId: w1.videoId, sceneIdx: 1, attempt: 1 }); // só a que falhou é gerada de novo
    expect(m.prod.batchEvents(b.id).some((l) => /retomando da cena 2/.test(l.message))).toBe(true);
  });

  it('cancelar agora: a aba é mandada parar (continue:false) e o que o Flow devolver depois é IGNORADO', () => {
    m.settings.patchSettings({ simulation: false });
    ready();
    const b = mkBatch({ scenes: 1 });
    const w = work(claim());
    expect(m.real.sceneProgress({ videoId: w.videoId, idx: 0, pumpId: 'p1', orderId: 'o1' })).toEqual({ continue: true, reason: '' });
    m.prod.cancelBatch(b.id);
    expect(m.real.sceneProgress({ videoId: w.videoId, idx: 0, pumpId: 'p1', orderId: 'o1' })).toMatchObject({ continue: false, reason: 'VIDEO_NAO_ESTA_GERANDO' });
    expect(() => m.real.acceptClip({ videoId: w.videoId, idx: 0, pumpId: 'p1', orderId: 'o1', mediaRef: 't', bytes: clipBytes() })).toThrow(/foi cancelado/);
    expect(video(b.id)[0].state).toBe('cancelado');
    expect(claim().work).toBeNull(); // nada novo sai do lote cancelado
  });

  it('"Parar depois dos atuais": o vídeo em voo termina; nenhum vídeo novo começa', () => {
    m.settings.patchSettings({ simulation: false, parallel: 1 });
    ready();
    const b = mkBatch({ quantity: 2, scenes: 1 });
    const w = work(claim());
    m.prod.stopBatch(b.id);
    m.real.acceptClip({ videoId: w.videoId, idx: 0, pumpId: 'p1', orderId: 'o', mediaRef: 't', bytes: clipBytes() });
    expect(video(b.id).map((v) => v.state)).toEqual(['pronto', 'fila']);
    expect(claim().work).toBeNull();
    expect(state(b.id).state).toBe('parado');
    m.prod.resumeBatch(b.id);
    expect(work(claim()).sceneIdx).toBe(0);
  });

  it('aba recarregada (nova aba líder): a cena em voo volta COM A MESMA CHAVE (resume:true) — nunca uma geração nova', () => {
    m.settings.patchSettings({ simulation: false });
    ready([account(ANA)], 'p1');
    mkBatch({ scenes: 2 });
    const w = work(claim({ pumpId: 'p1' }));
    m.real.sceneProgress({ videoId: w.videoId, idx: 0, pumpId: 'p1', orderId: 'ord-9' });
    advance(21_000);
    ready([account(ANA)], 'p2'); // a aba antiga sumiu; a nova assume
    const back = work(claim({ pumpId: 'p2' }));
    expect(back).toMatchObject({ videoId: w.videoId, sceneIdx: 0, resume: true, opKey: w.opKey, attempt: 0, accountId: ANA });
    expect(back.args.prompt).toBe(w.args.prompt); // o pedido é IDÊNTICO (senão o broker recusaria a chave)
  });

  it('retomar exige a conta onde a ordem nasceu: se ela não está disponível, espera (não manda para outra conta)', () => {
    m.settings.patchSettings({ simulation: false });
    ready([account(ANA), account(BIA)], 'p1');
    mkBatch({ scenes: 2 });
    const w = work(claim({ pumpId: 'p1', accountId: ANA, available: [ANA, BIA] }));
    advance(21_000);
    ready([account(BIA)], 'p2');
    const r = claim({ pumpId: 'p2', accountId: BIA, available: [BIA] });
    expect(r.work).toBeNull();
    expect(r.reason).toMatch(/^CONTA_DA_CENA_INDISPONIVEL/);
    expect(video(m.prod.listProduction()[0].id)[0].state).toBe('gerando');
    expect(w.accountId).toBe(ANA);
  });

  it('progresso: guarda o id da ordem e renova a reserva; outra aba com reserva válida é mandada parar', () => {
    m.settings.patchSettings({ simulation: false });
    ready();
    mkBatch({ scenes: 1 });
    const w = work(claim());
    expect(m.real.sceneProgress({ videoId: w.videoId, idx: 0, pumpId: 'p1', orderId: 'ord-1' }).continue).toBe(true);
    expect(m.real.sceneProgress({ videoId: w.videoId, idx: 0, pumpId: 'intrusa', orderId: 'x' })).toMatchObject({ continue: false, reason: 'OUTRA_ABA_ASSUMIU' });
    expect(m.real.sceneProgress({ videoId: 'nao-existe', idx: 0, pumpId: 'p1', orderId: '' })).toMatchObject({ continue: false, reason: 'VIDEO_REMOVIDO' });
    expect(m.real.sceneProgress({ videoId: w.videoId, idx: 5, pumpId: 'p1', orderId: '' }).continue).toBe(false);
  });
});

describe('convivência com a simulação e limpeza', () => {
  it('ligar a simulação no meio de um vídeo REAL não o "simula": o tick só mexe nos vídeos simulados', () => {
    m.settings.patchSettings({ simulation: false });
    ready();
    const b = mkBatch({ scenes: 1 });
    work(claim());
    m.settings.patchSettings({ simulation: true });
    advance(60_000);
    m.prod.tickBatches(clock);
    expect(video(b.id)[0]).toMatchObject({ state: 'gerando', simulated: false });
  });

  it('↻ Tentar de novo num vídeo que falhou no Flow, com a simulação ligada, vira simulado (não fica parado na fila)', () => {
    m.settings.patchSettings({ simulation: false });
    ready();
    const b = mkBatch({ scenes: 1 });
    const w = work(claim());
    m.real.failScene({ videoId: w.videoId, idx: 0, pumpId: 'p1', orderId: 'o', code: 'FLOW_FALHOU', message: 'x', kind: 'outro' });
    m.settings.patchSettings({ simulation: true });
    m.prod.retryFailed(b.id);
    advance(30_000);
    m.prod.tickBatches(clock);
    expect(video(b.id)[0]).toMatchObject({ state: 'pronto', simulated: true });
  });

  it('descartar o vídeo/lote apaga os clipes do disco (só os que ninguém mais usa)', () => {
    m.settings.patchSettings({ simulation: false });
    ready();
    const b = mkBatch({ scenes: 1 });
    const clip = clipBytes();
    const w = work(claim());
    m.real.acceptClip({ videoId: w.videoId, idx: 0, pumpId: 'p1', orderId: 'o', mediaRef: 't', bytes: clip });
    const file = m.files.flowFilePath(m.files.storeClip(clip).hash);
    expect(fs.existsSync(file)).toBe(true);
    m.prod.discardBatch(b.id);
    expect(fs.existsSync(file)).toBe(false);
  });

  it('vídeo pronto cujo arquivo sumiu do disco: conflito claro (nunca uma cópia disfarçada)', () => {
    m.settings.patchSettings({ simulation: false });
    ready();
    const b = mkBatch({ scenes: 1 });
    const w = work(claim());
    m.real.acceptClip({ videoId: w.videoId, idx: 0, pumpId: 'p1', orderId: 'o', mediaRef: 't', bytes: clipBytes() });
    const media = m.prod.videoMedia(video(b.id)[0].id) as { path: string };
    fs.rmSync(media.path);
    expect(() => m.prod.videoMedia(video(b.id)[0].id)).toThrow(/não está mais neste computador/);
  });

  it('migração v3: vídeos antigos continuam "sim" (simulated) e sem estado real', () => {
    const b = mkBatch({ scenes: 1 });
    const row = m.videosRepo.getVideoRow(video(b.id)[0].id)!;
    expect(row).toMatchObject({ mode: 'sim', real_json: '' });
    expect(video(b.id)[0].simulated).toBe(true);
  });
});
