import { randomBytes } from 'node:crypto';
import { beforeAll, describe, expect, it } from 'vitest';
import { formatBinaryBytes, jobStatusLabel, overallPercent, phaseLabel, progressLabel, progressPercent } from './format';
import { createJobSchema, uploadQuerySchema } from './schemas';
import { transcriptionPercent, TRANSCRIPTION_STEP_LABELS as L } from './transcription-steps';

const valid = {
  videoId: 'v1',
  copyText: 'olá',
  model: 'veo-3.1-lite',
  resolution: '720p',
};

describe('createJobSchema', () => {
  it('aceita "Pessoa original" (sem avatares) e aplica os padrões da referência', () => {
    const r = createJobSchema.parse(valid);
    expect(r.avatarIds).toEqual([]);
    expect(r.outputLanguage).toBe('original');
    expect(r.scriptMode).toBe('keep');
    expect(r.creativeFormat).toBe('original-recipe');
    expect(r.imageModel).toBe('nano-banana-2.1');
    expect(r.cta).toBe('');
    expect(r.axes.outfit).toEqual({ mode: 'original', value: '' });
  });

  it('exige copy, limita o tamanho e recusa avatares repetidos', () => {
    expect(() => createJobSchema.parse({ ...valid, copyText: '   ' })).toThrow(/copy/i);
    expect(() => createJobSchema.parse({ ...valid, copyText: 'a'.repeat(12_001) })).toThrow(/12\.000|12000/);
    expect(() => createJobSchema.parse({ ...valid, avatarIds: ['a', 'a'] })).toThrow(/repetidos/);
  });

  it('exige preset/descrição quando o eixo não é "original"', () => {
    const axes = { outfit: { mode: 'preset', value: '' }, scenery: { mode: 'original', value: '' }, object: { mode: 'original', value: '' } };
    expect(() => createJobSchema.parse({ ...valid, axes })).toThrow(/preset|descreva/i);
    axes.outfit.value = 'Roupa esportiva';
    expect(createJobSchema.parse({ ...valid, axes }).axes.outfit.value).toBe('Roupa esportiva');
  });

  it('recusa 360p fora do Omni 1.1 Flash e aceita nele', () => {
    expect(() => createJobSchema.parse({ ...valid, resolution: '360p' })).toThrow(/Omni 1.1 Flash/);
    expect(createJobSchema.parse({ ...valid, model: 'omni-1.1-flash', resolution: '360p' }).resolution).toBe('360p');
  });
});

describe('createJobSchema — cenas (validação no servidor)', () => {
  const scene = (index: number, start: number, end: number, text = 'fala') => ({ index, start, end, text });

  it('aceita cenas sequenciais com até 8 s e dispensa o copyText (derivado no serviço)', () => {
    const r = createJobSchema.parse({ ...valid, copyText: undefined, scenes: [scene(1, 0, 5), scene(2, 5.5, 8.5)] });
    expect(r.scenes).toHaveLength(2);
    expect(r.copyText).toBe('');
  });

  it('recusa cena com fim antes do início', () => {
    expect(() => createJobSchema.parse({ ...valid, scenes: [scene(1, 5, 2)] })).toThrow(/antes do início/);
  });

  it('recusa cena com mais de 8 s', () => {
    expect(() => createJobSchema.parse({ ...valid, scenes: [scene(1, 0, 8.5)] })).toThrow(/8 segundos/);
    expect(createJobSchema.parse({ ...valid, scenes: [scene(1, 0, 8)] }).scenes).toHaveLength(1);
  });

  it('recusa índices fora de sequência ou repetidos', () => {
    expect(() => createJobSchema.parse({ ...valid, scenes: [scene(1, 0, 2), scene(1, 2, 4)] })).toThrow(/sequenciais/);
    expect(() => createJobSchema.parse({ ...valid, scenes: [scene(2, 0, 2)] })).toThrow(/sequenciais/);
  });

  it('sem cenas e sem copy manual → erro; com cenas a copy manual é ignorada', () => {
    expect(() => createJobSchema.parse({ ...valid, copyText: '', scenes: [] })).toThrow(/copy/i);
    expect(createJobSchema.parse({ ...valid, copyText: 'qualquer coisa', scenes: [scene(1, 0, 2, 'A')] }).scenes[0].text).toBe('A');
  });

  it('o limite de 12.000 caracteres vale para a copy derivada das cenas', () => {
    const big = 'a'.repeat(6_100);
    expect(() => createJobSchema.parse({ ...valid, scenes: [scene(1, 0, 3, big), scene(2, 3, 6, big)] })).toThrow(/12\.?000/);
  });
});

