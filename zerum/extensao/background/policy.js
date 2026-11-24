/**
 * Quem pode falar com a extensão e de onde ela pode baixar arquivos. Funções puras (testadas no Node).
 *
 *  - SITE: só a página do Zerum local (origem na lista permitida, quadro principal, caminho /zerum). A lista padrão é
 *    http://127.0.0.1:3100 e http://localhost:3100; o usuário acrescenta outra porta no popup (ex.: um smoke na 3101).
 *    Uma página qualquer em outra porta/host do mesmo computador NÃO manda na extensão.
 *  - ABA DO FLOW: só https://flow.google.com, quadro principal.
 *  - POPUP: só a própria página do popup.
 *  - MÍDIA: o service worker só baixa de hosts do Google que servem os clipes do Flow, por https.
 */
import { MEDIA_HOSTS } from '../drivers/selectors.js';

export const FLOW_ORIGIN = 'https://flow.google.com';
export const SITE_BASE_PATH = '/zerum';
export const DEFAULT_ORIGINS = ['http://127.0.0.1:3100', 'http://localhost:3100'];

const LOOPBACK = new Set(['127.0.0.1', 'localhost', '[::1]']);

/** "http://127.0.0.1:3100/qualquer/coisa" → "http://127.0.0.1:3100". Só http em loopback; senão null. */
export function normalizeOrigin(value) {
  try {
    const u = new URL(String(value).trim());
    if (u.protocol !== 'http:' || !LOOPBACK.has(u.hostname) || u.username || u.password) return null;
    return `http://${u.hostname}${u.port ? `:${u.port}` : ''}`;
  } catch {
    return null;
  }
}

export const onSitePath = (pathname) => pathname === SITE_BASE_PATH || pathname.startsWith(`${SITE_BASE_PATH}/`);

const parse = (url) => {
  try {
    return new URL(url);
  } catch {
    return null;
  }
};

export function isSiteSender(sender, origins = DEFAULT_ORIGINS) {
  const u = parse(sender?.url ?? '');
  if (!u || (sender.frameId ?? 0) !== 0) return false;
  const origin = normalizeOrigin(u.origin);
  return !!origin && origins.includes(origin) && onSitePath(u.pathname);
}

export function isFlowSender(sender) {
  const u = parse(sender?.url ?? '');
  return !!u && u.origin === FLOW_ORIGIN && (sender.frameId ?? 0) === 0;
}

export const isPopupSender = (sender, popupUrl) => !!sender?.url && sender.url.split('#')[0].split('?')[0] === popupUrl;

/** Só https e só hosts conhecidos do Flow: nada de URL arbitrária vinda de uma página. */
export function isAllowedMediaUrl(url) {
  const u = parse(url);
  return !!u && u.protocol === 'https:' && !u.username && !u.password && (MEDIA_HOSTS.includes(u.hostname) || u.hostname === 'flow.google.com');
}

/** Cabeçalho de um MP4/ISO-BMFF: bytes 4..8 = "ftyp". */
export const looksLikeMp4 = (b) => b.length >= 12 && b[4] === 0x66 && b[5] === 0x74 && b[6] === 0x79 && b[7] === 0x70;
