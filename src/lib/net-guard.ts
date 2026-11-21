/**
 * Proteção contra SSRF na importação de vídeo por URL.
 *
 *  1. Só http(s), sem credenciais na URL.
 *  2. TODOS os endereços que o nome resolve precisam ser públicos (uma resposta DNS mista é recusada).
 *  3. O IP validado é FIXADO na conexão (`lookup` próprio): não há segunda resolução entre "checar" e
 *     "conectar", o que mata DNS rebinding.
 *  4. Redirecionamentos são seguidos manualmente, revalidando e fixando o IP a cada salto; o corpo das
 *     respostas 3xx é descartado.
 *  5. IPv6 "disfarçado" é desmapeado antes da checagem: ::ffff:7f00:1, NAT64 (64:ff9b::/96), 6to4 (2002::/16)
 *     e IPv4-compatível passam pelas regras de IPv4; Teredo é bloqueado.
 */
import dns from 'node:dns/promises';
import http from 'node:http';
import https from 'node:https';
import net from 'node:net';
import { Readable } from 'node:stream';
import { AppError } from './errors';

const PRIVATE_MESSAGE = 'Este endereço aponta para uma rede interna e não é permitido';

/* ---------------- listas de bloqueio ---------------- */

const V4_RANGES: Array<[string, number]> = [
  ['0.0.0.0', 8],
  ['10.0.0.0', 8],
  ['100.64.0.0', 10], // CGNAT
  ['127.0.0.0', 8],
  ['169.254.0.0', 16], // link-local / metadata de nuvem
  ['172.16.0.0', 12],
  ['192.0.0.0', 24],
  ['192.0.2.0', 24],
  ['192.88.99.0', 24],
  ['192.168.0.0', 16],
  ['198.18.0.0', 15],
  ['198.51.100.0', 24],
  ['203.0.113.0', 24],
  ['224.0.0.0', 4], // multicast
  ['240.0.0.0', 4], // reservado + broadcast
];
const V6_RANGES: Array<[string, number]> = [
  ['::', 128],
  ['::1', 128],
  ['100::', 64], // discard
  ['2001::', 32], // Teredo
  ['2001:db8::', 32], // documentação
  ['fc00::', 7], // ULA
  ['fe80::', 10], // link-local
  ['fec0::', 10], // site-local (obsoleto)
  ['ff00::', 8], // multicast
];

const blockV4 = new net.BlockList();
const blockV6 = new net.BlockList();
V4_RANGES.forEach(([addr, prefix]) => blockV4.addSubnet(addr, prefix, 'ipv4'));
V6_RANGES.forEach(([addr, prefix]) => blockV6.addSubnet(addr, prefix, 'ipv6'));

/* ---------------- parsing de IPv6 ---------------- */

/** 8 grupos de 16 bits, ou null se não for um IPv6 válido. */
export function ipv6ToHextets(input: string): number[] | null {
  let s = input.split('%')[0].toLowerCase();
  let tail: number[] | null = null;

  const dotted = s.match(/(\d+\.\d+\.\d+\.\d+)$/);
  if (dotted) {
    const o = dotted[1].split('.').map(Number);
    if (o.some((x) => x > 255)) return null;
    tail = [(o[0] << 8) | o[1], (o[2] << 8) | o[3]];
    s = s.slice(0, -dotted[1].length) + '0:0';
  }

  const parts = s.split('::');
  if (parts.length > 2) return null;
  const head = parts[0] ? parts[0].split(':') : [];
  const rest = parts.length === 2 && parts[1] ? parts[1].split(':') : [];
  const fill = parts.length === 2 ? 8 - head.length - rest.length : 0;
  if (fill < 0 || (parts.length === 1 && head.length !== 8) || (parts.length === 2 && fill < 1)) return null;

  const groups = [...head, ...Array<string>(fill).fill('0'), ...rest].map((h) => (/^[0-9a-f]{1,4}$/.test(h) ? parseInt(h, 16) : NaN));
  if (groups.length !== 8 || groups.some(Number.isNaN)) return null;
  if (tail) [groups[6], groups[7]] = tail;
  return groups;
}

const v4From = (hi: number, lo: number) => `${hi >> 8}.${hi & 255}.${lo >> 8}.${lo & 255}`;

/** IPv4 embutido em um IPv6 "de transição" (mapeado, NAT64, 6to4, compatível), ou null. */
export function embeddedIPv4(h: number[]): string | null {
  const zeros = (from: number, to: number) => h.slice(from, to).every((x) => x === 0);
  if (zeros(0, 5) && h[5] === 0xffff) return v4From(h[6], h[7]); // ::ffff:a.b.c.d
  if (zeros(0, 6) && (h[6] !== 0 || h[7] > 1)) return v4From(h[6], h[7]); // ::a.b.c.d (compatível, obsoleto)
  if (h[0] === 0x64 && h[1] === 0xff9b && zeros(2, 6)) return v4From(h[6], h[7]); // NAT64 64:ff9b::/96
  if (h[0] === 0x2002) return v4From(h[1], h[2]); // 6to4
  return null;
}

