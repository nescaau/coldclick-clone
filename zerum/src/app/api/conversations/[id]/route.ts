import { api, json, parseBody } from '@/lib/http';
import { ConversationPatchSchema } from '@/lib/schemas';
import { getDetail, patchConversation, removeConversation } from '@/lib/services/conversation-service';

export const dynamic = 'force-dynamic';

type P = { id: string };

export const GET = api<P>(async (_req, { params }) => json(getDetail((await params).id)));

export const PATCH = api<P>(async (req, { params }) =>
  json(patchConversation((await params).id, await parseBody(req, ConversationPatchSchema))),
);

export const DELETE = api<P>(async (_req, { params }) => {
  removeConversation((await params).id);
  return json({ ok: true });
});
