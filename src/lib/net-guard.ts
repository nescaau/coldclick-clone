/**
 * Proteção contra SSRF na importação de vídeo por URL: só aceita http(s) e
 * recusa endereços de rede interna (loopback, privados, link-local).
 *
 * Limitação conhecida: a checagem resolve o DNS antes do fetch; um atacante com
 * controle do DNS ainda poderia tentar "DNS rebinding". Em produção, o ideal é
 * fixar o IP resolvido na conexão (agent com `lookup` customizado) ou usar um proxy de egress.
 */
import dns from 'node:dns/promises';
import net from 'node:net';

function isPrivateIPv4(ip: string): boolean {
  const [a, b] = ip.split('.').map(Number);
  return (
    a === 0 ||
    a === 10 ||
    a === 127 ||
    (a === 100 && b >= 64 && b <= 127) || // CGNAT
    (a === 169 && b === 254) || // link-local / metadata de nuvem
    (a === 172 && b >= 16 && b <= 31) ||
    (a === 192 && b === 168) ||
    a >= 224 // multicast/reservado
  );
}

function isPrivateIp(ip: string): boolean {
  if (net.isIPv4(ip)) return isPrivateIPv4(ip);
  const v6 = ip.toLowerCase();
  if (v6 === '::1' || v6 === '::') return true;
  if (v6.startsWith('fe80') || v6.startsWith('fc') || v6.startsWith('fd')) return true;
  const mapped = v6.match(/^::ffff:(\d+\.\d+\.\d+\.\d+)$/); // IPv4 embutido em IPv6
  return mapped ? isPrivateIPv4(mapped[1]) : false;
}

/** Lança Error (mensagem em PT-BR) se a URL não for segura para download pelo servidor. */
export async function assertPublicHttpUrl(raw: string): Promise<URL> {
  let url: URL;
  try {
    url = new URL(raw);
  } catch {
    throw new Error('URL inválida');
  }
  if (url.protocol !== 'http:' && url.protocol !== 'https:') throw new Error('Use um link http:// ou https://');

  const host = url.hostname.replace(/^\[|\]$/g, '');
  const addresses = net.isIP(host) ? [host] : (await dns.lookup(host, { all: true })).map((a) => a.address);
  if (addresses.length === 0 || addresses.some(isPrivateIp)) {
    throw new Error('Este endereço aponta para uma rede interna e não é permitido');
  }
  return url;
}
