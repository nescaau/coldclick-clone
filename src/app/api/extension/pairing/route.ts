import { api, json, parseBody } from '@/lib/http';
import { createPairingSchema } from '@/lib/schemas';
import { createPairingCode, getExtensionOverview } from '@/lib/services/extension-service';

/** Cria um código de pareamento de uso único (10 min) para um navegador com o nome informado. */
export const POST = api(async (req) => {
  createPairingCode((await parseBody(req, createPairingSchema)).browserName);
  return json(getExtensionOverview(), 201);
});
