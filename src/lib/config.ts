import path from 'node:path';
import { MAX_PHOTO_MB, MAX_VIDEO_MB } from './limits';

/** Pasta base de dados locais (banco SQLite + arquivos). Configurável via env. */
export const DATA_DIR = path.resolve(process.env.COLDCLICK_DATA_DIR ?? path.join(process.cwd(), 'data'));
export const DB_PATH = path.join(DATA_DIR, 'coldclick.db');

/** Pasta de armazenamento padrão (pode ser trocada em Configurações). */
export const DEFAULT_STORAGE_DIR = path.join(DATA_DIR, 'storage');

// Os limites em MB/quantidade vivem em limits.ts (a interface também os exibe).
export { MAX_GEMINI_KEYS } from './limits';
export const MAX_VIDEO_BYTES = MAX_VIDEO_MB * 1024 * 1024;
export const MAX_IMAGE_BYTES = MAX_PHOTO_MB * 1024 * 1024; // por foto de referência

/** Cota de armazenamento da conta (vídeos enviados + arquivos gerados). */
export const STORAGE_QUOTA_BYTES = 2 * 1024 * 1024 * 1024; // 2 GiB

/**
 * Quando "1", a etapa Revisão só libera com o Chrome pareado e online (como na plataforma original).
 * Padrão desligado: na fase 1 a geração é simulada e não depende da extensão.
 */
export const REQUIRE_FLOW_CONNECTION = process.env.COLDCLICK_REQUIRE_FLOW === '1';

/** Extensões aceitas → MIME. O MIME enviado pelo navegador não é confiável (ex.: .mov vem vazio). */
export const VIDEO_TYPES: Record<string, string> = {
  '.mp4': 'video/mp4',
  '.mov': 'video/quicktime',
  '.webm': 'video/webm',
};

/** SVG fica de fora de propósito: SVG enviado por usuário pode conter script. */
export const IMAGE_TYPES: Record<string, string> = {
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.png': 'image/png',
  '.webp': 'image/webp',
};

/** Tipos servidos pela rota /api/files (inclui o SVG dos placeholders gerados pelo próprio app). */
export const SERVABLE_TYPES: Record<string, string> = {
  ...VIDEO_TYPES,
  ...IMAGE_TYPES,
  '.svg': 'image/svg+xml',
};
