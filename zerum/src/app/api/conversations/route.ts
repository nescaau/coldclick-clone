import { api, json, parseBody } from '@/lib/http';
import { ConversationCreateSchema } from '@/lib/schemas';
import { createConversation, listAll } from '@/lib/services/conversation-service';

export const dynamic = 'force-dynamic';

export const GET = api(async () => json(listAll()));

export const POST = api(async (req) => json(createConversation(await parseBody(req, ConversationCreateSchema)), 201));
