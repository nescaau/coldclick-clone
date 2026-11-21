import { createReadStream, statSync } from 'node:fs';
import path from 'node:path';
import { Readable } from 'node:stream';
import type { NextRequest } from 'next/server';
import { SERVABLE_TYPES } from '@/lib/config';
import { resolveStoragePath } from '@/lib/storage';

/**
 * Serve arquivos da pasta de armazenamento (vídeos, fotos de avatar, gerações).
 * Suporta `Range` — necessário para o <video> permitir seek e para o Safari/Mac tocar MP4.
 */
export async function GET(req: NextRequest, { params }: { params: Promise<{ path: string[] }> }) {
  const { path: segments } = await params;

  let abs: string;
  let size: number;
  try {
    abs = resolveStoragePath(segments.join('/'));
    const st = statSync(abs);
    if (!st.isFile()) throw new Error('not a file');
    size = st.size;
  } catch {
    return new Response('Arquivo não encontrado', { status: 404 });
  }

  const contentType = SERVABLE_TYPES[path.extname(abs).toLowerCase()];
  if (!contentType) return new Response('Tipo de arquivo não suportado', { status: 415 });

  const headers: Record<string, string> = {
    'Content-Type': contentType,
    'Accept-Ranges': 'bytes',
    'Cache-Control': 'private, max-age=3600',
    // Defesa em profundidade: arquivos nunca executam script, mesmo se abertos direto no navegador.
    'Content-Security-Policy': "sandbox; default-src 'none'; style-src 'unsafe-inline'; img-src data:; media-src 'self'",
    'X-Content-Type-Options': 'nosniff',
  };

  let start = 0;
  let end = size - 1;
  let status = 200;

  const range = req.headers.get('range')?.match(/^bytes=(\d*)-(\d*)$/);
  if (range && (range[1] || range[2])) {
    if (range[1]) {
      start = Number(range[1]);
      if (range[2]) end = Math.min(Number(range[2]), size - 1);
    } else {
      // "bytes=-500" = últimos 500 bytes
      start = Math.max(size - Number(range[2]), 0);
    }
    if (start > end || start >= size) {
      return new Response(null, { status: 416, headers: { 'Content-Range': `bytes */${size}` } });
    }
    status = 206;
    headers['Content-Range'] = `bytes ${start}-${end}/${size}`;
  }

  headers['Content-Length'] = String(size === 0 ? 0 : end - start + 1);
  const body = size === 0 ? null : (Readable.toWeb(createReadStream(abs, { start, end })) as ReadableStream);
  return new Response(body, { status, headers });
}
