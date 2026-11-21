import { api, json, parseBody } from '@/lib/http';
import { pairSchema } from '@/lib/schemas';
import { ROTATION_RULES } from '@/lib/rotation';
import { completePairing } from '@/lib/services/extension-service';

/**
 * Chamado pela EXTENSÃO (não pelo navegador do estúdio): troca o código de pareamento
 * exibido na página Contas Flow por um token de acesso.
 */
export const POST = api(async (req) => {
  const { code, version } = await parseBody(req, pairSchema);
  const { token } = completePairing({ code, version });
  return json({ token, rules: ROTATION_RULES });
});
