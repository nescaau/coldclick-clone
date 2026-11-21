import { randomBytes } from 'node:crypto';
import { beforeAll, describe, expect, it } from 'vitest';
import { formatBinaryBytes, jobStatusLabel, overallPercent, phaseLabel, progressLabel, progressPercent } from './format';
import { createJobSchema } from './schemas';

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

describe('formatação de progresso (textos da referência)', () => {
  const base = { kind: 'generation' as const, stepsDone: 0, stepsTotal: 0, variations: 20, videosDone: 20, failedAttempts: 3, imagesDone: 20, imagesFailed: 0, videosFailed: 0 };

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
    const t = { ...base, kind: 'transcription' as const, stepsTotal: 5, stepsDone: 5, variations: 0, phase: 'done' as const };
    const done = { ...t, status: 'completed' as const };
    expect(jobStatusLabel(done)).toBe('Prévia pronta');
    expect(phaseLabel(done)).toBe('Prévia concluída');
    expect(progressLabel(done)).toBe('Concluído · 100%');
    const failed = { ...t, status: 'failed' as const, stepsDone: 2 };
    expect(jobStatusLabel(failed)).toBe('Falhou');
    expect(progressLabel(failed)).toBe('Falhou · 40%');
    expect(progressPercent(failed)).toBe(40);
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
