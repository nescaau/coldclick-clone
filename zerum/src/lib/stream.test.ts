import { describe, expect, it } from 'vitest';
import { bytesResponse, contentDisposition, parseRange } from './stream';

describe('parseRange', () => {
  it.each([
    ['bytes=0-99', 1000, { start: 0, end: 99 }],
    ['bytes=100-', 1000, { start: 100, end: 999 }],
    ['bytes=-50', 1000, { start: 950, end: 999 }],
    ['bytes=900-5000', 1000, { start: 900, end: 999 }],
  ])('%s → intervalo', (h, size, esperado) => expect(parseRange(h, size)).toEqual(esperado));

  it('sem cabeçalho = resposta inteira; fora do arquivo/malformado = inválido (416)', () => {
    expect(parseRange(null, 10)).toBeNull();
    expect(parseRange('bytes=10-', 10)).toBe('invalid');
    expect(parseRange('bytes=5-2', 10)).toBe('invalid');
    expect(parseRange('bytes=-', 10)).toBe('invalid');
    expect(parseRange('bytes=-0', 10)).toBe('invalid');
    expect(parseRange('items=0-1', 10)).toBe('invalid');
  });
});

describe('respostas de arquivo', () => {
  it('Content-Disposition escapa aspas, quebras e não-ASCII (sem injeção de cabeçalho)', () => {
    const h = contentDisposition('attachment', 'a"b\r\nSet-Cookie: x.mp4');
    expect(h).not.toMatch(/[\r\n]/);
    expect(h).toContain('attachment; filename="a_b__Set-Cookie: x.mp4"');
    expect(contentDisposition('inline', 'Ação.mp4')).toContain("filename*=UTF-8''A%C3%A7%C3%A3o.mp4");
  });

  it('Range devolve 206 com o pedaço certo; inválido devolve 416', async () => {
    const bytes = Uint8Array.from([0, 1, 2, 3, 4, 5, 6, 7, 8, 9]);
    const r = bytesResponse({ bytes, mime: 'video/mp4', name: 'a.mp4', download: false, range: 'bytes=2-4' });
    expect(r.status).toBe(206);
    expect(r.headers.get('Content-Range')).toBe('bytes 2-4/10');
    expect(Array.from(new Uint8Array(await r.arrayBuffer()))).toEqual([2, 3, 4]);
    expect(bytesResponse({ bytes, mime: 'video/mp4', name: 'a.mp4', download: true, range: 'bytes=99-' }).status).toBe(416);
    const full = bytesResponse({ bytes, mime: 'video/mp4', name: 'a.mp4', download: true, range: null });
    expect(full.status).toBe(200);
    expect(full.headers.get('Content-Disposition')).toMatch(/^attachment/);
  });
});
