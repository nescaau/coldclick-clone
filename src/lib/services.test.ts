/**
 * Testes de integração dos serviços sobre um banco SQLite REAL em pasta temporária:
 * fila/runner (estado "parcial" por interrupção, reenfileirar), transcrição (órfã no boot, cancelar,
 * excluir), exclusão de vídeo, cópia derivada das cenas, chaves Gemini (hash) e heartbeat (TTL).
 */
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { randomBytes } from 'node:crypto';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

let dir: string;
type Mods = {
  db: typeof import('./db');
  jobs: typeof import('./services/job-service');
  runner: typeof import('./services/job-runner');
  jobItems: typeof import('./repo/job-items');
  jobsRepo: typeof import('./repo/jobs');
  videos: typeof import('./repo/videos');
  videoSvc: typeof import('./services/video-service');
  transcription: typeof import('./services/transcription-service');
  events: typeof import('./repo/job-events');
  keys: typeof import('./services/gemini-key-service');
  ext: typeof import('./services/extension-service');
  boot: typeof import('./services/bootstrap');
  avatars: typeof import('./services/avatar-service');
  settings: typeof import('./services/settings-service');
};
let m: Mods;

beforeAll(async () => {
  dir = fs.mkdtempSync(path.join(process.env.TMPDIR ?? os.tmpdir(), 'cc-svc-'));
  process.env.COLDCLICK_DATA_DIR = dir;
  process.env.COLDCLICK_SECRET_KEY = randomBytes(32).toString('base64');
  process.env.COLDCLICK_SIM_FAILURE_RATE = '0';
  process.env.COLDCLICK_SIM_SPEED = '0.0001';
  m = {
    db: await import('./db'),
    jobs: await import('./services/job-service'),
    runner: await import('./services/job-runner'),
    jobItems: await import('./repo/job-items'),
    jobsRepo: await import('./repo/jobs'),
    videos: await import('./repo/videos'),
    videoSvc: await import('./services/video-service'),
    transcription: await import('./services/transcription-service'),
    events: await import('./repo/job-events'),
    keys: await import('./services/gemini-key-service'),
    ext: await import('./services/extension-service'),
    boot: await import('./services/bootstrap'),
    avatars: await import('./services/avatar-service'),
    settings: await import('./services/settings-service'),
  };
  m.boot.ensureBootstrapped();
});

afterAll(() => {
  m.db.getDb().close();
  globalThis.__coldclickDb = undefined;
  fs.rmSync(dir, { recursive: true, force: true });
});

let videoSeq = 0;
function newVideo(): string {
  const id = `video-${++videoSeq}`;
  m.videos.insertVideoRow({ id, originalName: `${id}.mp4`, filePath: `videos/${id}.mp4`, mime: 'video/mp4', sizeBytes: 1, durationSec: 5, source: 'upload', sourceUrl: null });
  return id;
}

const baseInput = (videoId: string, extra: Record<string, unknown> = {}) =>
  ({ videoId, avatarIds: [], product: null, creativeFormat: 'original-recipe', scriptMode: 'keep', outputLanguage: 'original', axes: { outfit: { mode: 'original', value: '' }, scenery: { mode: 'original', value: '' }, object: { mode: 'original', value: '' } }, imageModel: 'nano-banana-2.1', cta: '', transcript: '', transcriptSource: 'none', scenes: [], copyText: 'olá', model: 'veo-3.1-lite', resolution: '720p', ...extra }) as import('./schemas').CreateJobInput;

/** Avança o executor até o trabalho terminar (relógio simulado, sem esperar de verdade). */
function runUntilDone(jobId: string, maxTicks = 200) {
  for (let i = 1; i <= maxTicks; i++) {
    m.runner.runTick(Date.now() + i * 60_000);
    const j = m.jobs.getJob(jobId);
    if (!['queued', 'running'].includes(j.status)) return j;
  }
  throw new Error('trabalho não terminou');
}

