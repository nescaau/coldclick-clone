/**
 * Inicialização única do app (idempotente): dados de exemplo e migração de segredos legados.
 * Chamada pelo `api()` das rotas, pelo layout do estúdio e pelo instrumentation.
 *
 * É explícita de propósito: leituras nunca têm efeitos colaterais (antes, listar avatares fazia o seed).
 */
import { seedAvatarsOnce } from './avatar-service';
import { encryptLegacyGeminiKeys } from './gemini-key-service';
import { encryptLegacyWhisperKey } from './settings-service';

declare global {
  // eslint-disable-next-line no-var
  var __coldclickBooted: boolean | undefined;
}

export function ensureBootstrapped(): void {
  if (globalThis.__coldclickBooted) return;
  encryptLegacyGeminiKeys();
  encryptLegacyWhisperKey();
  seedAvatarsOnce();
  globalThis.__coldclickBooted = true;
}
