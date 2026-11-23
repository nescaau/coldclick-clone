import path from 'node:path';

/** Pasta base de dados locais (banco SQLite + virais enviados). Configurável via ZERUM_DATA_DIR. */
export const DATA_DIR = path.resolve(process.env.ZERUM_DATA_DIR ?? path.join(process.cwd(), 'data'));
export const DB_PATH = path.join(DATA_DIR, 'zerum.db');
/** Virais enviados ficam como `<sha256>.mp4`: o nome nunca vem do usuário (sem path traversal). */
export const VIRALS_DIR = path.join(DATA_DIR, 'virais');

export { BASE_PATH } from './config.shared';