describe('fila e executor', () => {
  it('trabalho normal conclui', () => {
    const job = m.jobs.createJob(baseInput(newVideo()));
    expect(runUntilDone(job.id).status).toBe('completed');
  });

  it('teto de gerações esgotado → "parcial" com 0 vídeos e 0 falhas (interrupção, não falha)', () => {
    const job = m.jobs.createJob(baseInput(newVideo()));
    m.db.getDb().prepare('UPDATE jobs SET max_generations = 1 WHERE id = ?').run(job.id);
    const done = runUntilDone(job.id);
    expect(done.status).toBe('partial');
    expect(done.videosDone).toBe(0);
    expect(done.videosFailed).toBe(0);
    expect(done.imagesFailed).toBe(0);
    expect(done.error).toMatch(/interrompida/i);
    expect(done.events.some((e) => /interrompida/i.test(e.label))).toBe(true);
    expect(done.items.find((i) => i.kind === 'video')?.status).toBe('cancelled');
  });

  it('reexecutar retoma os itens interrompidos e conclui', () => {
    const job = m.jobs.createJob(baseInput(newVideo()));
    m.db.getDb().prepare('UPDATE jobs SET max_generations = 1 WHERE id = ?').run(job.id);
    expect(runUntilDone(job.id).status).toBe('partial');
    m.jobs.retryFailedItems(job.id);
    expect(runUntilDone(job.id).status).toBe('completed');
  });

  it('critério de "reexecutável" é único: isRetryableItem (UI) == itens que resetFailedItems devolve a pendente', async () => {
    const { isRetryableItem, INTERRUPTED_ERROR } = await import('./format');
    expect(m.jobsRepo.INTERRUPTED_ERROR).toBe(INTERRUPTED_ERROR);
    expect(isRetryableItem({ status: 'failed', error: 'x' })).toBe(true);
    expect(isRetryableItem({ status: 'cancelled', error: INTERRUPTED_ERROR })).toBe(true);
    expect(isRetryableItem({ status: 'cancelled', error: null })).toBe(false); // cancelamento genérico
    expect(isRetryableItem({ status: 'done', error: null })).toBe(false);
    const job = m.jobs.createJob(baseInput(newVideo()));
    m.jobs.cancelJob(job.id); // itens cancelled sem INTERRUPTED_ERROR
    const generic = m.jobs.getJob(job.id).items;
    expect(generic.every((i) => !isRetryableItem(i))).toBe(true);
    expect(m.jobsRepo.resetFailedItems(job.id)).toBe(0);
    const interrupted = m.jobs.createJob(baseInput(newVideo()));
    m.db.getDb().prepare('UPDATE jobs SET max_generations = 1 WHERE id = ?').run(interrupted.id);
    const done = runUntilDone(interrupted.id);
    const retryable = done.items.filter(isRetryableItem).length;
    expect(retryable).toBeGreaterThan(0);
    expect(m.jobsRepo.resetFailedItems(interrupted.id)).toBe(retryable);
  });

  it('reenfileirar põe o trabalho no FIM da fila (não fura a vez de quem já esperava)', async () => {
    const a = m.jobs.createJob(baseInput(newVideo()));
    m.db.getDb().prepare('UPDATE jobs SET max_generations = 1 WHERE id = ?').run(a.id);
    runUntilDone(a.id); // a: parcial
    const b = m.jobs.createJob(baseInput(newVideo())); // b entra na fila depois de a ter sido criado…
    await new Promise((r) => setTimeout(r, 5));
    m.jobs.retryFailedItems(a.id); // …mas a é reenfileirado DEPOIS de b
    expect(m.jobItems.findOldestQueuedJob()?.id).toBe(b.id);
  });

  it('cancelar é atômico: trabalho e itens abertos mudam juntos', () => {
    const job = m.jobs.createJob(baseInput(newVideo()));
    const cancelled = m.jobs.cancelJob(job.id);
    expect(cancelled.status).toBe('cancelled');
    expect(cancelled.items.every((i) => i.status === 'cancelled')).toBe(true);
    expect(() => m.jobs.cancelJob(job.id)).toThrow(/Só é possível cancelar/);
  });

  it('copyText é DERIVADO das cenas (o valor enviado pelo cliente é ignorado)', () => {
    const job = m.jobs.createJob(
      baseInput(newVideo(), { copyText: 'texto divergente do cliente', scenes: [{ index: 1, start: 0, end: 2, text: 'Cena A.' }, { index: 2, start: 2, end: 4, text: 'Cena B.' }] }),
    );
    expect(job.copyText).toBe('Cena A.\n\nCena B.');
  });
});

