/**
 * Defesa de um servidor LOCAL contra páginas web maliciosas abertas no mesmo computador:
 *
 *  - Host allowlist (DNS rebinding), em TODAS as rotas (páginas, RSC e API): o app só responde quando o
 *    cabeçalho Host é localhost/127.0.0.1/[::1]
 *    (ou um host listado em COLDCLICK_ALLOWED_HOSTS, separado por vírgula). Um site que faça o seu domínio
 *    resolver para 127.0.0.1 chega com outro Host e é recusado.
 *  - CSRF: requisições que ALTERAM dados (POST/PUT/PATCH/DELETE) precisam ser da própria origem —
 *    `Sec-Fetch-Site` same-origin/none e, quando há `Origin`, igual ao Host. Isso bloqueia formulários e
 *    fetches de outros sites mesmo sem preflight (ex.: `Content-Type: text/plain`).
 *  - Exceção: as rotas chamadas pela EXTENSÃO (pareamento e heartbeat) não vêm de uma página do app; elas se
 *    protegem por código de uso único / token Bearer, então só passam pela checagem de Host.
 *
 * Complemento: rode com `-H 127.0.0.1` (scripts dev/start) para nem aceitar conexões de outras máquinas.
 */
import { NextResponse, type NextRequest } from 'next/server';

const EXTENSION_PATHS = new Set(['/api/extension/pair', '/api/extension/heartbeat']);
const SAFE_METHODS = new Set(['GET', 'HEAD', 'OPTIONS']);

function allowedHosts(): Set<string> {
  const extra = (process.env.COLDCLICK_ALLOWED_HOSTS ?? '')
    .split(',')
    .map((h) => h.trim().toLowerCase())
    .filter(Boolean);
  return new Set(['localhost', '127.0.0.1', '[::1]', '::1', ...extra]);
}

/** "localhost:3000" → "localhost"; "[::1]:3000" → "[::1]". */
function hostnameOf(hostHeader: string): string {
  const h = hostHeader.trim().toLowerCase();
  return h.startsWith('[') ? h.slice(0, h.indexOf(']') + 1) : h.split(':')[0];
}

const deny = (message: string) => NextResponse.json({ error: message }, { status: 403 });

export function middleware(req: NextRequest) {
  const host = req.headers.get('host') ?? '';
  if (!allowedHosts().has(hostnameOf(host))) return deny('Host não permitido');

  // Fora de /api (páginas e RSC) só vale a checagem de Host: ela impede que DNS rebinding leia HTML/RSC com dados das contas.
  const isApi = req.nextUrl.pathname === '/api' || req.nextUrl.pathname.startsWith('/api/');
  if (!isApi || SAFE_METHODS.has(req.method) || EXTENSION_PATHS.has(req.nextUrl.pathname)) return NextResponse.next();

  const site = req.headers.get('sec-fetch-site');
  if (site && site !== 'same-origin' && site !== 'none') return deny('Requisição de outra origem bloqueada');

  const origin = req.headers.get('origin');
  if (origin) {
    let originHost: string;
    try {
      originHost = new URL(origin).host.toLowerCase();
    } catch {
      return deny('Origem inválida');
    }
    if (originHost !== host.toLowerCase()) return deny('Requisição de outra origem bloqueada');
  }
  return NextResponse.next();
}

/** Todas as rotas (páginas, RSC e API), exceto os estáticos do Next. */
export const config = { matcher: ['/((?!_next/static|_next/image).*)'] };
