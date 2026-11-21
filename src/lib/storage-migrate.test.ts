import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { prepareStorageMigration } from './storage-migrate';

let root: string;
const write = (rel: string, content: string) => {
  const abs = path.join(root, rel);
  fs.mkdirSync(path.dirname(abs), { recursive: true });
  fs.writeFileSync(abs, content);
};

beforeEach(() => {
  root = fs.mkdtempSync(path.join(process.env.TMPDIR ?? os.tmpdir(), 'cc-mig-'));
  write('old/videos/a.mp4', 'AAAA');
  write('old/avatars/x/ref.svg', '<svg/>');
  write('old/outputs/j/img.svg', 'IMG');
});
afterEach(() => fs.rmSync(root, { recursive: true, force: true }));

describe('prepareStorageMigration', () => {
  it('copia, confere e só então apaga o conteúdo antigo (commit)', () => {
    const m = prepareStorageMigration(path.join(root, 'old'), path.join(root, 'new'));
    expect(m.moved).toBe(3);
    expect(fs.readFileSync(path.join(root, 'new/videos/a.mp4'), 'utf8')).toBe('AAAA');
    expect(fs.existsSync(path.join(root, 'old/videos/a.mp4'))).toBe(true); // ainda não apagou
    m.commit();
    expect(fs.existsSync(path.join(root, 'old/videos'))).toBe(false);
    expect(fs.existsSync(path.join(root, 'new/outputs/j/img.svg'))).toBe(true);
  });

  it('rollback desfaz a cópia e preserva a origem', () => {
    const m = prepareStorageMigration(path.join(root, 'old'), path.join(root, 'new'));
    m.rollback();
    expect(fs.readdirSync(path.join(root, 'new'))).toEqual([]);
    expect(fs.existsSync(path.join(root, 'old/videos/a.mp4'))).toBe(true);
  });

  it('recusa destino que já tem arquivos (não mistura pastas)', () => {
    write('new/outro.txt', 'x');
    expect(() => prepareStorageMigration(path.join(root, 'old'), path.join(root, 'new'))).toThrow(/já contém arquivos/);
    expect(fs.existsSync(path.join(root, 'old/videos/a.mp4'))).toBe(true);
  });

  it('recusa pastas aninhadas (destino dentro da origem e o inverso)', () => {
    expect(() => prepareStorageMigration(path.join(root, 'old'), path.join(root, 'old/sub'))).toThrow(/dentro da pasta atual/);
    expect(() => prepareStorageMigration(path.join(root, 'old/videos'), path.join(root, 'old'))).toThrow(/dentro da pasta atual/);
  });

  it('origem vazia/inexistente e mesma pasta: nada a fazer', () => {
    expect(prepareStorageMigration(path.join(root, 'nao-existe'), path.join(root, 'new')).moved).toBe(0);
    expect(prepareStorageMigration(path.join(root, 'old'), path.join(root, 'old')).moved).toBe(0);
  });

  it('ignora o arquivo de teste de escrita na pasta de destino', () => {
    write('new/.write-test-123', 'ok');
    expect(prepareStorageMigration(path.join(root, 'old'), path.join(root, 'new')).moved).toBe(3);
  });
});
