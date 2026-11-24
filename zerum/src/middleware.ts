/**
 * Defesa de um servidor LOCAL contra páginas web maliciosas abertas no mesmo computador
 * (mesmo padrão do Estúdio Criativo):
 *
 *  - Host allowlist (DNS rebinding): só responde quando o cabeçalho Host é localhost/127.0.0.1/[::1]
 *    (ou um host de ZERUM_ALLOWED_HOSTS). Vale para páginas, RSC e API.
 *  - CSRF (só /api): requisições que ALTERAM dados (POST/PUT/PATCH/DELETE) precisam ser da própria origem —
 *    `Sec-Fetch-Site` same-origin/none e, quando há `Origin`, igual ao Host.
 *
 * NOTA: aqui NÃO existe sessão/login — a proteção é só "este computador". O original exigia sessão da 001.community.
 * Complemento: rode com `-H 127.0.0.1` (scripts dev/start) para nem aceitar conexões de outras máquinas.
 */
import { NextResponse, type NextRequest } from 'next/server';

const SAFE_METHODS = new Set(['GET', 'HEAD', 'OPTIONS']);

function allowedHosts(): Set<string> {
  const extra = (process.env.ZERUM_ALLOWED_HOSTS ?? '')
    .split(',')
    .map((h) => h.trim().toLowerCase())
    .filter(Boolean);
  return new Set(['localhost', '127.0.0.1', '[::1]', '::1', ...extra]);
}

/** "localhost:3100" → "localhost"; "[::1]:3100" → "[::1]". */
function hostnameOf(hostHeader: string): string {
  const h = hostHeader.trim().toLowerCase();
  return h.startsWith('[') ? h.slice(0, h.indexOf(']') + 1) : h.split(':')[0];
}

const deny = (message: string) => NextResponse.json({ error: message }, { status: 403 });

export function middleware(req: NextRequest) {
  const host = req.headers.get('host') ?? '';
  if (!allowedHosts().has(hostnameOf(host))) return deny('Host não permitido');

  // Fora de /api (páginas e RSC) só vale a checagem de Host: ela impede que DNS rebinding leia HTML/RSC.
  // (req.nextUrl.pathname já vem sem o basePath /zerum.)
  const isApi = req.nextUrl.pathname === '/api' || req.nextUrl.pathname.startsWith('/api/');
  if (!isApi || SAFE_METHODS.has(req.method)) return NextResponse.next();

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

/**
 * Todas as rotas (páginas, RSC e API), exceto os estáticos do Next. Com basePath `/zerum`, o Next prefixa cada matcher:
 * `/` vira `/zerum` (a página) e o padrão com grupo cobre `/zerum/<qualquer coisa>` — sem o `/` a raiz do app escaparia.
 */
export const config = { matcher: ['/', '/((?!_next/static|_next/image).*)'] };
