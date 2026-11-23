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
const old = () => path.join(root, 'old');
const fresh = () => path.join(root, 'new');

beforeEach(() => {
  root = fs.mkdtempSync(path.join(process.env.TMPDIR ?? os.tmpdir(), 'cc-mig-'));
  write('old/videos/a.mp4', 'AAAA');
  write('old/avatars/x/ref.svg', '<svg/>');
  write('old/outputs/j/img.svg', 'IMG');
});
afterEach(() => fs.rmSync(root, { recursive: true, force: true }));

describe('prepareStorageMigration', () => {
  it('copia, confere e só então apaga o conteúdo antigo (commit)', async () => {
    const m = await prepareStorageMigration(old(), fresh());
    expect(m.moved).toBe(3);
    expect(fs.readFileSync(path.join(root, 'new/videos/a.mp4'), 'utf8')).toBe('AAAA');
    expect(fs.existsSync(path.join(root, 'old/videos/a.mp4'))).toBe(true); // ainda não apagou
    m.commit();
    expect(fs.existsSync(path.join(root, 'old/videos'))).toBe(false);
    expect(fs.existsSync(path.join(root, 'new/outputs/j/img.svg'))).toBe(true);
  });

  it('rollback desfaz a cópia e preserva a origem', async () => {
    const m = await prepareStorageMigration(old(), fresh());
    m.rollback();
    expect(fs.readdirSync(fresh())).toEqual([]);
    expect(fs.existsSync(path.join(root, 'old/videos/a.mp4'))).toBe(true);
  });

  it('recusa destino que já tem arquivos (não mistura pastas)', async () => {
    write('new/outro.txt', 'x');
    await expect(prepareStorageMigration(old(), fresh())).rejects.toThrow(/já contém arquivos/);
    expect(fs.existsSync(path.join(root, 'old/videos/a.mp4'))).toBe(true);
  });

  it('recusa pastas aninhadas (destino dentro da origem e o inverso)', async () => {
    await expect(prepareStorageMigration(old(), path.join(root, 'old/sub'))).rejects.toThrow(/dentro da pasta atual/);
    await expect(prepareStorageMigration(path.join(root, 'old/videos'), old())).rejects.toThrow(/dentro da pasta atual/);
  });

  it('origem vazia/inexistente e mesma pasta: nada a fazer', async () => {
    expect((await prepareStorageMigration(path.join(root, 'nao-existe'), fresh())).moved).toBe(0);
    expect((await prepareStorageMigration(old(), old())).moved).toBe(0);
  });

  it('ignora o arquivo de teste de escrita na pasta de destino', async () => {
    write('new/.write-test-123', 'ok');
    expect((await prepareStorageMigration(old(), fresh())).moved).toBe(3);
  });

  it('não bloqueia o event loop: um timer dispara enquanto a cópia ainda roda', async () => {
    for (let i = 0; i < 200; i++) write(`old/outputs/many/f${i}.bin`, 'x'.repeat(256));
    let ticks = 0;
    const timer = setInterval(() => ticks++, 1);
    try {
      await prepareStorageMigration(old(), fresh());
    } finally {
      clearInterval(timer);
    }
    expect(ticks).toBeGreaterThan(0);
  });

  it('recusa duas trocas simultâneas', async () => {
    const first = prepareStorageMigration(old(), fresh());
    await expect(prepareStorageMigration(old(), path.join(root, 'other'))).rejects.toThrow(/em andamento/);
    expect((await first).moved).toBe(3);
  });
});
