import { api, json } from '@/lib/http';
import { getVideo, removeVideo } from '@/lib/services/video-service';

type P = { id: string };

export const GET = api<P>(async (_req, { params }) => json(getVideo((await params).id)));

export const DELETE = api<P>(async (_req, { params }) => {
  removeVideo((await params).id);
  return json({ ok: true });
});
