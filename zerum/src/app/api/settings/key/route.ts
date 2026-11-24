import { api, json, parseBody } from '@/lib/http';
import { ApiKeySchema } from '@/lib/schemas';
import { removeApiKey, saveApiKey } from '@/lib/services/settings-service';

export const dynamic = 'force-dynamic';

/** Chave própria (modo antigo do Diretor): guardada só neste banco; a resposta traz só "••••1234". */
export const PUT = api(async (req) => json(saveApiKey((await parseBody(req, ApiKeySchema)).key)));

export const DELETE = api(async () => json(removeApiKey()));
