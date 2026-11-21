/**
 * Chaves da API Gemini (usadas para gerar os prompts): cadastro em lote, ordem de tentativa e uso.
 * Os segredos ficam criptografados no banco (lib/crypto.ts) e nunca voltam ao navegador.
 */
import { randomUUID } from 'node:crypto';
import { transaction } from '../db';
import { decryptSecret, encryptSecret, isEncrypted, secretFingerprint } from '../crypto';
import { MAX_GEMINI_KEYS } from '../config';
import { AppError, notFound } from '../errors';
import {
  deleteGeminiKeyRow,
  findGeminiKeyRow,
  insertGeminiKeyRow,
  listGeminiKeyHashes,
  listGeminiKeyRows,
  recordGeminiKeyError,
  recordGeminiKeyUse,
  replaceGeminiKeySecret,
  setGeminiKeyHash,
  swapGeminiKeyPositions,
  type GeminiKeyRow,
} from '../repo/gemini-keys';
import { isDefinitiveKeyRejection, pickKey } from '../rotation';
import type { GeminiKeyDTO } from '../types';

const KEY_PATTERN = /^[A-Za-z0-9_-]{20,200}$/;

const toDTO = (r: GeminiKeyRow, position: number): GeminiKeyDTO => ({
  id: r.id,
  position,
  maskedKey: `••••${r.key_last4}`,
  uses: r.uses,
  lastUsedAt: r.last_used_at,
  lastError: r.last_error,
});

export const listGeminiKeys = (): GeminiKeyDTO[] => listGeminiKeyRows().map((r, i) => toDTO(r, i + 1));

/** Quebra o texto colado (uma chave por linha) em chaves únicas e válidas. */
export function parseKeyLines(text: string): string[] {
  const lines = text
    .split(/\r?\n/)
    .map((l) => l.trim())
    .filter(Boolean);
  const invalid = lines.find((l) => !KEY_PATTERN.test(l));
  if (invalid) throw new AppError(400, `Chave inválida: "${invalid.slice(0, 8)}…". Use uma chave por linha, sem espaços.`);
  return [...new Set(lines)];
}

/** Cadastra várias chaves de uma vez (ignora as já cadastradas), respeitando o limite de 10. */
export function addGeminiKeys(text: string): { added: number; skipped: number } {
  const incoming = parseKeyLines(text);
  return transaction(() => {
    const existing = listGeminiKeyHashes(); // comparação por HMAC: nada é decifrado
    const fresh = incoming.filter((k) => !existing.has(secretFingerprint(k, 'gemini-key')));
    const total = listGeminiKeyRows().length;
    if (total + fresh.length > MAX_GEMINI_KEYS) {
      throw new AppError(400, `Você pode cadastrar até ${MAX_GEMINI_KEYS} chaves (já há ${total}).`);
    }
    for (const key of fresh) {
      insertGeminiKeyRow({ id: randomUUID(), encryptedKey: encryptSecret(key), hash: secretFingerprint(key, 'gemini-key'), last4: key.slice(-4) });
    }
    return { added: fresh.length, skipped: incoming.length - fresh.length };
  });
}

/** Move uma chave na ordem de tentativa (troca de posição com a vizinha). */
export function moveGeminiKey(id: string, direction: 'up' | 'down'): void {
  transaction(() => {
    const rows = listGeminiKeyRows();
    const index = rows.findIndex((r) => r.id === id);
    if (index === -1) throw notFound('Chave');
    const neighbor = rows[direction === 'up' ? index - 1 : index + 1];
    if (neighbor) swapGeminiKeyPositions(rows[index], neighbor);
  });
}

export function removeGeminiKey(id: string): void {
  if (!deleteGeminiKeyRow(id)) throw notFound('Chave');
}

/**
 * Próxima chave para uma geração: começa pela primeira da ordem e, em novas tentativas da MESMA
 * geração, pula as já rejeitadas (`rejectedIds`). Devolve a chave em claro — uso exclusivo do
 * servidor (geração de prompts, fase 2); nunca expor ao navegador.
 */
export function acquireGeminiKey(rejectedIds: readonly string[] = []): { id: string; apiKey: string } | null {
  return transaction(() => {
    const rows = listGeminiKeyRows();
    const picked = pickKey(rows, rejectedIds);
    if (!picked) return null;
    recordGeminiKeyUse(picked.id);
    return { id: picked.id, apiKey: decryptSecret(picked.api_key) };
  });
}

/**
 * Registra a resposta de erro de uma chave. Retorna `true` se a falha é definitiva (autenticação,
 * quota, validação) e portanto vale tentar a próxima chave; timeout/erro de rede retornam `false`
 * para não duplicar cobranças.
 */
export function reportGeminiKeyFailure(id: string, httpStatus: number, message: string): boolean {
  if (!findGeminiKeyRow(id)) return false;
  recordGeminiKeyError(id, `HTTP ${httpStatus}: ${message}`);
  return isDefinitiveKeyRejection(httpStatus);
}

/**
 * Migração de dados das chaves (idempotente): criptografa as legadas em texto puro e preenche `key_hash`
 * das linhas antigas. Se duas linhas legadas eram a mesma chave, a repetida é removida.
 */
export function encryptLegacyGeminiKeys(): void {
  transaction(() => {
    const seen = listGeminiKeyHashes();
    for (const row of listGeminiKeyRows()) {
      if (row.key_hash && isEncrypted(row.api_key)) continue;
      const plain = decryptSecret(row.api_key);
      const hash = secretFingerprint(plain, 'gemini-key');
      if (seen.has(hash) && row.key_hash !== hash) {
        deleteGeminiKeyRow(row.id);
        continue;
      }
      seen.add(hash);
      if (!isEncrypted(row.api_key)) replaceGeminiKeySecret(row.id, encryptSecret(plain), hash, plain.slice(-4));
      else setGeminiKeyHash(row.id, hash);
    }
  });
}
