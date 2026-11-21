/** Repositório dos navegadores pareados e dos códigos de pareamento. Só SQL. */
import { getDb, nowIso } from '../db';

export interface BrowserRow {
  id: string;
  name: string;
  token_hash: string;
  version: string | null;
  flow_session_active: number;
  flow_account_email: string | null;
  flow_reported_at: string | null;
  paired_at: string;
  last_seen_at: string;
}

export interface PairingCodeRow {
  code: string;
  browser_name: string;
  expires_at: string;
}

export const listBrowserRows = (): BrowserRow[] =>
  getDb().prepare('SELECT * FROM extension_browsers ORDER BY paired_at').all() as BrowserRow[];

export const findBrowserByTokenHash = (hash: string): BrowserRow | null =>
  (getDb().prepare('SELECT * FROM extension_browsers WHERE token_hash = ?').get(hash) as BrowserRow | undefined) ?? null;

export function insertBrowserRow(b: { id: string; name: string; tokenHash: string }): void {
  const now = nowIso();
  getDb()
    .prepare('INSERT INTO extension_browsers (id, name, token_hash, paired_at, last_seen_at) VALUES (?, ?, ?, ?, ?)')
    .run(b.id, b.name, b.tokenHash, now, now);
}

/**
 * Registra um sinal de vida. `flow` só é informado quando o heartbeat TROUXE o estado do Flow; sem ele, o
 * último estado válido é preservado (o serviço decide por quanto tempo ele vale, via `flow_reported_at`).
 */
export function recordHeartbeat(
  id: string,
  info: { version: string | null; flow?: { sessionActive: boolean; accountEmail: string | null } },
): void {
  const db = getDb();
  const now = nowIso();
  if (info.flow) {
    db.prepare(
      `UPDATE extension_browsers SET last_seen_at = ?, version = ?, flow_session_active = ?, flow_account_email = ?, flow_reported_at = ? WHERE id = ?`,
    ).run(now, info.version, info.flow.sessionActive ? 1 : 0, info.flow.accountEmail, now, id);
  } else {
    db.prepare(`UPDATE extension_browsers SET last_seen_at = ?, version = ? WHERE id = ?`).run(now, info.version, id);
  }
}

export const deleteBrowserRow = (id: string): boolean =>
  getDb().prepare('DELETE FROM extension_browsers WHERE id = ?').run(id).changes > 0;

/** Há no máximo 1 código ativo por vez: um novo substitui o anterior. */
export function replacePairingCode(code: string, browserName: string, expiresAt: string): void {
  const db = getDb();
  db.prepare('DELETE FROM pairing_codes').run();
  db.prepare('INSERT INTO pairing_codes (code, browser_name, expires_at) VALUES (?, ?, ?)').run(code, browserName, expiresAt);
}

export const findPairingCode = (code: string): PairingCodeRow | null =>
  (getDb().prepare('SELECT code, browser_name, expires_at FROM pairing_codes WHERE code = ?').get(code) as
    | PairingCodeRow
    | undefined) ?? null;

export const getCurrentPairingCode = (): PairingCodeRow | null =>
  (getDb().prepare('SELECT code, browser_name, expires_at FROM pairing_codes LIMIT 1').get() as PairingCodeRow | undefined) ?? null;

export const deletePairingCodes = (): void => {
  getDb().prepare('DELETE FROM pairing_codes').run();
};
