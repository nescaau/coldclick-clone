/** Helpers das rotas de API: resposta JSON, tradução de erros e validação de entrada com zod. */
import { NextResponse, type NextRequest } from 'next/server';
import { ZodError, type ZodTypeAny, type z } from 'zod';
import { AppError } from './errors';
import { MAX_VIRAL_BYTES, MAX_VIRAL_MB } from './limits';
import { MAX_PHOTO_BYTES, MAX_PHOTO_MB } from './domain/avatar';
import { ensureBootstrapped } from './services/bootstrap';

export const json = <T>(data: T, status = 200) => NextResponse.json(data, { status });

export function errorResponse(e: unknown): NextResponse {
  if (e instanceof AppError) return NextResponse.json({ error: e.message }, { status: e.status });
  if (e instanceof ZodError) {
    const msg = e.issues.map((i) => (i.path.length ? `${i.path.join('.')}: ${i.message}` : i.message)).join('; ');
    return NextResponse.json({ error: msg }, { status: 400 });
  }
  console.error('[api]', e);
  return NextResponse.json({ error: 'Erro interno. Tente novamente.' }, { status: 500 });
}

type Ctx<P> = { params: Promise<P> };

/** Envolve um handler: garante a inicialização (banco/migrações) e converte erros em `{ error }` com o status certo. */
export function api<P = Record<string, string>>(fn: (req: NextRequest, ctx: Ctx<P>) => Promise<Response>) {
  return async (req: NextRequest, ctx: Ctx<P>): Promise<Response> => {
    try {
      ensureBootstrapped();
      return await fn(req, ctx);
    } catch (e) {
      return errorResponse(e);
    }
  };
}

export async function parseBody<S extends ZodTypeAny>(req: NextRequest, schema: S): Promise<z.infer<S>> {
  // Exigir application/json impede o CSRF "simples" (formulário/fetch com text/plain não dispara preflight).
  const type = (req.headers.get('content-type') ?? '').split(';')[0].trim().toLowerCase();
  if (type !== 'application/json') throw new AppError(415, 'Envie o corpo como application/json');
  let raw: unknown;
  try {
    raw = await req.json();
  } catch {
    throw new AppError(400, 'Corpo da requisição inválido (JSON esperado)');
  }
  return schema.parse(raw);
}

/** Lê o MP4 de um multipart (campo `file`). A validação de conteúdo é do viral-service. */
export async function readViralUpload(req: NextRequest): Promise<{ name: string; bytes: Uint8Array }> {
  const type = (req.headers.get('content-type') ?? '').split(';')[0].trim().toLowerCase();
  if (type !== 'multipart/form-data') throw new AppError(415, 'Envie o vídeo como multipart/form-data');
  const declared = Number(req.headers.get('content-length') ?? 0);
  // Folga de 1 MB para o envelope multipart; o limite real é conferido de novo sobre o arquivo.
  if (declared > MAX_VIRAL_BYTES + 1024 * 1024) throw new AppError(413, `O vídeo passa de ${MAX_VIRAL_MB} MB.`);
  let form: FormData;
  try {
    form = await req.formData();
  } catch {
    throw new AppError(400, 'Upload inválido.');
  }
  const file = form.get('file');
  if (!(file instanceof File)) throw new AppError(400, 'Escolha um arquivo de vídeo.');
  if (file.size > MAX_VIRAL_BYTES) throw new AppError(413, `O vídeo passa de ${MAX_VIRAL_MB} MB.`);
  return { name: file.name, bytes: new Uint8Array(await file.arrayBuffer()) };
}

/** Lê a foto de um multipart (campo `file`). A validação de conteúdo é do avatar-service. */
export async function readPhotoUpload(req: NextRequest): Promise<{ name: string; bytes: Uint8Array }> {
  const type = (req.headers.get('content-type') ?? '').split(';')[0].trim().toLowerCase();
  if (type !== 'multipart/form-data') throw new AppError(415, 'Envie a foto como multipart/form-data');
  const declared = Number(req.headers.get('content-length') ?? 0);
  if (declared > MAX_PHOTO_BYTES + 1024 * 1024) throw new AppError(413, `Foto grande demais. O limite é ${MAX_PHOTO_MB} MB.`);
  let form: FormData;
  try {
    form = await req.formData();
  } catch {
    throw new AppError(400, 'Upload inválido.');
  }
  const file = form.get('file');
  if (!(file instanceof File)) throw new AppError(400, 'Escolha uma foto.');
  if (file.size > MAX_PHOTO_BYTES) throw new AppError(413, `Foto grande demais (${(file.size / 1024 / 1024).toFixed(0)} MB). O limite é ${MAX_PHOTO_MB} MB.`);
  return { name: file.name, bytes: new Uint8Array(await file.arrayBuffer()) };
}
