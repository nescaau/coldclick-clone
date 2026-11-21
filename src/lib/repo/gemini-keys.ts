/** Repositório das chaves Gemini. Só SQL — criptografia e regras de ordem ficam no serviço. */
import { getDb, nowIso } from '../db';

export interface GeminiKeyRow {
  id: string;
  api_key: string; // segredo criptografado (ver lib/crypto.ts)
  key_hash: string | null; // HMAC do segredo (detecta duplicata sem decifrar)
  key_last4: string;
  position: number;
  uses: number;
  last_used_at: string | null;
  last_error: string | null;
}

export const listGeminiKeyRows = (): GeminiKeyRow[] =>
  getDb().prepare('SELECT * FROM gemini_keys ORDER BY position, rowid').all() as GeminiKeyRow[];

export const countGeminiKeys = (): number =>
  (getDb().prepare('SELECT COUNT(*) AS n FROM gemini_keys').get() as { n: number }).n;

export const findGeminiKeyRow = (id: string): GeminiKeyRow | null =>
  (getDb().prepare('SELECT * FROM gemini_keys WHERE id = ?').get(id) as GeminiKeyRow | undefined) ?? null;

export const listGeminiKeyHashes = (): Set<string> =>
  new Set((getDb().prepare('SELECT key_hash FROM gemini_keys WHERE key_hash IS NOT NULL').all() as { key_hash: string }[]).map((r) => r.key_hash));

export function insertGeminiKeyRow(k: { id: string; encryptedKey: string; hash: string; last4: string }): void {
  const db = getDb();
  const next = (db.prepare('SELECT COALESCE(MAX(position), 0) + 1 AS n FROM gemini_keys').get() as { n: number }).n;
  db.prepare('INSERT INTO gemini_keys (id, api_key, key_hash, key_last4, position) VALUES (?, ?, ?, ?, ?)').run(
    k.id,
    k.encryptedKey,
    k.hash,
    k.last4,
    next,
  );
}

export function swapGeminiKeyPositions(a: GeminiKeyRow, b: GeminiKeyRow): void {
  const stmt = getDb().prepare('UPDATE gemini_keys SET position = ? WHERE id = ?');
  stmt.run(b.position, a.id);
  stmt.run(a.position, b.id);
}

export const deleteGeminiKeyRow = (id: string): boolean =>
  getDb().prepare('DELETE FROM gemini_keys WHERE id = ?').run(id).changes > 0;

export function recordGeminiKeyUse(id: string): void {
  getDb().prepare('UPDATE gemini_keys SET uses = uses + 1, last_used_at = ?, last_error = NULL WHERE id = ?').run(nowIso(), id);
}

export function recordGeminiKeyError(id: string, message: string): void {
  getDb().prepare('UPDATE gemini_keys SET last_error = ? WHERE id = ?').run(message.slice(0, 300), id);
}

/** Troca o segredo armazenado (usado na migração de chaves legadas em texto puro). */
export function replaceGeminiKeySecret(id: string, encryptedKey: string, hash: string, last4: string): void {
  getDb().prepare('UPDATE gemini_keys SET api_key = ?, key_hash = ?, key_last4 = ? WHERE id = ?').run(encryptedKey, hash, last4, id);
}

export const setGeminiKeyHash = (id: string, hash: string): void => {
  getDb().prepare('UPDATE gemini_keys SET key_hash = ? WHERE id = ?').run(hash, id);
};
