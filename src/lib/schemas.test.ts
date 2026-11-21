import { randomBytes } from 'node:crypto';
import { beforeAll, describe, expect, it } from 'vitest';
import { formatBinaryBytes, overallPercent, phaseLabel, progressLabel, progressPercent } from './format';
import { createJobSchema } from './schemas';

const valid = {
  videoId: 'v1',
  avatarId: null,
  copyText: 'olá',
  format: '9:16',
  variations: 3,
  model: 'veo-3.1-lite',
  resolution: '720p',
};

describe('createJobSchema', () => {
  it('aceita "Pessoa original" (avatarId nulo) e aplica padrões', () => {
    const r = createJobSchema.parse(valid);
    expect(r.avatarId).toBeNull();
    expect(r.language).toBe('pt');
    expect(r.transcriptSource).toBe('none');
  });

  it('exige copy e limita variações', () => {
    expect(() => createJobSchema.parse({ ...valid, copyText: '   ' })).toThrow(/copy/i);
    expect(() => createJobSchema.parse({ ...valid, variations: 0 })).toThrow();
    expect(() => createJobSchema.parse({ ...valid, variations: 51 })).toThrow();
  });

  it('recusa 360p fora do Omni 1.1 Flash e aceita nele', () => {
    expect(() => createJobSchema.parse({ ...valid, resolution: '360p' })).toThrow(/Omni 1.1 Flash/);
    expect(createJobSchema.parse({ ...valid, model: 'omni-1.1-flash', resolution: '360p' }).resolution).toBe('360p');
  });
});

describe('formatação de progresso (textos da referência)', () => {
  const base = { variations: 20, videosDone: 20, failedAttempts: 3, imagesDone: 20, imagesFailed: 0, videosFailed: 0 };

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