/** O endereço é interno/reservado (ou inválido) e NÃO deve ser acessado pelo servidor? */
export function isBlockedAddress(ip: string): boolean {
  if (net.isIPv4(ip)) return blockV4.check(ip, 'ipv4');
  if (!net.isIPv6(ip.split('%')[0])) return true; // não é IP válido: recusa por segurança
  const hextets = ipv6ToHextets(ip);
  if (!hextets) return true;
  const embedded = embeddedIPv4(hextets);
  if (embedded) return blockV4.check(embedded, 'ipv4');
  const canonical = hextets.map((x) => x.toString(16)).join(':');
  return blockV6.check(canonical, 'ipv6');
}

/* ---------------- resolução e conexão ---------------- */

export type LookupAll = (host: string) => Promise<Array<{ address: string; family: number }>>;
const defaultLookup: LookupAll = (host) => dns.lookup(host, { all: true, verbatim: true });

const bare = (hostname: string) => hostname.replace(/^\[|\]$/g, '');

/** Resolve `host` exigindo que TODOS os endereços sejam públicos; devolve o que será fixado na conexão. */
export async function resolvePublicAddress(host: string, lookup: LookupAll = defaultLookup): Promise<{ address: string; family: 4 | 6 }> {
  const name = bare(host);
  const addresses = net.isIP(name) ? [{ address: name, family: net.isIP(name) }] : await lookup(name).catch(() => []);
  if (addresses.length === 0) throw new AppError(400, 'Não foi possível resolver o endereço deste link');
  if (addresses.some((a) => isBlockedAddress(a.address))) throw new AppError(400, PRIVATE_MESSAGE);
  const chosen = addresses[0];
  return { address: chosen.address, family: chosen.family === 6 ? 6 : 4 };
}

/** `lookup` que SEMPRE devolve o IP já validado, ignorando qualquer nova resolução DNS. */
export function pinnedLookup(address: string, family: 4 | 6) {
  return (_host: string, options: { all?: boolean }, cb: (...args: unknown[]) => void) => {
    if (options?.all) cb(null, [{ address, family }]);
    else cb(null, address, family);
  };
}

export interface SafeResponse {
  url: URL;
  status: number;
  headers: http.IncomingHttpHeaders;
  body: ReadableStream<Uint8Array>;
}

interface SafeFetchOptions {
  maxRedirects?: number;
  timeoutMs?: number;
  lookup?: LookupAll;
}

function requestPinned(url: URL, pin: { address: string; family: 4 | 6 }, timeoutMs: number): Promise<http.IncomingMessage> {
  return new Promise((resolve, reject) => {
    const lib = url.protocol === 'https:' ? https : http;
    const host = bare(url.hostname);
    const req = lib.request(
      {
        hostname: host,
        port: url.port || undefined,
        path: `${url.pathname}${url.search}`,
        method: 'GET',
        headers: { 'user-agent': 'coldclick-importer/1.0', accept: '*/*' },
        lookup: pinnedLookup(pin.address, pin.family) as unknown as net.LookupFunction,
        // SNI/validação do certificado pelo NOME, mesmo conectando no IP fixado (não se aplica a IP literal).
        ...(url.protocol === 'https:' && !net.isIP(host) ? { servername: host } : {}),
        signal: AbortSignal.timeout(timeoutMs),
      },
      resolve,
    );
    req.on('error', reject);
    req.end();
  });
}

/** GET seguro: valida, fixa o IP, segue redirecionamentos revalidando cada salto. */
export async function safeFetch(rawUrl: string, opts: SafeFetchOptions = {}): Promise<SafeResponse> {
  const { maxRedirects = 5, timeoutMs = 10 * 60_000, lookup } = opts;
  let url: URL;
  try {
    url = new URL(rawUrl);
  } catch {
    throw new AppError(400, 'URL inválida');
  }

  for (let hop = 0; hop <= maxRedirects; hop++) {
    if (url.protocol !== 'http:' && url.protocol !== 'https:') throw new AppError(400, 'Use um link http:// ou https://');
    if (url.username || url.password) throw new AppError(400, 'O link não pode conter usuário e senha');
    const pin = await resolvePublicAddress(url.hostname, lookup);

    let res: http.IncomingMessage;
    try {
      res = await requestPinned(url, pin, timeoutMs);
    } catch {
      throw new AppError(502, 'Não foi possível baixar o arquivo deste link');
    }

    const location = res.headers.location;
    if (res.statusCode && res.statusCode >= 300 && res.statusCode < 400 && location) {
      res.resume(); // descarta o corpo do redirecionamento (libera o socket)
      try {
        url = new URL(location, url);
      } catch {
        throw new AppError(400, 'Redirecionamento inválido');
      }
      continue;
    }
    return { url, status: res.statusCode ?? 0, headers: res.headers, body: Readable.toWeb(res) as unknown as ReadableStream<Uint8Array> };
  }
  throw new AppError(400, 'Redirecionamentos demais neste link');
}