describe('transcrição como trabalho', () => {
  it('transcrição "em andamento" órfã é marcada como falha no boot, com evento', () => {
    const video = newVideo();
    const id = 'transc-orfa';
    m.jobsRepo.insertTranscriptionJob({ id, title: 'Transcrição · órfã', videoId: video, language: 'original', defaultModel: 'veo-3.1-lite' });
    m.events.addJobEvent(id, 'Transcrição solicitada');
    expect(m.jobs.getJob(id).status).toBe('running');
    expect(m.transcription.recoverStuckTranscriptions(0)).toBeGreaterThanOrEqual(1);
    const job = m.jobs.getJob(id);
    expect(job.status).toBe('failed');
    expect(job.error).toMatch(/reiniciado/);
    expect(job.events.some((e) => e.status === 'failed')).toBe(true);
  });

  it('recuperação no boot ignora transcrição recente (outro processo no mesmo banco) e pega a antiga', () => {
    const video = newVideo();
    m.jobsRepo.insertTranscriptionJob({ id: 'transc-viva', title: 'Transcrição · viva', videoId: video, language: 'original', defaultModel: 'veo-3.1-lite' });
    expect(m.transcription.recoverStuckTranscriptions()).toBe(0);
    expect(m.jobs.getJob('transc-viva').status).toBe('running');
    const old = new Date(Date.now() - m.transcription.TRANSCRIPTION_STALE_MS - 60_000).toISOString();
    m.db.getDb().prepare('UPDATE jobs SET started_at = ? WHERE id = ?').run(old, 'transc-viva');
    expect(m.transcription.recoverStuckTranscriptions()).toBe(1);
    expect(m.jobs.getJob('transc-viva').status).toBe('failed');
  });

  it('varredura periódica (fora do boot): recupera órfã > 15 min e NÃO derruba transcrição legítima em andamento', () => {
    const insert = (id: string) =>
      m.jobsRepo.insertTranscriptionJob({ id, title: id, videoId: newVideo(), language: 'original', defaultModel: 'veo-3.1-lite' });
    const startedAgo = (id: string, ms: number) =>
      m.db.getDb().prepare('UPDATE jobs SET started_at = ? WHERE id = ?').run(new Date(Date.now() - ms).toISOString(), id);
    insert('sweep-orfa');
    startedAgo('sweep-orfa', m.transcription.TRANSCRIPTION_STALE_MS + 60_000); // órfã: iniciada há 16 min
    insert('sweep-viva');
    startedAgo('sweep-viva', 5 * 60_000); // legítima: iniciada há 5 min
    insert('sweep-local');
    startedAgo('sweep-local', m.transcription.TRANSCRIPTION_STALE_MS + 60_000); // antiga, mas com controlador NESTE processo
    globalThis.__coldclickTranscriptions = new Map([['sweep-local', new AbortController()]]);
    try {
      globalThis.__coldclickTranscriptionSweepAt = undefined;
      const t0 = Date.now();
      expect(m.transcription.sweepStuckTranscriptions(t0)).toBe(1);
      expect(m.jobs.getJob('sweep-orfa').status).toBe('failed');
      expect(m.jobs.getJob('sweep-orfa').events.some((e) => e.status === 'failed')).toBe(true);
      expect(m.jobs.getJob('sweep-viva').status).toBe('running');
      expect(m.jobs.getJob('sweep-local').status).toBe('running');
      // limitada por intervalo: nova chamada logo em seguida não varre; depois do intervalo, varre de novo
      expect(m.transcription.sweepStuckTranscriptions(t0 + 1_000)).toBe(0);
      // 5 min + 11 min depois, a "viva" também passou do prazo (a varredura só olha o relógio e o status)
      expect(m.transcription.sweepStuckTranscriptions(t0 + 11 * 60_000 + m.transcription.TRANSCRIPTION_SWEEP_INTERVAL_MS)).toBe(1);
      expect(m.jobs.getJob('sweep-viva').status).toBe('failed');
      expect(m.jobs.getJob('sweep-local').status).toBe('running'); // continua protegida pelo controlador
    } finally {
      globalThis.__coldclickTranscriptions = undefined;
      globalThis.__coldclickTranscriptionSweepAt = undefined;
      m.jobsRepo.failTranscriptionJob('sweep-local', 'limpeza do teste');
    }
  });

  it('cancelar uma transcrição em andamento a marca como cancelada', () => {
    const video = newVideo();
    m.jobsRepo.insertTranscriptionJob({ id: 'transc-cancel', title: 'T', videoId: video, language: 'original', defaultModel: 'veo-3.1-lite' });
    expect(m.jobs.cancelJob('transc-cancel').status).toBe('cancelled');
    expect(() => m.jobs.cancelJob('transc-cancel')).toThrow(/em andamento/);
  });

  it('excluir transcrição em andamento não falha por FK e é seguro mesmo com evento tardio', () => {
    const video = newVideo();
    m.jobsRepo.insertTranscriptionJob({ id: 'transc-del', title: 'T', videoId: video, language: 'original', defaultModel: 'veo-3.1-lite' });
    m.events.addJobEvent('transc-del', 'Transcrição solicitada');
    m.jobs.removeJob('transc-del');
    expect(() => m.events.addJobEvent('transc-del', 'Áudio enviado ao serviço de transcrição')).not.toThrow(); // evento tardio: ignorado
    expect(() => m.jobs.getJob('transc-del')).toThrow(/não encontrado/);
  });

  it('a conclusão tardia não ressuscita transcrição cancelada', () => {
    const video = newVideo();
    m.jobsRepo.insertTranscriptionJob({ id: 'transc-late', title: 'T', videoId: video, language: 'original', defaultModel: 'veo-3.1-lite' });
    m.jobs.cancelJob('transc-late');
    expect(m.jobsRepo.completeTranscriptionJob('transc-late', 'texto', '[]')).toBe(false);
    expect(m.jobsRepo.failTranscriptionJob('transc-late', 'erro')).toBe(false);
    expect(m.jobs.getJob('transc-late').status).toBe('cancelled');
  });
});

