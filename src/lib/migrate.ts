/**
 * Aplicação das migrações (lib/migrations.ts) de forma segura para vários processos.
 *
 *  - Cada migração roda em `BEGIN IMMEDIATE`: o 2º processo espera o lock e, ao entrar, RELÊ a versão —
 *    se outro já aplicou, pula (antes, dois `next` simultâneos duplicavam colunas e falhavam).
 *  - `foreign_keys` fica OFF durante a aplicação (necessário para reconstruir tabelas referenciadas) e é
 *    religado ao final, depois de `PRAGMA foreign_key_check` provar que nada ficou órfão.
 */
import type Database from 'better-sqlite3';

export function runMigrations(db: Database.Database, migrations: readonly string[]): void {
  if ((db.pragma('user_version', { simple: true }) as number) >= migrations.length) return;

  db.pragma('foreign_keys = OFF');
  try {
    for (let v = 0; v < migrations.length; v++) {
      db.exec('BEGIN IMMEDIATE');
      try {
        const current = db.pragma('user_version', { simple: true }) as number; // relido já com o lock
        if (current <= v) {
          db.exec(migrations[v]);
          db.pragma(`user_version = ${v + 1}`);
          const orphans = db.pragma('foreign_key_check') as unknown[];
          if (orphans.length > 0) throw new Error(`A migração v${v + 1} deixou ${orphans.length} referência(s) órfã(s)`);
        }
        db.exec('COMMIT');
      } catch (e) {
        db.exec('ROLLBACK');
        throw e;
      }
    }
  } finally {
    db.pragma('foreign_keys = ON');
  }
}
