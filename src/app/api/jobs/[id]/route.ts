import { api, json } from '@/lib/http';
import { getJob, removeJob } from '@/lib/services/job-service';

type P = { id: string };

export const GET = api<P>(async (_req, { params }) => json(getJob((await params).id)));

export const DELETE = api<P>(async (_req, { params }) => {
  removeJob((await params).id);
  return json({ ok: true });
});
