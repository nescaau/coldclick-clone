import Database from 'better-sqlite3';
import { describe, expect, it } from 'vitest';
import { runMigrations } from './migrate';
import { MIGRATIONS } from './migrations';

const tables = (db: Database.Database) =>
  (db.prepare("SELECT name FROM sqlite_master WHERE type = 'table' AND name NOT LIKE 'sqlite_%' ORDER BY name").all() as { name: string }[]).map((r) => r.name);

describe('migrações', () => {
  it('aplica o schema inicial e grava user_version', () => {
    const db = new Database(':memory:');
    runMigrations(db, MIGRATIONS);
    expect(db.pragma('user_version', { simple: true })).toBe(MIGRATIONS.length);
    expect(tables(db)).toEqual(['avatars', 'batches', 'conversations', 'events', 'feedback', 'messages', 'settings', 'virals']);
    expect(db.pragma('foreign_keys', { simple: true })).toBe(1);
  });

  it('é idempotente (rodar de novo não duplica nem falha)', () => {
    const db = new Database(':memory:');
    runMigrations(db, MIGRATIONS);
    runMigrations(db, MIGRATIONS);
    expect(db.pragma('user_version', { simple: true })).toBe(MIGRATIONS.length);
  });

  it('migrações novas são aplicadas por cima sem refazer as antigas', () => {
    const db = new Database(':memory:');
    runMigrations(db, MIGRATIONS);
    runMigrations(db, [...MIGRATIONS, 'ALTER TABLE avatars ADD COLUMN extra TEXT;']);
    expect(db.pragma('user_version', { simple: true })).toBe(MIGRATIONS.length + 1);
    expect((db.pragma('table_info(avatars)') as { name: string }[]).some((c) => c.name === 'extra')).toBe(true);
  });

  it('uma migração que falha faz rollback e não avança a versão', () => {
    const db = new Database(':memory:');
    expect(() => runMigrations(db, ['CREATE TABLE a (x INTEGER);', 'CREATE TABLE a (x INTEGER);'])).toThrow();
    expect(db.pragma('user_version', { simple: true })).toBe(1);
  });

  it('CHECKs do schema: modo, papel e estado inválidos são recusados', () => {
    const db = new Database(':memory:');
    runMigrations(db, MIGRATIONS);
    expect(() => db.prepare("INSERT INTO conversations (id, mode) VALUES ('c', 'outro')").run()).toThrow();
    db.prepare("INSERT INTO conversations (id) VALUES ('c')").run();
    expect(() => db.prepare("INSERT INTO messages (id, conversation_id, role, text) VALUES ('m','c','robo','x')").run()).toThrow();
    expect(() => db.prepare("INSERT INTO batches (id, source, title, quantity, state) VALUES ('b','diretor','t',1,'inventado')").run()).toThrow();
  });

  it('apagar a conversa apaga as mensagens; apagar o viral só solta a referência', () => {
    const db = new Database(':memory:');
    runMigrations(db, MIGRATIONS);
    db.prepare("INSERT INTO virals (id, hash, name, size_bytes) VALUES ('v','h','a.mp4',1)").run();
    db.prepare("INSERT INTO conversations (id, viral_id) VALUES ('c','v')").run();
    db.prepare("INSERT INTO messages (id, conversation_id, role, text) VALUES ('m','c','aluna','oi')").run();
    db.prepare('DELETE FROM virals WHERE id = ?').run('v');
    expect((db.prepare("SELECT viral_id FROM conversations WHERE id = 'c'").get() as { viral_id: string | null }).viral_id).toBeNull();
    db.prepare('DELETE FROM conversations WHERE id = ?').run('c');
    expect((db.prepare('SELECT COUNT(*) AS n FROM messages').get() as { n: number }).n).toBe(0);
  });
});
