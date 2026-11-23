import { api, json } from '@/lib/http';
import { batchEvents, removeBatch } from '@/lib/services/batch-service';

export const dynamic = 'force-dynamic';

type P = { id: string };

/** Log local do lote. */
export const GET = api<P>(async (_req, { params }) => json(batchEvents((await params).id)));

export const DELETE = api<P>(async (_req, { params }) => {
  removeBatch((await params).id);
  return json({ ok: true });
});
