import { NextRequest } from 'next/server';
import { describe, expect, it } from 'vitest';
import { z } from 'zod';
import { parseBody } from './http';
import { middleware } from '../middleware';

const req = (url: string, init: ConstructorParameters<typeof NextRequest>[1] = {}) => new NextRequest(url, init);
const status = (res: Response) => res.status;
/** `NextResponse.next()` marca a passagem com este cabeçalho. */
const passes = (res: Response) => res.headers.get('x-middleware-next') === '1';

describe('middleware — Host (DNS rebinding)', () => {
  it.each(['localhost:3000', '127.0.0.1:3000', '[::1]:3000', 'localhost'])('aceita %s', (host) => {
    expect(passes(middleware(req('http://localhost:3000/api/jobs', { headers: { host } })))).toBe(true);
  });

  it('recusa Host de outro domínio (o domínio do atacante resolvendo para 127.0.0.1)', () => {
    const res = middleware(req('http://localhost:3000/api/jobs', { headers: { host: 'evil.example.com:3000' } }));
    expect(status(res)).toBe(403);
  });

  it('permite hosts extras configurados', () => {
    process.env.COLDCLICK_ALLOWED_HOSTS = 'meu-mac.local, outro.lan';
    try {
      expect(passes(middleware(req('http://x/api/jobs', { headers: { host: 'meu-mac.local:3000' } })))).toBe(true);
    } finally {
      delete process.env.COLDCLICK_ALLOWED_HOSTS;
    }
  });
});

describe('middleware — CSRF', () => {
  const post = (headers: Record<string, string>, path = '/api/jobs') =>
    middleware(req(`http://localhost:3000${path}`, { method: 'POST', headers: { host: 'localhost:3000', ...headers } }));

  it('bloqueia POST de outro site (Sec-Fetch-Site: cross-site), mesmo com text/plain', () => {
    expect(status(post({ 'sec-fetch-site': 'cross-site', 'content-type': 'text/plain' }))).toBe(403);
    expect(status(post({ 'sec-fetch-site': 'same-site' }))).toBe(403);
  });

  it('bloqueia POST cuja Origin não é o próprio Host', () => {
    expect(status(post({ origin: 'https://evil.example.com' }))).toBe(403);
    expect(status(post({ origin: 'não é url' }))).toBe(403);
  });

  it('aceita POST da própria origem e requisições sem cabeçalhos de navegador (curl)', () => {
    expect(passes(post({ 'sec-fetch-site': 'same-origin', origin: 'http://localhost:3000' }))).toBe(true);
    expect(passes(post({}))).toBe(true);
  });

  it('GET não é afetado por Origin/Sec-Fetch-Site', () => {
    const res = middleware(req('http://localhost:3000/api/jobs', { headers: { host: 'localhost:3000', 'sec-fetch-site': 'cross-site' } }));
    expect(passes(res)).toBe(true);
  });

  it('rotas da extensão (pareamento/heartbeat) passam sem Origin, mas o Host continua valendo', () => {
    expect(passes(post({ origin: 'chrome-extension://abcdef', 'sec-fetch-site': 'none' }, '/api/extension/heartbeat'))).toBe(true);
    expect(passes(post({ origin: 'chrome-extension://abcdef' }, '/api/extension/pair'))).toBe(true);
    const badHost = middleware(req('http://localhost:3000/api/extension/pair', { method: 'POST', headers: { host: 'evil.example.com' } }));
    expect(status(badHost)).toBe(403);
  });
});

describe('parseBody — exige application/json', () => {
  const schema = z.object({ a: z.number() });
  const post = (contentType: string | null, body = '{"a":1}') =>
    req('http://localhost:3000/api/x', { method: 'POST', body, headers: contentType ? { 'content-type': contentType } : {} });

  it('recusa text/plain (CSRF "simples"), formulários e ausência de Content-Type', async () => {
    await expect(parseBody(post('text/plain'), schema)).rejects.toMatchObject({ status: 415 });
    await expect(parseBody(post('application/x-www-form-urlencoded', 'a=1'), schema)).rejects.toMatchObject({ status: 415 });
    await expect(parseBody(post('multipart/form-data; boundary=x'), schema)).rejects.toMatchObject({ status: 415 });
  });

  it('aceita application/json (com charset) e valida o corpo', async () => {
    await expect(parseBody(post('application/json'), schema)).resolves.toEqual({ a: 1 });
    await expect(parseBody(post('application/json; charset=utf-8'), schema)).resolves.toEqual({ a: 1 });
    await expect(parseBody(post('application/json', 'não é json'), schema)).rejects.toMatchObject({ status: 400 });
  });
});
