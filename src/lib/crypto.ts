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
import { createCipheriv, createDecipheriv, createHmac, randomBytes } from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import { DATA_DIR } from './config';

const PREFIX = 'enc:v1:';
const KEY_FILE = path.join(DATA_DIR, '.secret.key');

declare global {
  // eslint-disable-next-line no-var
  var __coldclickMasterKey: Buffer | undefined;
}

function parseKey(raw: string, origin: string): Buffer {
  const key = Buffer.from(raw.trim(), 'base64');
  if (key.length !== 32) {
    // Nunca regenerar em silêncio: uma chave nova tornaria ilegíveis todos os segredos já gravados.
    throw new Error(`Chave mestra inválida em ${origin}: esperados 32 bytes em base64. Restaure o arquivo original ou apague-o sabendo que as chaves de API salvas serão perdidas.`);
  }
  return key;
}

function loadMasterKey(): Buffer {
  const fromEnv = process.env.COLDCLICK_SECRET_KEY;
  if (fromEnv) return parseKey(fromEnv, 'COLDCLICK_SECRET_KEY');

  try {
    return parseKey(fs.readFileSync(KEY_FILE, 'utf8'), KEY_FILE);
  } catch (e) {
    if ((e as NodeJS.ErrnoException).code !== 'ENOENT') throw e; // arquivo existe mas é ilegível/ inválido
  }

  // Primeira execução: cria com flag 'wx' (falha se outro processo criou no meio-tempo → então só lemos).
  const key = randomBytes(32);
  fs.mkdirSync(DATA_DIR, { recursive: true });
  try {
    fs.writeFileSync(KEY_FILE, key.toString('base64'), { mode: 0o600, flag: 'wx' });
    return key;
  } catch (e) {
    if ((e as NodeJS.ErrnoException).code === 'EEXIST') return parseKey(fs.readFileSync(KEY_FILE, 'utf8'), KEY_FILE);
    throw e;
  }
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

/**
 * Impressão digital determinística do segredo (HMAC-SHA256 com a chave mestra), para detectar
 * duplicatas sem decifrar nada — o texto cifrado muda a cada gravação (IV aleatório).
 */
export const secretFingerprint = (plain: string, purpose = 'secret'): string =>
  createHmac('sha256', masterKey()).update(`${purpose}:${plain}`).digest('hex');
