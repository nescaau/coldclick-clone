import { z } from 'zod';
import { api, json, parseBody } from '@/lib/http';
import { createConversation, listAll } from '@/lib/services/conversation-service';

export const dynamic = 'force-dynamic';

export const GET = api(async () => json(listAll()));

const CreateSchema = z.object({ mode: z.enum(['viral', 'ideia']).optional() });

export const POST = api(async (req) => json(createConversation(await parseBody(req, CreateSchema)), 201));
