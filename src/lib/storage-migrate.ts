/**
 * Troca da pasta de armazenamento SEM deixar arquivos órfãos.
 *
 * O banco guarda só caminhos relativos; por isso, mudar a pasta exige levar os arquivos junto. Fluxo:
 *   1. `prepareStorageMigration` copia tudo para a pasta nova de forma ASSÍNCRONA (não trava o servidor em
 *      pastas grandes) e CONFERE (nº de arquivos e bytes; a pasta antiga também não pode ter mudado durante a cópia);
 *   2. o chamador grava a nova configuração;
 *   3. `commit()` apaga o conteúdo antigo — ou `rollback()` desfaz a cópia se a gravação falhou.
 * Recusa destino que não esteja vazio ou que esteja aninhado na pasta atual (e vice-versa).
 * Quem chama (settings-service) recusa a troca enquanto houver trabalho em fila/andamento.
 */
import fs from 'node:fs';
import fsp from 'node:fs/promises';
import path from 'node:path';
import { AppError } from './errors';

export interface StorageMigration {
  moved: number;
  commit(): void;
  rollback(): void;
}

const PROBE = /^\.write-test-/;

const entriesOf = (dir: string): string[] => (fs.existsSync(dir) ? fs.readdirSync(dir).filter((n) => !PROBE.test(n)) : []);

async function walk(dir: string, acc = { files: 0, bytes: 0 }): Promise<{ files: number; bytes: number }> {
  for (const entry of await fsp.readdir(dir, { withFileTypes: true })) {
    if (PROBE.test(entry.name)) continue;
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) await walk(full, acc);
    else if (entry.isFile()) {
      acc.files++;
      acc.bytes += (await fsp.stat(full)).size;
    }
  }
  return acc;
}

const isInside = (child: string, parent: string) => child === parent || child.startsWith(parent + path.sep);

/** Só uma troca por vez: duas cópias simultâneas deixariam o estado ambíguo. */
let migrating = false;

export async function prepareStorageMigration(fromDir: string, toDir: string): Promise<StorageMigration> {
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
  if (migrating) throw new AppError(409, 'Já existe uma troca de pasta de armazenamento em andamento. Aguarde terminar.');

  migrating = true;
  try {
    const before = await walk(from);
    await fsp.mkdir(to, { recursive: true });
    const names = entriesOf(from);
    try {
      for (const name of names) {
        await fsp.cp(path.join(from, name), path.join(to, name), { recursive: true, errorOnExist: true, force: false });
      }
      const after = await walk(to);
      if (after.files !== before.files || after.bytes !== before.bytes) {
        throw new Error(`conferência falhou (${after.files}/${before.files} arquivos, ${after.bytes}/${before.bytes} bytes)`);
      }
      // A cópia é assíncrona: se algo gravou na pasta antiga enquanto isso, a cópia ficou desatualizada.
      const now = await walk(from);
      if (now.files !== before.files || now.bytes !== before.bytes) {
        throw new Error('arquivos foram adicionados ou alterados durante a cópia; tente novamente sem enviar arquivos ao mesmo tempo');
      }
    } catch (e) {
      for (const name of names) await fsp.rm(path.join(to, name), { recursive: true, force: true });
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
  } finally {
    migrating = false;
  }
}
