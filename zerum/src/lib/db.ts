import fs from 'node:fs';
import Database from 'better-sqlite3';
import { DATA_DIR, DB_PATH } from './config';
import { runMigrations } from './migrate';
import { MIGRATIONS } from './migrations';

type Db = Database.Database;

declare global {
  // Singleton em globalThis: o hot-reload do Next recria módulos, mas não pode reabrir o banco.
  // eslint-disable-next-line no-var
  var __zerumDb: Db | undefined;
}

/** Conexão única com o SQLite (síncrona, em modo WAL). */
export function getDb(): Db {
  if (!globalThis.__zerumDb) {
    fs.mkdirSync(DATA_DIR, { recursive: true });
    const db = new Database(DB_PATH);
    db.pragma('journal_mode = WAL');
    db.pragma('busy_timeout = 5000');
    runMigrations(db, MIGRATIONS); // mexe em foreign_keys por conta própria e as deixa ON
    db.pragma('foreign_keys = ON');
    globalThis.__zerumDb = db;
  }
  return globalThis.__zerumDb;
}

/** Executa `fn` em uma transação (commit ao retornar, rollback se lançar). */
export function transaction<T>(fn: () => T): T {
  return getDb().transaction(fn)();
}

export const nowIso = (): string => new Date().toISOString();
export const newId = (): string => globalThis.crypto.randomUUID();
