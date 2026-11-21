import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { randomBytes } from 'node:crypto';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

/** Chave mestra: nunca regenerar em silêncio, criar com 'wx' e falhar de forma clara se estiver corrompida. */
describe('chave mestra', () => {
  let dir: string;
  let keyFile: string;
  type Crypto = typeof import('./crypto');

  const load = async (): Promise<Crypto> => {
    globalThis.__coldclickMasterKey = undefined;
    const { vi } = await import('vitest');
    vi.resetModules();
    return import('./crypto');
  };

  beforeAll(() => {
    dir = fs.mkdtempSync(path.join(process.env.TMPDIR ?? os.tmpdir(), 'cc-key-'));
    keyFile = path.join(dir, '.secret.key');
    process.env.COLDCLICK_DATA_DIR = dir;
    delete process.env.COLDCLICK_SECRET_KEY;
  });
  afterAll(() => {
    fs.rmSync(dir, { recursive: true, force: true });
    delete process.env.COLDCLICK_DATA_DIR;
    globalThis.__coldclickMasterKey = undefined;
  });

  it('primeira execução cria o arquivo (32 bytes) e a mesma chave é reutilizada depois', async () => {
    const a = await load();
    const enc = a.encryptSecret('segredo');
    expect(Buffer.from(fs.readFileSync(keyFile, 'utf8'), 'base64')).toHaveLength(32);
    const b = await load(); // "novo processo": relê do arquivo
    expect(b.decryptSecret(enc)).toBe('segredo');
  });

  it('arquivo corrompido → erro claro e o arquivo NÃO é sobrescrito', async () => {
    fs.writeFileSync(keyFile, 'lixo-que-nao-e-32-bytes');
    const c = await load();
    expect(() => c.encryptSecret('x')).toThrow(/Chave mestra inválida/);
    expect(fs.readFileSync(keyFile, 'utf8')).toBe('lixo-que-nao-e-32-bytes');
  });

  it('variável de ambiente inválida também falha (sem fallback silencioso)', async () => {
    process.env.COLDCLICK_SECRET_KEY = 'curta';
    try {
      const c = await load();
      expect(() => c.encryptSecret('x')).toThrow(/COLDCLICK_SECRET_KEY/);
    } finally {
      delete process.env.COLDCLICK_SECRET_KEY;
    }
  });

  it('a impressão digital é determinística, depende do propósito e não revela o segredo', async () => {
    process.env.COLDCLICK_SECRET_KEY = randomBytes(32).toString('base64');
    try {
      const c = await load();
      const h1 = c.secretFingerprint('AIzaABC', 'gemini-key');
      expect(c.secretFingerprint('AIzaABC', 'gemini-key')).toBe(h1);
      expect(c.secretFingerprint('AIzaABC', 'outro')).not.toBe(h1);
      expect(c.secretFingerprint('AIzaABD', 'gemini-key')).not.toBe(h1);
      expect(h1).not.toContain('AIza');
      expect(c.encryptSecret('AIzaABC')).not.toBe(c.encryptSecret('AIzaABC')); // por isso o hash existe
    } finally {
      delete process.env.COLDCLICK_SECRET_KEY;
    }
  });
});
