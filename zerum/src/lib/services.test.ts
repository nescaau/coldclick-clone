/**
 * Testes de integração dos serviços sobre um SQLite REAL numa pasta temporária (ZERUM_DATA_DIR).
 * Os módulos são importados dinamicamente: config.ts lê a variável de ambiente no momento do import.
 */
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import crypto from 'node:crypto';
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';

const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'zerum-test-'));
process.env.ZERUM_DATA_DIR = dir;

type Mods = {
  conv: typeof import('./services/conversation-service');
  batch: typeof import('./services/batch-service');
  viral: typeof import('./services/viral-service');
  avatar: typeof import('./services/avatar-service');
  settings: typeof import('./services/settings-service');
  bridge: typeof import('./services/bridge-service');
  feedback: typeof import('./services/feedback-service');
  events: typeof import('./repo/events');
  viralRepo: typeof import('./repo/virals');
  config: typeof import('./config');
};
let m: Mods;

const mp4 = (extra = 0) => {
  const b = new Uint8Array(64 + extra);
  b.set([0, 0, 0, 0x18, 0x66, 0x74, 0x79, 0x70, 0x69, 0x73, 0x6f, 0x6d]);
  b[40] = extra % 251; // conteúdo distinto → hash distinto
  b[41] = Math.floor(extra / 251) % 251;
  return b;
};

beforeAll(async () => {
  const { ensureBootstrapped } = await import('./services/bootstrap');
  ensureBootstrapped();
  m = {
    conv: await import('./services/conversation-service'),
    batch: await import('./services/batch-service'),
    viral: await import('./services/viral-service'),
    avatar: await import('./services/avatar-service'),
    settings: await import('./services/settings-service'),
    bridge: await import('./services/bridge-service'),
    feedback: await import('./services/feedback-service'),
    events: await import('./repo/events'),
    viralRepo: await import('./repo/virals'),
    config: await import('./config'),
  };
});

afterAll(() => {
  globalThis.__zerumDb?.close();
  globalThis.__zerumDb = undefined;
  fs.rmSync(dir, { recursive: true, force: true });
});

describe('banco próprio', () => {
  it('cria data/zerum.db na pasta configurada (sem tocar em nenhum outro banco)', () => {
    expect(m.config.DB_PATH).toBe(path.join(dir, 'zerum.db'));
    expect(fs.existsSync(m.config.DB_PATH)).toBe(true);
    expect(path.basename(m.config.DB_PATH)).toBe('zerum.db');
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
  });

  it('opções persistem sanitizadas; a cor escolhida vira padrão das próximas conversas', () => {
    const c = m.conv.createConversation();
    const r = m.conv.patchConversation(c.id, { options: { word: 'Quero!', batchName: 'Ação 1', bubbleColor: '#3b82f6', language: 'es', bubbleOn: false } });
    expect(r.options).toEqual({ word: 'Quero', batchName: 'Acao1', bubbleOn: false, bubbleColor: '#3B82F6', language: 'es' });
    expect(m.conv.getDetail(c.id).options.word).toBe('Quero'); // persistido, não só devolvido
    expect(m.conv.createConversation().options.bubbleColor).toBe('#3B82F6');
    m.conv.patchConversation(c.id, { options: { bubbleColor: '#FFC400' } }); // restaura o padrão p/ os outros testes
  });

  it('renomear é manual: o título automático não sobrescreve depois', () => {
    const c = m.conv.createConversation({ mode: 'ideia' });
    m.conv.patchConversation(c.id, { title: 'Meu lote' });
    m.conv.sendMessage(c.id, { text: 'uma enfermeira de 60 anos', attachments: [] });
    expect(m.conv.getDetail(c.id).title).toBe('Meu lote');
  });

  it('assertConversationExists (usado antes de gravar o viral no upload) → 404 feminino', () => {
    const c = m.conv.createConversation();
    expect(() => m.conv.assertConversationExists(c.id)).not.toThrow();
    expect(() => m.conv.assertConversationExists('nao-existe')).toThrow('Conversa não encontrada');
  });

  it('conversa inexistente → 404', () => {
    expect(() => m.conv.getDetail('nao-existe')).toThrow('Conversa não encontrada'); // concordância feminina
    expect(() => m.conv.sendMessage('nao-existe', { text: 'oi', attachments: [] })).toThrow(/não encontrad/);
  });

  it('apagar remove a conversa, as mensagens e os eventos dela', () => {
    const c = m.conv.createConversation({ mode: 'ideia' });
    m.conv.sendMessage(c.id, { text: 'oi', attachments: [] });
    m.events.logEvent('conversation', c.id, 'evento da conversa');
    expect(m.events.listEvents('conversation', c.id).length).toBeGreaterThan(0);
    m.conv.removeConversation(c.id);
    expect(() => m.conv.getDetail(c.id)).toThrow();
    expect(m.events.listEvents('conversation', c.id)).toEqual([]);
  });
});

