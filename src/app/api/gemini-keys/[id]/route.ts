import { api, json, parseBody } from '@/lib/http';
import { moveSchema } from '@/lib/schemas';
import { listGeminiKeys, moveGeminiKey, removeGeminiKey } from '@/lib/services/gemini-key-service';

type P = { id: string };

/** Move a chave na ordem de tentativa. */
export const PATCH = api<P>(async (req, { params }) => {
  moveGeminiKey((await params).id, (await parseBody(req, moveSchema)).move);
  return json(listGeminiKeys());
});

export const DELETE = api<P>(async (_req, { params }) => {
  removeGeminiKey((await params).id);
  return json(listGeminiKeys());
});
