/**
 * Troca da pasta de armazenamento SEM deixar arquivos órfãos.
 *
 * O banco guarda só caminhos relativos; por isso, mudar a pasta exige levar os arquivos junto. Fluxo:
 *   1. `prepareStorageMigration` copia tudo para a pasta nova e CONFERE (nº de arquivos e bytes);
 *   2. o chamador grava a nova configuração;
 *   3. `commit()` apaga o conteúdo antigo — ou `rollback()` desfaz a cópia se a gravação falhou.
 * Recusa destino que não esteja vazio ou que esteja aninhado na pasta atual (e vice-versa).
 */
import fs from 'node:fs';
import path from 'node:path';
import { AppError } from './errors';

export interface StorageMigration {
  moved: number;
  commit(): void;
  rollback(): void;
}

const PROBE = /^\.write-test-/;

const entriesOf = (dir: string): string[] => (fs.existsSync(dir) ? fs.readdirSync(dir).filter((n) => !PROBE.test(n)) : []);

function walk(dir: string, acc = { files: 0, bytes: 0 }): { files: number; bytes: number } {
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    if (PROBE.test(entry.name)) continue;
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) walk(full, acc);
    else if (entry.isFile()) {
      acc.files++;
      acc.bytes += fs.statSync(full).size;
    }
  }
  return acc;
}

const isInside = (child: string, parent: string) => child === parent || child.startsWith(parent + path.sep);

export function prepareStorageMigration(fromDir: string, toDir: string): StorageMigration {
  const from = path.resolve(fromDir);
  const to = path.resolve(toDir);
  const noop: StorageMigration = { moved: 0, commit() {}, rollback() {} };
  if (from === to || entriesOf(from).length === 0) return noop;

  if (isInside(to, from) || isInside(from, to)) {
    throw new AppError(400, 'A nova pasta não pode ficar dentro da pasta atual (nem conter a atual). Escolha outra pasta.');
  }
  if (entriesOf(to).length > 0) {
    throw new AppError(
      400,
      `A pasta "${to}" já contém arquivos. Escolha uma pasta vazia — os arquivos atuais (vídeos, avatares e gerações) serão copiados para ela.`,
    );
  }

  const before = walk(from);
  fs.mkdirSync(to, { recursive: true });
  const names = entriesOf(from);
  const copied: string[] = [];
  try {
    for (const name of names) {
      fs.cpSync(path.join(from, name), path.join(to, name), { recursive: true, errorOnExist: true, force: false });
      copied.push(name);
    }
    const after = walk(to);
    if (after.files !== before.files || after.bytes !== before.bytes) {
      throw new Error(`conferência falhou (${after.files}/${before.files} arquivos, ${after.bytes}/${before.bytes} bytes)`);
    }
  } catch (e) {
    for (const name of copied) fs.rmSync(path.join(to, name), { recursive: true, force: true });
    for (const name of names) if (!copied.includes(name)) fs.rmSync(path.join(to, name), { recursive: true, force: true });
    throw new AppError(500, `Não foi possível copiar os arquivos para a nova pasta: ${e instanceof Error ? e.message : String(e)}`);
  }

  return {
    moved: before.files,
    commit() {
      for (const name of names) fs.rmSync(path.join(from, name), { recursive: true, force: true });
    },
    rollback() {
      for (const name of names) fs.rmSync(path.join(to, name), { recursive: true, force: true });
    },
  };
}
