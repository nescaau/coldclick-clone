import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import Database from 'better-sqlite3';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { runMigrations } from './migrate';
import { MIGRATIONS } from './migrations';

let dir: string;
const open = (name = 'a.db') => new Database(path.join(dir, name));

beforeEach(() => {
  dir = fs.mkdtempSync(path.join(process.env.TMPDIR ?? os.tmpdir(), 'cc-migr-'));
});
afterEach(() => fs.rmSync(dir, { recursive: true, force: true }));

const jobInsert = `INSERT INTO jobs (id, title, avatar_id, avatar_name, avatar_description, format, variations, model, resolution, max_generations)
                   VALUES (?, ?, ?, ?, ?, '9:16', 1, 'veo-3.1-lite', '720p', 5)`;

describe('migrações', () => {
  it('banco novo chega à última versão sem órfãos', () => {
    const db = open();
    runMigrations(db, MIGRATIONS);
    expect(db.pragma('user_version', { simple: true })).toBe(MIGRATIONS.length);
    expect(db.pragma('foreign_key_check')).toEqual([]);
    expect(db.pragma('foreign_keys', { simple: true })).toBe(1);
    db.close();
  });

  it('é idempotente: rodar de novo não faz nada', () => {
    const db = open();
    runMigrations(db, MIGRATIONS);
    expect(() => runMigrations(db, MIGRATIONS)).not.toThrow();
    db.close();
  });

  it('dois processos: o segundo relê a versão e não duplica colunas', () => {
    const first = open();
    const second = open(); // mesmo arquivo
    runMigrations(first, MIGRATIONS);
    // `second` ainda "acha" que o banco é v0, mas a versão é relida sob o lock → pula tudo.
    expect(() => runMigrations(second, MIGRATIONS)).not.toThrow();
    expect(second.pragma('user_version', { simple: true })).toBe(MIGRATIONS.length);
    first.close();
    second.close();
  });

  it('uma migração que falha é revertida por inteiro (versão e esquema intactos)', () => {
    const db = open();
    runMigrations(db, MIGRATIONS.slice(0, 1));
    const broken = [...MIGRATIONS.slice(0, 1), 'CREATE TABLE ok_antes (x INTEGER); INSERT INTO tabela_inexistente VALUES (1);'];
    expect(() => runMigrations(db, broken)).toThrow();
    expect(db.pragma('user_version', { simple: true })).toBe(1);
    expect(db.prepare(`SELECT name FROM sqlite_master WHERE name = 'ok_antes'`).get()).toBeUndefined();
    db.close();
  });

  it('v4: faz o backfill de avatars_json dos trabalhos legados, preserva dados e a ordem da fila', () => {
    const db = open();
    runMigrations(db, MIGRATIONS.slice(0, 3)); // esquema v3 (antes do endurecimento)
    db.pragma('foreign_keys = ON');
    db.prepare(`INSERT INTO avatars (id, name, description) VALUES ('av1', 'Marina', 'desc da Marina')`).run();
    db.prepare(jobInsert).run('legacy', 'Legado', 'av1', 'Marina', 'desc da Marina');
    db.prepare(jobInsert).run('orig', 'Pessoa original', null, 'Pessoa original', '');
    db.prepare(`INSERT INTO job_items (id, job_id, kind, variation) VALUES ('i1', 'legacy', 'video', 1)`).run();
    db.prepare(`INSERT INTO job_events (id, job_id, label) VALUES ('e1', 'legacy', 'Trabalho criado')`).run();
    db.pragma('foreign_keys = OFF');

    runMigrations(db, MIGRATIONS);

    const legacy = db.prepare(`SELECT avatars_json, queued_at, created_at FROM jobs WHERE id = 'legacy'`).get() as {
      avatars_json: string;
      queued_at: string;
      created_at: string;
    };
    expect(JSON.parse(legacy.avatars_json)).toEqual([{ id: 'av1', name: 'Marina', description: 'desc da Marina', voice: '' }]);
    expect(legacy.queued_at).toBe(legacy.created_at);
    expect((db.prepare(`SELECT avatars_json FROM jobs WHERE id = 'orig'`).get() as { avatars_json: string }).avatars_json).toBe('[]');
    // Itens e eventos continuam ligados aos trabalhos (a reconstrução da tabela não os perdeu).
    expect(db.prepare('SELECT COUNT(*) AS n FROM job_items').get()).toEqual({ n: 1 });
    expect(db.prepare('SELECT COUNT(*) AS n FROM job_events').get()).toEqual({ n: 1 });
    expect(db.pragma('foreign_key_check')).toEqual([]);
    db.close();
  });

  it('v4: CHECKs recusam valores inválidos', () => {
    const db = open();
    runMigrations(db, MIGRATIONS);
    const bad = (col: string, value: string) =>
      db
        .prepare(
          `INSERT INTO jobs (id, title, avatar_name, avatar_description, format, variations, model, resolution, max_generations, ${col})
           VALUES ('x', 't', 'a', '', '9:16', 1, 'm', '720p', 1, ?)`,
        )
        .run(value);
    expect(() => bad('creative_format', 'inventado')).toThrow(/CHECK/);
    expect(() => bad('script_mode', 'inventado')).toThrow(/CHECK/);
    expect(() => bad('image_model', 'inventado')).toThrow(/CHECK/);
    expect(() => bad('creative_format', 'podcast')).not.toThrow();
    db.close();
  });

  it('v4: gemini_keys sem label, com key_hash único; escopo do avatar restrito', () => {
    const db = open();
    runMigrations(db, MIGRATIONS);
    const cols = (db.prepare('PRAGMA table_info(gemini_keys)').all() as { name: string }[]).map((c) => c.name);
    expect(cols).toContain('key_hash');
    expect(cols).not.toContain('label');
    db.prepare(`INSERT INTO gemini_keys (id, api_key, key_hash) VALUES ('1', 'x', 'h')`).run();
    expect(() => db.prepare(`INSERT INTO gemini_keys (id, api_key, key_hash) VALUES ('2', 'y', 'h')`).run()).toThrow(/UNIQUE/);
    expect(() => db.prepare(`INSERT INTO avatars (id, name, description, scope) VALUES ('a', 'n', 'd', 'outro')`).run()).toThrow(/CHECK/);
    db.close();
  });

  it('v4: chaves legadas continuam legíveis e ficam sem hash até o bootstrap preenchê-lo', () => {
    const db = open();
    runMigrations(db, MIGRATIONS.slice(0, 3));
    db.prepare(`INSERT INTO gemini_keys (id, api_key, key_last4, position) VALUES ('k1', 'AIzaLegacyKey12345678', '5678', 1)`).run();
    runMigrations(db, MIGRATIONS);
    expect(db.prepare(`SELECT api_key, key_hash FROM gemini_keys WHERE id = 'k1'`).get()).toEqual({ api_key: 'AIzaLegacyKey12345678', key_hash: null });
    db.close();
  });
});
