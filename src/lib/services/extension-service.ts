/**
 * Extensão Chrome: pareamento de navegadores e sinal de vida.
 *
 * Fluxo:
 *  1. O usuário dá um nome ao Chrome e clica em "Criar código de pareamento" → código de 8
 *     caracteres, de uso único, válido por 10 minutos.
 *  2. Na extensão, digita o código → POST /api/extension/pair → recebe um TOKEN.
 *  3. A extensão usa `Authorization: Bearer <token>` nas chamadas seguintes (heartbeat etc.).
 *
 * Só o hash SHA-256 do token fica no banco. Vários navegadores podem estar pareados ao mesmo tempo.
 */
import { createHash, randomBytes, randomInt } from 'node:crypto';
import { transaction } from '../db';
import { AppError, notFound } from '../errors';
import {
  deleteBrowserRow,
  deletePairingCodes,
  findBrowserByTokenHash,
  findPairingCode,
  getCurrentPairingCode,
  insertBrowserRow,
  listBrowserRows,
  recordHeartbeat,
  replacePairingCode,
  type BrowserRow,
} from '../repo/extension';
import type { BrowserDTO, ExtensionOverviewDTO, PairingCodeDTO } from '../types';

const CODE_TTL_MS = 10 * 60_000;
const ONLINE_WINDOW_MS = 120_000;
/** Por quanto tempo o último estado do Flow informado vale se heartbeats seguintes não o trouxerem. */
export const FLOW_STATE_TTL_MS = 5 * 60_000;
const MAX_FAILED_PAIRINGS = 10;
const FAILED_WINDOW_MS = 10 * 60_000;
// Sem 0/O/1/I/L para evitar confusão ao digitar.
const CODE_ALPHABET = 'ABCDEFGHJKMNPQRSTUVWXYZ23456789';

const sha256 = (s: string) => createHash('sha256').update(s).digest('hex');
const normalizeCode = (c: string) => c.toUpperCase().replace(/[^A-Z0-9]/g, '');
/** "ABCD2345" → "ABCD-2345" */
const displayCode = (c: string) => `${c.slice(0, 4)}-${c.slice(4)}`;

declare global {
  // eslint-disable-next-line no-var
  var __coldclickPairFailures: { count: number; windowStart: number } | undefined;
}

/** Limite global de tentativas erradas (anti força-bruta do código de 8 caracteres). */
function registerFailedPairing(): void {
  const now = Date.now();
  const state = (globalThis.__coldclickPairFailures ??= { count: 0, windowStart: now });
  if (now - state.windowStart > FAILED_WINDOW_MS) {
    state.count = 0;
    state.windowStart = now;
  }
  state.count++;
}

function assertNotRateLimited(): void {
  const state = globalThis.__coldclickPairFailures;
  if (state && Date.now() - state.windowStart <= FAILED_WINDOW_MS && state.count >= MAX_FAILED_PAIRINGS) {
    throw new AppError(429, 'Muitas tentativas com código inválido. Aguarde alguns minutos e gere um novo código.');
  }
}

/** O estado do Flow só vale enquanto o último relato for recente (e o navegador estiver online). */
const flowStateFresh = (r: BrowserRow): boolean =>
  r.flow_reported_at !== null && Date.now() - new Date(r.flow_reported_at).getTime() < FLOW_STATE_TTL_MS;

const toBrowserDTO = (r: BrowserRow): BrowserDTO => ({
  id: r.id,
  name: r.name,
  version: r.version,
  online: Date.now() - new Date(r.last_seen_at).getTime() < ONLINE_WINDOW_MS,
  flowSessionActive: r.flow_session_active === 1 && flowStateFresh(r),
  flowAccountEmail: flowStateFresh(r) ? r.flow_account_email : null,
  pairedAt: r.paired_at,
  lastSeenAt: r.last_seen_at,
});

export const listBrowsers = (): BrowserDTO[] => listBrowserRows().map(toBrowserDTO);

function currentCode(): PairingCodeDTO | null {
  const row = getCurrentPairingCode();
  if (!row) return null;
  if (new Date(row.expires_at).getTime() <= Date.now()) {
    deletePairingCodes();
    return null;
  }
  return { code: displayCode(row.code), browserName: row.browser_name, expiresAt: row.expires_at };
}

export function getExtensionOverview(): ExtensionOverviewDTO {
  const browsers = listBrowsers();
  const online = browsers.filter((b) => b.online);
  return {
    browsers,
    onlineCount: online.length,
    flowSessionActive: online.some((b) => b.flowSessionActive),
    pairingCode: currentCode(),
  };
}

export function createPairingCode(browserName: string): PairingCodeDTO {
  const code = Array.from({ length: 8 }, () => CODE_ALPHABET[randomInt(CODE_ALPHABET.length)]).join('');
  replacePairingCode(code, browserName.trim(), new Date(Date.now() + CODE_TTL_MS).toISOString());
  return currentCode()!;
}

/** Troca um código válido por um token de acesso (uso único). */
export function completePairing(input: { code: string; version?: string }): { token: string } {
  assertNotRateLimited();
  return transaction(() => {
    const row = findPairingCode(normalizeCode(input.code));
    if (!row || new Date(row.expires_at).getTime() <= Date.now()) {
      registerFailedPairing();
      throw new AppError(401, 'Código inválido ou expirado');
    }
    const token = randomBytes(32).toString('hex');
    const id = randomBytes(16).toString('hex');
    insertBrowserRow({ id, name: row.browser_name, tokenHash: sha256(token) });
    deletePairingCodes(); // uso único
    if (input.version) recordHeartbeat(id, { version: input.version });
    return { token };
  });
}

/** Valida o token Bearer e devolve o navegador pareado (ou null). */
export function authenticateBrowser(authorizationHeader: string | null): BrowserRow | null {
  const token = authorizationHeader?.replace(/^Bearer\s+/i, '').trim();
  if (!token) return null;
  return findBrowserByTokenHash(sha256(token));
}

export function registerHeartbeat(
  browser: BrowserRow,
  info: { version?: string; flowSessionActive?: boolean; flowAccountEmail?: string | null },
): void {
  const reportsFlow = info.flowSessionActive !== undefined || info.flowAccountEmail !== undefined;
  recordHeartbeat(browser.id, {
    version: info.version ?? browser.version,
    // Heartbeat sem o campo NÃO zera o estado: mantém o último relato válido (expira por TTL).
    flow: reportsFlow
      ? { sessionActive: info.flowSessionActive ?? browser.flow_session_active === 1, accountEmail: info.flowAccountEmail?.toLowerCase() ?? browser.flow_account_email }
      : undefined,
  });
}

/** Revoga o pareamento de um navegador (o token deixa de valer imediatamente). */
export function revokeBrowser(id: string): void {
  if (!deleteBrowserRow(id)) throw notFound('Navegador');
}
