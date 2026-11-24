import path from 'node:path';

/** Pasta base de dados locais (banco SQLite + virais enviados). Configurável via ZERUM_DATA_DIR. */
export const DATA_DIR = path.resolve(process.env.ZERUM_DATA_DIR ?? path.join(process.cwd(), 'data'));
export const DB_PATH = path.join(DATA_DIR, 'zerum.db');
/** Virais enviados ficam como `<sha256>.mp4`: o nome nunca vem do usuário (sem path traversal). */
export const VIRALS_DIR = path.join(DATA_DIR, 'virais');
/** Fotos de avatares: `<sha256>.<ext>` (nome do arquivo nunca vem do usuário). */
export const AVATARS_DIR = path.join(DATA_DIR, 'avatares');
/** Clipes baixados do Flow (geração REAL): `<sha256>.mp4` — o nome é o hash do conteúdo, nunca vem de fora. */
export const FLOW_DIR = path.join(DATA_DIR, 'flow');
/** Pasta da extensão do Chrome (para o app oferecer o .zip de instalação). Configurável: o build em /tmp não leva a pasta junto. */
export const EXTENSION_DIR = path.resolve(process.env.ZERUM_EXTENSION_DIR ?? path.join(process.cwd(), 'extensao'));

export { BASE_PATH } from './config.shared';