describe('exclusão de vídeo', () => {
  it('vídeo transcrito (com trabalhos de transcrição) PODE ser excluído; a transcrição some junto', () => {
    const video = newVideo();
    m.jobsRepo.insertTranscriptionJob({ id: `t-${video}`, title: 'T', videoId: video, language: 'original', defaultModel: 'veo-3.1-lite' });
    m.jobs.cancelJob(`t-${video}`);
    expect(() => m.videoSvc.removeVideo(video)).not.toThrow();
    expect(m.videos.findVideoRow(video)).toBeNull();
    expect(() => m.jobs.getJob(`t-${video}`)).toThrow(/não encontrado/);
  });

  it('vídeo usado por um trabalho de GERAÇÃO continua protegido', () => {
    const video = newVideo();
    m.jobs.createJob(baseInput(video));
    expect(() => m.videoSvc.removeVideo(video)).toThrow(/usado por 1 trabalho/);
  });

  it('excluir vídeo com transcrição EM ANDAMENTO também funciona', () => {
    const video = newVideo();
    m.jobsRepo.insertTranscriptionJob({ id: `run-${video}`, title: 'T', videoId: video, language: 'original', defaultModel: 'veo-3.1-lite' });
    expect(() => m.videoSvc.removeVideo(video)).not.toThrow();
  });
});

describe('chaves Gemini', () => {
  const KEY_A = 'AIzaSyAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA';
  const KEY_B = 'AIzaSyBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBB';

  it('detecta duplicadas por HMAC (sem decifrar) e respeita o limite', () => {
    expect(m.keys.addGeminiKeys(`${KEY_A}\n${KEY_B}`)).toEqual({ added: 2, skipped: 0 });
    expect(m.keys.addGeminiKeys(`${KEY_A}`)).toEqual({ added: 0, skipped: 1 });
    expect(m.keys.listGeminiKeys()).toHaveLength(2);
    expect(JSON.stringify(m.keys.listGeminiKeys())).not.toContain('AIzaSyAAAA'); // segredo nunca sai
  });

  it('migra chaves legadas em texto puro: criptografa, preenche o hash e remove repetidas', () => {
    const db = m.db.getDb();
    db.prepare('DELETE FROM gemini_keys').run();
    const legacy = 'AIzaSyLEGACYLEGACYLEGACYLEGACYLEGACY1';
    db.prepare(`INSERT INTO gemini_keys (id, api_key, key_last4, position) VALUES ('l1', ?, 'CY1', 1), ('l2', ?, 'CY1', 2)`).run(legacy, legacy);
    m.keys.encryptLegacyGeminiKeys();
    const rows = db.prepare('SELECT api_key, key_hash FROM gemini_keys').all() as { api_key: string; key_hash: string }[];
    expect(rows).toHaveLength(1); // a duplicada legada foi removida
    expect(rows[0].api_key.startsWith('enc:v1:')).toBe(true);
    expect(rows[0].key_hash).toMatch(/^[0-9a-f]{64}$/);
    expect(m.keys.addGeminiKeys(legacy)).toEqual({ added: 0, skipped: 1 }); // e o hash já protege contra nova duplicata
    expect(m.keys.acquireGeminiKey()?.apiKey).toBe(legacy);
  });
});

