import fs from 'node:fs';
import Database from 'better-sqlite3';
import { DATA_DIR, DB_PATH } from './config';
import { runMigrations } from './migrate';
import { MIGRATIONS } from './migrations';

type Db = Database.Database;

declare global {
  // Singleton em globalThis: o hot-reload do Next recria módulos, mas não pode reabrir o banco.
  // eslint-disable-next-line no-var
  var __coldclickDb: Db | undefined;
}

/** Conexão única com o SQLite (síncrona, em modo WAL). */
export function getDb(): Db {
  if (!globalThis.__coldclickDb) {
    fs.mkdirSync(DATA_DIR, { recursive: true });
    const db = new Database(DB_PATH);
    db.pragma('journal_mode = WAL');
    db.pragma('busy_timeout = 5000');
    runMigrations(db, MIGRATIONS); // mexe em foreign_keys por conta própria e as deixa ON
    db.pragma('foreign_keys = ON');
    globalThis.__coldclickDb = db;
  }
  return globalThis.__coldclickDb;
}

/**
 * Executa `fn` em uma transação (commit ao retornar, rollback se lançar).
 * Os serviços usam isto para garantir atomicidade de regras que tocam mais de um repositório.
 */
export function transaction<T>(fn: () => T): T {
  return getDb().transaction(fn)();
}

export const nowIso = (): string => new Date().toISOString();