describe('uploadQuerySchema', () => {
  it('usa padrões e ignora duração inválida em vez de quebrar', () => {
    expect(uploadQuerySchema.parse({})).toEqual({ name: 'video.mp4', duration: undefined });
    expect(uploadQuerySchema.parse({ name: 'a.mp4', duration: 'abc' }).duration).toBeUndefined();
    expect(uploadQuerySchema.parse({ name: 'a.mp4', duration: '12.5' }).duration).toBe(12.5);
    expect(uploadQuerySchema.parse({ name: 'a.mp4', duration: '-3' }).duration).toBeUndefined();
  });
  it('recusa nome vazio ou gigante', () => {
    expect(() => uploadQuerySchema.parse({ name: '   ' })).toThrow();
    expect(() => uploadQuerySchema.parse({ name: 'x'.repeat(201) })).toThrow();
  });
});

describe('formatação de progresso (textos da referência)', () => {
  const base = { kind: 'generation' as const, stepsDone: 0, stepsTotal: 0, stepsPercent: 0, variations: 20, videosDone: 20, failedAttempts: 3, imagesDone: 20, imagesFailed: 0, videosFailed: 0 };

  it('formata "20 de 20 vídeos concluídos · 3 falhas"', () => {
    const job = { ...base, status: 'partial' as const, phase: 'done' as const };
    expect(progressLabel(job)).toBe('20 de 20 vídeos concluídos · 3 falhas');
    expect(phaseLabel(job)).toBe('Geração de vídeos finalizada parcialmente');
    expect(progressPercent(job)).toBe(100);
  });

  it('trabalho cancelado no início não aparece como 100%', () => {
    const job = { ...base, imagesDone: 0, videosDone: 0, failedAttempts: 0, status: 'cancelled' as const, phase: 'images' as const };
    expect(progressLabel(job)).toBe('Cancelado');
    expect(phaseLabel(job)).toBe('Imagens');
    expect(overallPercent(job)).toBe(0);
  });

  it('trabalhos de transcrição usam o vocabulário da prévia', () => {
    const t = { ...base, kind: 'transcription' as const, stepsTotal: 5, stepsDone: 5, stepsPercent: 100, variations: 0, phase: 'done' as const };
    const done = { ...t, status: 'completed' as const };
    expect(jobStatusLabel(done)).toBe('Prévia pronta');
    expect(phaseLabel(done)).toBe('Prévia concluída');
    expect(progressLabel(done)).toBe('Concluído · 100%');
    // Falha depois do envio do áudio = solicitada + preparado + enviado = 35% (valor observado na referência).
    const failed = { ...t, status: 'failed' as const, stepsDone: 3, stepsPercent: transcriptionPercent([L.requested, L.audioPrepared, L.sent]) };
    expect(jobStatusLabel(failed)).toBe('Falhou');
    expect(progressLabel(failed)).toBe('Falhou · 35%');
    expect(progressPercent(failed)).toBe(35);
  });

  it('o percentual da transcrição soma pesos, ignora etapas desconhecidas/repetidas e nunca passa de 100', () => {
    expect(transcriptionPercent([])).toBe(0);
    expect(transcriptionPercent([L.requested])).toBe(5);
    expect(transcriptionPercent([L.requested, L.requested, 'etapa inventada'])).toBe(5);
    expect(transcriptionPercent(Object.values(L))).toBe(100);
  });

  it('usa unidades binárias em pt-BR', () => {
    expect(formatBinaryBytes(503.4 * 1024 * 1024)).toBe('503,4 MiB');
    expect(formatBinaryBytes(2 * 1024 ** 3)).toBe('2 GiB');
  });
});

describe('criptografia de segredos', () => {
  beforeAll(() => {
    process.env.COLDCLICK_SECRET_KEY = randomBytes(32).toString('base64');
  });

  it('faz ida e volta, não repete o texto cifrado e aceita legado em texto puro', async () => {
    const { decryptSecret, encryptSecret, isEncrypted } = await import('./crypto');
    const a = encryptSecret('AIzaSegredo1234');
    const b = encryptSecret('AIzaSegredo1234');
    expect(isEncrypted(a)).toBe(true);
    expect(a).not.toContain('Segredo');
    expect(a).not.toBe(b); // IV aleatório
    expect(decryptSecret(a)).toBe('AIzaSegredo1234');
    expect(decryptSecret('texto-legado')).toBe('texto-legado');
  });

  it('detecta adulteração do texto cifrado (GCM)', async () => {
    const { decryptSecret, encryptSecret } = await import('./crypto');
    const enc = encryptSecret('segredo');
    const tampered = enc.slice(0, -4) + (enc.endsWith('AAAA') ? 'BBBB' : 'AAAA');
    expect(() => decryptSecret(tampered)).toThrow();
  });
});
