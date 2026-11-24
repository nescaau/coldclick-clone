import { api, json } from '@/lib/http';
import { getViralDTO, removeViral, viralEvents } from '@/lib/services/viral-service';

export const dynamic = 'force-dynamic';

type P = { id: string };

/** O viral + o log local dele. */
export const GET = api<P>(async (_req, { params }) => {
  const { id } = await params;
  return json({ viral: getViralDTO(id), events: viralEvents(id) });
});

export const DELETE = api<P>(async (_req, { params }) => {
  removeViral((await params).id);
  return json({ ok: true });
});
