import { api, json, parseBody } from '@/lib/http';
import { AvatarSchema } from '@/lib/schemas';
import { editAvatar, removeAvatar } from '@/lib/services/avatar-service';

export const dynamic = 'force-dynamic';

type P = { id: string };

export const PUT = api<P>(async (req, { params }) => json(editAvatar((await params).id, await parseBody(req, AvatarSchema))));

export const DELETE = api<P>(async (_req, { params }) => {
  removeAvatar((await params).id);
  return json({ ok: true });
});