describe('Diretor local: pedido → lote "preparando" com log (sem rede)', () => {
  it('modo ideia: cria o lote, interpreta a quantidade e responde', () => {
    const c = m.conv.createConversation({ mode: 'ideia' });
    m.conv.patchConversation(c.id, { options: { word: 'link', batchName: 'Umbigo', language: 'de' } });
    const r = m.conv.sendMessage(c.id, { text: 'faz 3 vídeos de uma enfermeira de 60 anos', attachments: [{ nome: 'ref.png' }] });

    expect(r.batch).not.toBeNull();
    expect(r.batch).toMatchObject({ state: 'preparando', quantity: 3, source: 'diretor', word: 'link', batchName: 'Umbigo', language: 'de', bubbleOn: true, viralId: null });
    expect(r.conversation.messages.map((x) => x.role)).toEqual(['aluna', 'diretor']);
    expect(r.conversation.messages[0].attachments).toEqual([{ nome: 'ref.png' }]);
    expect(r.conversation.messages[1].text).toMatch(/3 vídeos em Alemão/);
    expect(r.conversation.title).toBe('Faz 3 vídeos de uma enfermeira de 60 anos');

    const log = m.batch.batchEvents(r.batch!.id).map((e) => e.message);
    expect(log.length).toBeGreaterThanOrEqual(4);
    expect(log.some((l) => /Sem Flow nem Antigravity/.test(l))).toBe(true);
    expect(log.at(-1)).toMatch(/preparando/);
    expect(m.batch.listProduction().some((b) => b.id === r.batch!.id)).toBe(true);
  });

  it('modo viral sem viral: NÃO cria lote, orienta a arrastar o viral', () => {
    const c = m.conv.createConversation({ mode: 'viral' });
    const r = m.conv.sendMessage(c.id, { text: 'faz 5', attachments: [] });
    expect(r.batch).toBeNull();
    expect(r.conversation.messages.at(-1)?.text).toMatch(/arraste o vídeo viral/i);
  });

  it('pedido vazio é recusado', () => {
    const c = m.conv.createConversation();
    expect(() => m.conv.sendMessage(c.id, { text: '   ', attachments: [] })).toThrow(/Escreva o pedido/);
  });

  it('cancelar → "cancelado" (log), depois pode apagar; "preparando" não apaga direto', () => {
    const c = m.conv.createConversation({ mode: 'ideia' });
    const b = m.conv.sendMessage(c.id, { text: 'um vídeo', attachments: [] }).batch!;
    expect(() => m.batch.removeBatch(b.id)).not.toThrow(); // preparando também pode (ainda não saiu nada)
    const b2 = m.conv.sendMessage(c.id, { text: 'outro vídeo', attachments: [] }).batch!;
    expect(m.batch.cancelBatch(b2.id).state).toBe('cancelado');
    expect(m.batch.batchEvents(b2.id).at(-1)?.message).toMatch(/cancelado/);
    expect(m.batch.listProduction().some((x) => x.id === b2.id)).toBe(false);
    m.batch.removeBatch(b2.id);
    expect(() => m.batch.batchEvents(b2.id)).toThrow(/não encontrad/);
  });
});

