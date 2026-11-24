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
    expect(tables(db)).toEqual(['avatars', 'batches', 'conversations', 'events', 'feedback', 'messages', 'plans', 'settings', 'videos', 'virals']);
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
    db.prepare("INSERT INTO batches (id, source, title, quantity, state) VALUES ('b','diretor','t',1,'parado')").run(); // v2: estado 'parado'
    expect(() => db.prepare("INSERT INTO videos (id, batch_id, idx, state) VALUES ('v','b',0,'inventado')").run()).toThrow();
    expect(() => db.prepare("INSERT INTO events (scope, ref_id, message) VALUES ('inventado','x','m')").run()).toThrow();
    db.prepare("INSERT INTO events (scope, ref_id, message) VALUES ('app','global','m')").run();
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

describe('v1 → v2 (append-only, sem perder dados)', () => {
  it('lotes, eventos, virais, avatares e conversas do v1 sobrevivem; colunas novas ganham padrões seguros', () => {
    const db = new Database(':memory:');
    runMigrations(db, MIGRATIONS.slice(0, 1)); // só o v1
    expect(db.pragma('user_version', { simple: true })).toBe(1);
    db.prepare("INSERT INTO virals (id, hash, name, size_bytes) VALUES ('v','h','a.mp4',10)").run();
    db.prepare("INSERT INTO conversations (id, viral_id) VALUES ('c','v')").run();
    db.prepare("INSERT INTO batches (id, conversation_id, viral_id, source, title, quantity, state, word) VALUES ('b','c','v','diretor','Lote',3,'preparando','link')").run();
    db.prepare("INSERT INTO events (scope, ref_id, message) VALUES ('batch','b','criado')").run();
    db.prepare("INSERT INTO avatars (id, name, description) VALUES ('a','Ana','enfermeira')").run();

    runMigrations(db, MIGRATIONS); // v2 por cima
    expect(db.pragma('user_version', { simple: true })).toBe(MIGRATIONS.length);

    expect(db.prepare("SELECT title, quantity, state, word, path, variation, stop_requested, archived FROM batches WHERE id = 'b'").get()).toEqual({
      title: 'Lote', quantity: 3, state: 'preparando', word: 'link', path: 'igual', variation: 'sem', stop_requested: 0, archived: 0,
    });
    expect(db.prepare("SELECT message FROM events WHERE ref_id = 'b'").get()).toEqual({ message: 'criado' });
    expect(db.prepare("SELECT name, gender, photo_hash, origin FROM avatars WHERE id = 'a'").get()).toEqual({ name: 'Ana', gender: '', photo_hash: null, origin: 'manual' });
    expect(db.prepare("SELECT analysis, duration_s FROM virals WHERE id = 'v'").get()).toEqual({ analysis: null, duration_s: null });
    expect(db.prepare("SELECT viral_id FROM conversations WHERE id = 'c'").get()).toEqual({ viral_id: 'v' });
    // o índice recriado e o AUTOINCREMENT continuam funcionando
    db.prepare("INSERT INTO events (scope, ref_id, message) VALUES ('batch','b','segundo')").run();
    expect((db.prepare("SELECT id FROM events WHERE message = 'segundo'").get() as { id: number }).id).toBe(2);
    // referências de conversa/viral continuam com ON DELETE SET NULL no lote reconstruído
    db.prepare("DELETE FROM virals WHERE id = 'v'").run();
    expect(db.prepare("SELECT viral_id FROM batches WHERE id = 'b'").get()).toEqual({ viral_id: null });
    // apagar o lote leva os vídeos junto (cascata)
    db.prepare("INSERT INTO videos (id, batch_id, idx) VALUES ('x','b',0)").run();
    db.prepare("DELETE FROM batches WHERE id = 'b'").run();
    expect((db.prepare('SELECT COUNT(*) AS n FROM videos').get() as { n: number }).n).toBe(0);
  });
});
