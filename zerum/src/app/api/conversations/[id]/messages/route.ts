import { api, json, parseBody } from '@/lib/http';
import { SendMessageSchema } from '@/lib/schemas';
import { sendMessage } from '@/lib/services/conversation-service';

export const dynamic = 'force-dynamic';

export const POST = api<{ id: string }>(async (req, { params }) =>
  json(sendMessage((await params).id, await parseBody(req, SendMessageSchema)), 201),
);
