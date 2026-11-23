/** Inicialização única do app: abre o banco (aplica migrações) e garante a pasta dos virais. */
import fs from 'node:fs';
import { VIRALS_DIR } from '../config';
import { getDb } from '../db';

declare global {
  // eslint-disable-next-line no-var
  var __zerumBootstrapped: boolean | undefined;
}

export function ensureBootstrapped(): void {
  if (globalThis.__zerumBootstrapped) return;
  getDb();
  fs.mkdirSync(VIRALS_DIR, { recursive: true });
  globalThis.__zerumBootstrapped = true;
}
