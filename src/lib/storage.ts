/**
 * Armazenamento de arquivos em disco (uploads e gerações).
 * O banco guarda apenas caminhos RELATIVOS à pasta de armazenamento; o caminho
 * absoluto é resolvido aqui, sempre com proteção contra "path traversal".
 */
import { createWriteStream, existsSync, mkdirSync, readdirSync, rmSync, statSync, writeFileSync } from 'node:fs';
import { mkdir, rm, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { Readable, Transform } from 'node:stream';
import { pipeline } from 'node:stream/promises';
import type { ReadableStream as NodeWebStream } from 'node:stream/web';
import { STORAGE_QUOTA_BYTES } from './config';
import { getStorageDir } from './services/settings-service';
import type { StorageUsageDTO } from './types';

export class PayloadTooLargeError extends Error {
  constructor(maxBytes: number) {
    super(`Arquivo maior que o limite de ${Math.round(maxBytes / 1024 / 1024)} MB`);
  }
}

/** Resolve um caminho relativo dentro da pasta de armazenamento, recusando saídas dela. */
export function resolveStoragePath(rel: string): string {
  const root = path.resolve(getStorageDir());
  const abs = path.resolve(root, rel);
  if (abs !== root && !abs.startsWith(root + path.sep)) {
    throw new Error('Caminho fora da pasta de armazenamento');
  }
  return abs;
}

/** Nome de arquivo seguro: sem diretórios e sem caracteres problemáticos. */
export function safeBaseName(name: string): string {
  const base = path.basename(name).replace(/[^\p{L}\p{N}._ -]/gu, '_').trim();
  return base.slice(0, 120) || 'arquivo';
}

/**
 * Grava um stream web (ex.: corpo de uma Request) em disco SEM carregar tudo na memória,
 * abortando e apagando o arquivo parcial se passar do limite. Retorna o tamanho em bytes.
 */
export async function saveWebStream(rel: string, body: ReadableStream<Uint8Array>, maxBytes: number): Promise<number> {
  const abs = resolveStoragePath(rel);
  await mkdir(path.dirname(abs), { recursive: true });

  let size = 0;
  const limiter = new Transform({
    transform(chunk: Buffer, _enc, cb) {
      size += chunk.length;
      if (size > maxBytes) cb(new PayloadTooLargeError(maxBytes));
      else cb(null, chunk);
    },
  });

  try {
    await pipeline(Readable.fromWeb(body as unknown as NodeWebStream), limiter, createWriteStream(abs));
  } catch (e) {
    await rm(abs, { force: true });
    throw e;
  }
  return size;
}

export async function saveBuffer(rel: string, data: Buffer | Uint8Array): Promise<void> {
  const abs = resolveStoragePath(rel);
  await mkdir(path.dirname(abs), { recursive: true });
  await writeFile(abs, data);
}

/** Versão síncrona, usada pelo executor e pelo seed para gravar arquivos pequenos. */
export function saveTextSync(rel: string, content: string): void {
  const abs = resolveStoragePath(rel);
  mkdirSync(path.dirname(abs), { recursive: true });
  writeFileSync(abs, content, 'utf8');
}

export function deleteFile(rel: string | null | undefined): void {
  if (!rel) return;
  try {
    rmSync(resolveStoragePath(rel), { force: true });
  } catch {
    // Arquivo já removido ou fora da pasta atual (ex.: pasta de armazenamento foi trocada).
  }
}

export function deleteDir(rel: string): void {
  try {
    rmSync(resolveStoragePath(rel), { recursive: true, force: true });
  } catch {
    // idem deleteFile
  }
}

function directorySize(dir: string): number {
  let total = 0;
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) total += directorySize(full);
    else if (entry.isFile()) total += statSync(full).size;
  }
  return total;
}

/** Uso real do disco na pasta de armazenamento versus a cota da conta. */
export function getStorageUsage(): StorageUsageDTO {
  const root = getStorageDir();
  const usedBytes = existsSync(root) ? directorySize(root) : 0;
  const availableBytes = Math.max(0, STORAGE_QUOTA_BYTES - usedBytes);
  return {
    usedBytes,
    quotaBytes: STORAGE_QUOTA_BYTES,
    availableBytes,
    percent: Math.min(100, Math.round((usedBytes / STORAGE_QUOTA_BYTES) * 100)),
  };
}
