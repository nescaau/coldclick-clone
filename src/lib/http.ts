/** Helpers das rotas de API: resposta JSON, tradução de erros e validação de entrada com zod. */
import { NextResponse, type NextRequest } from 'next/server';
import { ZodError, type ZodTypeAny, type z } from 'zod';
import { AppError } from './errors';
import { ensureBootstrapped } from './services/bootstrap';

/** Alias mantido para as rotas que ainda lançam erros HTTP diretamente. */
export { AppError as HttpError };

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

/**
 * Envolve um handler: garante a inicialização do app (seed, migração de segredos) e converte
 * qualquer erro lançado em resposta JSON `{ error }` com o status correto.
 */
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
