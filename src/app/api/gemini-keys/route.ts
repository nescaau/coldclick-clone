import { api, json, parseBody } from '@/lib/http';
import { addGeminiKeysSchema } from '@/lib/schemas';
import { addGeminiKeys, listGeminiKeys } from '@/lib/services/gemini-key-service';

export const GET = api(async () => json(listGeminiKeys()));

/** Cadastra várias chaves de uma vez (uma por linha). */
export const POST = api(async (req) => {
  const result = addGeminiKeys((await parseBody(req, addGeminiKeysSchema)).keys);
  return json({ ...result, keys: listGeminiKeys() }, 201);
});
