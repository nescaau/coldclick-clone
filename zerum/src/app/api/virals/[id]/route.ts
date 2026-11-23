import { api, json } from '@/lib/http';
import { removeViral, viralEvents } from '@/lib/services/viral-service';

export const dynamic = 'force-dynamic';

type P = { id: string };

/** Log local do viral ("preparando"…). */
export const GET = api<P>(async (_req, { params }) => json(viralEvents((await params).id)));

export const DELETE = api<P>(async (_req, { params }) => {
  removeViral((await params).id);
  return json({ ok: true });
});