describe('heartbeat da extensão', () => {
  function pairBrowser() {
    m.ext.createPairingCode('Chrome de teste');
    const code = m.ext.getExtensionOverview().pairingCode!.code;
    const { token } = m.ext.completePairing({ code });
    return m.ext.authenticateBrowser(`Bearer ${token}`)!;
  }

  it('heartbeat SEM o campo do Flow preserva o último estado válido; expira por TTL', () => {
    const browser = pairBrowser();
    m.ext.registerHeartbeat(browser, { flowSessionActive: true, flowAccountEmail: 'Conta@Gmail.com' });
    expect(m.ext.getExtensionOverview().flowSessionActive).toBe(true);

    const again = m.ext.authenticateBrowser(`Bearer ${'x'}`); // token inválido → null (sanidade)
    expect(again).toBeNull();

    const fresh = m.db.getDb().prepare('SELECT * FROM extension_browsers WHERE id = ?').get(browser.id) as typeof browser;
    m.ext.registerHeartbeat(fresh, { version: '1.0.1' }); // sem campos do Flow
    const after = m.ext.getExtensionOverview();
    expect(after.flowSessionActive).toBe(true);
    expect(after.browsers[0].flowAccountEmail).toBe('conta@gmail.com');
    expect(after.browsers[0].version).toBe('1.0.1');

    // Passado o TTL, o estado antigo deixa de valer.
    const old = new Date(Date.now() - m.ext.FLOW_STATE_TTL_MS - 1000).toISOString();
    m.db.getDb().prepare('UPDATE extension_browsers SET flow_reported_at = ? WHERE id = ?').run(old, browser.id);
    expect(m.ext.getExtensionOverview().flowSessionActive).toBe(false);

    // Um heartbeat que traz o campo explicitamente como false desliga na hora.
    m.ext.registerHeartbeat(fresh, { flowSessionActive: false });
    expect(m.ext.getExtensionOverview().flowSessionActive).toBe(false);
  });
});

describe('avatares', () => {
  it('semeia a biblioteca global (Dawn, sem fotos) uma única vez', () => {
    const all = m.avatars.listAvatars();
    const global = all.filter((a) => a.scope === 'global');
    expect(global.map((a) => a.name)).toEqual(['Dawn']);
    expect(global[0]).toMatchObject({ gender: 'female', age: 53, photos: [] });
    m.avatars.seedAvatarsOnce();
    expect(m.avatars.listAvatars().filter((a) => a.scope === 'global')).toHaveLength(1);
  });

  it('remover avatar apaga as fotos do disco só depois do commit e é atômico', async () => {
    const photo = new File([new Uint8Array([1, 2, 3])], 'foto.png', { type: 'image/png' });
    const created = await m.avatars.createAvatar({ name: 'Teste', description: 'A test person', photos: [photo] });
    const file = path.join(dir, 'storage', created.photos[0].url.replace(/^\/api\/files\//, ''));
    expect(fs.existsSync(file)).toBe(true);
    m.avatars.removeAvatar(created.id);
    expect(fs.existsSync(file)).toBe(false);
    expect(() => m.avatars.removeAvatar(created.id)).toThrow(/não encontrado/);
  });
});

describe('troca da pasta de armazenamento', () => {
  it('é recusada enquanto houver trabalho em fila ou em andamento', async () => {
    const job = m.jobs.createJob(baseInput(newVideo()));
    expect(job.status).toBe('queued');
    const target = path.join(dir, 'outra-pasta');
    await expect(m.settings.updateSettings({ storageDir: target })).rejects.toThrow(/enquanto houver trabalhos em fila ou em andamento/);
    expect(m.settings.getPublicSettings().storageDirIsDefault).toBe(true); // nada foi gravado
    expect(fs.existsSync(path.join(target, 'videos'))).toBe(false);
  });
});
