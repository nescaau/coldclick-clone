import { api, json, parseBody } from '@/lib/http';
import { badRequest } from '@/lib/errors';
import { SceneFailSchema } from '@/lib/schemas';
import { failScene } from '@/lib/services/real-service';

export const dynamic = 'force-dynamic';

/** A cena falhou no Flow (cota, conteúdo recusado…): o vídeo falha com a causa — ou, com a troca automática, volta à fila. */
export const POST = api<{ videoId: string; idx: string }>(async (req, { params }) => {
  const { videoId, idx } = await params;
  const n = Number(idx);
  if (!Number.isInteger(n) || n < 0 || n > 64) throw badRequest('Cena inválida.');
  const body = await parseBody(req, SceneFailSchema);
  return json(failScene({ videoId, idx: n, ...body }));
});
