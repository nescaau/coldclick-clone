/** Respostas de arquivo para as rotas: Range (o <video> precisa), Content-Disposition seguro e zip em streaming. */
import fs from 'node:fs';
import { Readable } from 'node:stream';
import { zipChunks, type ZipEntry } from './domain/zip';

/** Nome de arquivo seguro para o cabeçalho (ASCII no `filename`, UTF-8 completo em `filename*`). */
export function contentDisposition(kind: 'attachment' | 'inline', name: string): string {
  // eslint-disable-next-line no-control-regex
  const clean = name.replace(/[\u0000-\u001f\u007f"\\/]/g, '_');
  const ascii = clean.replace(/[^\x20-\x7e]/g, '_');
  return `${kind}; filename="${ascii}"; filename*=UTF-8''${encodeURIComponent(clean)}`;
}

export interface ByteRange {
  start: number;
  end: number;
}

/** "bytes=0-99" / "bytes=100-" / "bytes=-50". null = sem Range; 'invalid' = 416. */
export function parseRange(header: string | null, size: number): ByteRange | null | 'invalid' {
  if (!header) return null;
  const m = /^bytes=(\d*)-(\d*)$/.exec(header.trim());
  if (!m || (m[1] === '' && m[2] === '')) return 'invalid';
  let start: number;
  let end: number;
  if (m[1] === '') {
    const suffix = Number(m[2]);
    if (suffix === 0) return 'invalid';
    start = Math.max(0, size - suffix);
    end = size - 1;
  } else {
    start = Number(m[1]);
    end = m[2] === '' ? size - 1 : Math.min(Number(m[2]), size - 1);
  }
  if (!Number.isFinite(start) || start >= size || start > end) return 'invalid';
  return { start, end };
}

const toWeb = (r: Readable) => Readable.toWeb(r) as unknown as ReadableStream<Uint8Array>;

export function fileResponse(opts: { path: string; size: number; mime: string; name: string; download: boolean; range: string | null }): Response {
  const headers: Record<string, string> = {
    'Content-Type': opts.mime,
    'Accept-Ranges': 'bytes',
    'Content-Disposition': contentDisposition(opts.download ? 'attachment' : 'inline', opts.name),
    'Cache-Control': 'private, no-store',
    'X-Content-Type-Options': 'nosniff',
  };
  const r = parseRange(opts.range, opts.size);
  if (r === 'invalid') return new Response(null, { status: 416, headers: { ...headers, 'Content-Range': `bytes */${opts.size}` } });
  if (r === null) {
    return new Response(toWeb(fs.createReadStream(opts.path)), { status: 200, headers: { ...headers, 'Content-Length': String(opts.size) } });
  }
  return new Response(toWeb(fs.createReadStream(opts.path, { start: r.start, end: r.end })), {
    status: 206,
    headers: { ...headers, 'Content-Range': `bytes ${r.start}-${r.end}/${opts.size}`, 'Content-Length': String(r.end - r.start + 1) },
  });
}

export function bytesResponse(opts: { bytes: Uint8Array; mime: string; name: string; download: boolean; range: string | null }): Response {
  const size = opts.bytes.length;
  const headers: Record<string, string> = {
    'Content-Type': opts.mime,
    'Accept-Ranges': 'bytes',
    'Content-Disposition': contentDisposition(opts.download ? 'attachment' : 'inline', opts.name),
    'Cache-Control': 'private, no-store',
    'X-Content-Type-Options': 'nosniff',
  };
  const r = parseRange(opts.range, size);
  if (r === 'invalid') return new Response(null, { status: 416, headers: { ...headers, 'Content-Range': `bytes */${size}` } });
  if (r === null) return new Response(opts.bytes as BodyInit, { status: 200, headers: { ...headers, 'Content-Length': String(size) } });
  return new Response(opts.bytes.slice(r.start, r.end + 1) as BodyInit, {
    status: 206,
    headers: { ...headers, 'Content-Range': `bytes ${r.start}-${r.end}/${size}`, 'Content-Length': String(r.end - r.start + 1) },
  });
}

export function zipResponse(name: string, entries: ZipEntry[]): Response {
  const stream = toWeb(Readable.from(zipChunks(entries), { objectMode: false }));
  return new Response(stream, {
    status: 200,
    headers: {
      'Content-Type': 'application/zip',
      'Content-Disposition': contentDisposition('attachment', name),
      'Cache-Control': 'private, no-store',
      'X-Content-Type-Options': 'nosniff',
    },
  });
}
