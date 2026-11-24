/** Inicialização única do app: abre o banco (aplica migrações), garante as pastas e atualiza dados da versão anterior. */
import fs from 'node:fs';
import { AVATARS_DIR, VIRALS_DIR } from '../config';
import { getDb } from '../db';
import { APP_LOG_REF, logEvent } from '../repo/events';
import { countAvatars } from '../repo/avatars';
import { countReadyVideos } from '../repo/videos';
import { backfillViralMeta } from './viral-service';
import { materializeLegacyBatches } from './production-service';

declare global {
  // eslint-disable-next-line no-var
  var __zerumBootstrapped: boolean | undefined;
}

export function ensureBootstrapped(): void {
  if (globalThis.__zerumBootstrapped) return;
  getDb();
  fs.mkdirSync(VIRALS_DIR, { recursive: true });
  fs.mkdirSync(AVATARS_DIR, { recursive: true });
  const virais = backfillViralMeta();
  const lotes = materializeLegacyBatches();
  const a = countAvatars();
  const v = countReadyVideos();
  logEvent('app', APP_LOG_REF, `Memória local recuperada: ${a} avatar${a === 1 ? '' : 'es'}, ${v} vídeo${v === 1 ? '' : 's'} pronto${v === 1 ? '' : 's'} (neste computador).`);
  if (virais) logEvent('app', APP_LOG_REF, `${virais} viral(is) de versão anterior tiveram os metadados lidos.`);
  if (lotes) logEvent('app', APP_LOG_REF, `${lotes} lote(s) de versão anterior foram atualizados (vídeos e cenas criados).`);
  globalThis.__zerumBootstrapped = true;
}
