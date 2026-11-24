import { api, json, parseBody } from '@/lib/http';
import { badRequest } from '@/lib/errors';
import { SceneProgressSchema } from '@/lib/schemas';
import { sceneProgress } from '@/lib/services/real-service';

export const dynamic = 'force-dynamic';

/** A ordem da cena existe na extensão: guarda o id e renova a reserva. `continue:false` = pare (cancelado/removido). */
export const POST = api<{ videoId: string; idx: string }>(async (req, { params }) => {
  const { videoId, idx } = await params;
  const n = Number(idx);
  if (!Number.isInteger(n) || n < 0 || n > 64) throw badRequest('Cena inválida.');
  const body = await parseBody(req, SceneProgressSchema);
  return json(sceneProgress({ videoId, idx: n, pumpId: body.pumpId, orderId: body.orderId }));
});