describe('virais (upload local real)', () => {
  it('guarda em data/virais/<sha256>.mp4, registra log e fica "preparando"', () => {
    const { viral, reused } = m.viral.storeViral({ name: 'REF viral.mp4', bytes: mp4(1) });
    expect(reused).toBe(false);
    expect(viral).toMatchObject({ name: 'REF viral.mp4', state: 'preparando', sizeBytes: 65 });
    const files = fs.readdirSync(m.config.VIRALS_DIR);
    expect(files.some((f) => /^[0-9a-f]{64}\.mp4$/.test(f))).toBe(true);
    const log = m.viral.viralEvents(viral.id).map((e) => e.message);
    expect(log.some((l) => /somente neste computador/.test(l))).toBe(true);
    expect(log.some((l) => /nenhuma chamada externa/.test(l))).toBe(true);
  });

  it('o mesmo conteúdo não é guardado duas vezes (dedupe por hash)', () => {
    const a = m.viral.storeViral({ name: 'a.mp4', bytes: mp4(2) });
    const b = m.viral.storeViral({ name: 'outro-nome.mp4', bytes: mp4(2) });
    expect(b.reused).toBe(true);
    expect(b.viral.id).toBe(a.viral.id);
  });

  it('recusa não-MP4, extensão errada, vazio e grande demais', () => {
    expect(() => m.viral.storeViral({ name: 'a.mp4', bytes: new Uint8Array(64) })).toThrow(/MP4 válido/);
    expect(() => m.viral.storeViral({ name: 'a.mov', bytes: mp4(3) })).toThrow(/\.mp4/);
    expect(() => m.viral.storeViral({ name: 'a.mp4', bytes: new Uint8Array(0) })).toThrow(/vazio/);
    expect(() => m.viral.storeViral({ name: 'a.mp4', bytes: { length: 61 * 1024 * 1024 } as unknown as Uint8Array })).toThrow(/60 MB/);
  });

  it('anexar a conversa vazia fica na mesma conversa; trocar com mensagens abre conversa NOVA', () => {
    const v1 = m.viral.storeViral({ name: 'v1.mp4', bytes: mp4(10) }).viral;
    const v2 = m.viral.storeViral({ name: 'v2.mp4', bytes: mp4(11) }).viral;
    const c = m.conv.createConversation();
    const a = m.conv.attachViral(c.id, v1.id);
    expect(a.id).toBe(c.id);
    expect(a.viral?.id).toBe(v1.id);

    const r = m.conv.sendMessage(c.id, { text: '3 vídeos', attachments: [] });
    expect(r.batch).toMatchObject({ viralId: v1.id, viralName: 'v1.mp4', quantity: 3 });

    const trocada = m.conv.attachViral(c.id, v2.id);
    expect(trocada.id).not.toBe(c.id); // "Trocar o viral abre uma conversa nova com ele"
    expect(trocada.viral?.id).toBe(v2.id);
    expect(m.conv.getDetail(c.id).viral?.id).toBe(v1.id); // a antiga ficou como estava
  });

  it('trocar o viral numa conversa com mensagens aplica os OUTROS campos do PATCH (à conversa nova), sem descartar nada', () => {
    const v1 = m.viral.storeViral({ name: 'p1.mp4', bytes: mp4(20) }).viral;
    const v2 = m.viral.storeViral({ name: 'p2.mp4', bytes: mp4(21) }).viral;
    const c = m.conv.createConversation({ viralId: v1.id });
    m.conv.sendMessage(c.id, { text: '2 vídeos', attachments: [] });
    const nova = m.conv.patchConversation(c.id, { viralId: v2.id, mode: 'ideia', title: 'Outro lote', options: { word: 'yes' } });
    expect(nova.id).not.toBe(c.id);
    expect(nova).toMatchObject({ mode: 'ideia', title: 'Outro lote', viral: { id: v2.id } });
    expect(nova.options.word).toBe('yes');
    expect(m.conv.getDetail(c.id)).toMatchObject({ viral: { id: v1.id }, mode: 'viral' }); // a anterior ficou intacta
    expect(m.conv.getDetail(c.id).options.word).toBe('');
  });

  it('nome longo (134 caracteres) com .mp4 é aceito: a extensão é validada antes do corte e preservada', () => {
    const longo = 'a'.repeat(130) + '.mp4';
    expect(longo.length).toBe(134);
    const { viral } = m.viral.storeViral({ name: longo, bytes: mp4(22) });
    expect(viral.name.length).toBe(120);
    expect(viral.name.endsWith('.mp4')).toBe(true);
    expect(() => m.viral.storeViral({ name: 'a'.repeat(130) + '.mov', bytes: mp4(23) })).toThrow(/.mp4/);
  });

  it('corrida no UNIQUE(hash): o arquivo do registro vencedor NÃO é apagado', () => {
    const bytes = mp4(24);
    const first = m.viral.storeViral({ name: 'w.mp4', bytes }).viral;
    const file = `${crypto.createHash('sha256').update(bytes).digest('hex')}.mp4`;
    expect(fs.existsSync(path.join(m.config.VIRALS_DIR, file))).toBe(true);
    // simula o perdedor: o dedupe inicial não viu o registro (corrida) e o INSERT bate no UNIQUE
    const spy = vi.spyOn(m.viralRepo, 'getViralByHash').mockReturnValueOnce(undefined);
    const second = m.viral.storeViral({ name: 'w2.mp4', bytes });
    spy.mockRestore();
    expect(second.viral.id).toBe(first.id);
    expect(second.reused).toBe(true);
    expect(fs.existsSync(path.join(m.config.VIRALS_DIR, file))).toBe(true);
  });

  it('tirar o viral (null) mantém a conversa', () => {
    const v = m.viral.storeViral({ name: 'v3.mp4', bytes: mp4(12) }).viral;
    const c = m.conv.createConversation({ viralId: v.id });
    expect(m.conv.patchConversation(c.id, { viralId: null }).viral).toBeNull();
  });

  it('apagar o viral remove o arquivo e solta as referências sem apagar lotes/conversas', () => {
    const v = m.viral.storeViral({ name: 'v4.mp4', bytes: mp4(13) }).viral;
    const c = m.conv.createConversation({ viralId: v.id });
    const before = fs.readdirSync(m.config.VIRALS_DIR).length;
    m.viral.removeViral(v.id);
    expect(fs.readdirSync(m.config.VIRALS_DIR).length).toBe(before - 1);
    expect(m.conv.getDetail(c.id).viral).toBeNull();
    expect(() => m.viral.removeViral(v.id)).toThrow(/não encontrad/);
  });

  it('lote manual a partir de um viral', () => {
    const v = m.viral.storeViral({ name: 'manual.mp4', bytes: mp4(14) }).viral;
    const b = m.batch.createManualBatch({ viralId: v.id, quantity: 2, options: { word: 'yes' } });
    expect(b).toMatchObject({ source: 'manual', state: 'preparando', quantity: 2, word: 'yes', viralId: v.id });
    expect(() => m.batch.createManualBatch({ viralId: 'x', quantity: 1, options: {} })).toThrow(/não encontrad/);
  });
});

describe('avatares, configurações, feedback e ponte', () => {
  it('CRUD de avatar', () => {
    const a = m.avatar.createAvatar({ name: 'Loretta', description: 'enfermeira' });
    expect(m.avatar.listAllAvatars().some((x) => x.id === a.id)).toBe(true);
    expect(m.avatar.editAvatar(a.id, { name: 'Loretta B.', description: '' }).name).toBe('Loretta B.');
    m.avatar.removeAvatar(a.id);
    expect(() => m.avatar.removeAvatar(a.id)).toThrow(/não encontrad/);
  });

  it('configurações: padrões do original (troca automática desligada, 20 créditos) e persistência', () => {
    expect(m.settings.getSettings()).toEqual({ autoSwitch: false, minCredits: 20 });
    expect(m.settings.patchSettings({ minCredits: 35, autoSwitch: true })).toEqual({ autoSwitch: true, minCredits: 35 });
    expect(m.settings.getSettings().minCredits).toBe(35);
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
