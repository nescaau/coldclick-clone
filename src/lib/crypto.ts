/**
 * Criptografia de segredos em repouso (chaves de API) — AES-256-GCM.
 *
 * A chave mestra vem de `COLDCLICK_SECRET_KEY` (32 bytes em base64) ou, se ausente, é gerada na
 * primeira execução em `data/.secret.key` (modo 0600). Isso protege contra vazamento do arquivo
 * `.db` isolado; não protege contra quem já tem acesso ao disco inteiro. Em produção, usar um KMS.
 *
 * Formato armazenado: `enc:v1:<base64(iv(12) | tag(16) | ciphertext)>`.
 * Valores sem o prefixo são tratados como texto puro legado (migrados por `encryptLegacySecrets`).
 */
import { createCipheriv, createDecipheriv, randomBytes } from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import { DATA_DIR } from './config';

const PREFIX = 'enc:v1:';
const KEY_FILE = path.join(DATA_DIR, '.secret.key');

declare global {
  // eslint-disable-next-line no-var
  var __coldclickMasterKey: Buffer | undefined;
}

function loadMasterKey(): Buffer {
  const fromEnv = process.env.COLDCLICK_SECRET_KEY;
  if (fromEnv) {
    const key = Buffer.from(fromEnv, 'base64');
    if (key.length !== 32) throw new Error('COLDCLICK_SECRET_KEY deve ter 32 bytes em base64');
    return key;
  }
  try {
    const key = Buffer.from(fs.readFileSync(KEY_FILE, 'utf8').trim(), 'base64');
    if (key.length === 32) return key;
  } catch {
    // arquivo ainda não existe: gerado abaixo
  }
  const key = randomBytes(32);
  fs.mkdirSync(DATA_DIR, { recursive: true });
  fs.writeFileSync(KEY_FILE, key.toString('base64'), { mode: 0o600 });
  return key;
}

const masterKey = (): Buffer => (globalThis.__coldclickMasterKey ??= loadMasterKey());

export const isEncrypted = (stored: string): boolean => stored.startsWith(PREFIX);

export function encryptSecret(plain: string): string {
  const iv = randomBytes(12);
  const cipher = createCipheriv('aes-256-gcm', masterKey(), iv);
  const body = Buffer.concat([cipher.update(plain, 'utf8'), cipher.final()]);
  return PREFIX + Buffer.concat([iv, cipher.getAuthTag(), body]).toString('base64');
}

export function decryptSecret(stored: string): string {
  if (!isEncrypted(stored)) return stored; // legado em texto puro
  const raw = Buffer.from(stored.slice(PREFIX.length), 'base64');
  const decipher = createDecipheriv('aes-256-gcm', masterKey(), raw.subarray(0, 12));
  decipher.setAuthTag(raw.subarray(12, 28));
  return Buffer.concat([decipher.update(raw.subarray(28)), decipher.final()]).toString('utf8');
}
