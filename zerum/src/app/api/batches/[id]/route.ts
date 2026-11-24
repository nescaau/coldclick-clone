import { api, json } from '@/lib/http';
import { batchEvents, discardBatch } from '@/lib/services/production-service';

export const dynamic = 'force-dynamic';

type P = { id: string };

/** Log local do lote (eventos persistidos). */
export const GET = api<P>(async (_req, { params }) => json(batchEvents((await params).id)));

/** "✕ Descartar lote" (o 2º clique de confirmação é da interface). */
export const DELETE = api<P>(async (_req, { params }) => {
  discardBatch((await params).id);
  return json({ ok: true });
});
