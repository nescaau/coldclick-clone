import { AppError } from '@/lib/errors';
import { api, json } from '@/lib/http';
import { ROTATION_RULES } from '@/lib/rotation';
import { heartbeatSchema } from '@/lib/schemas';
import { authenticateBrowser, registerHeartbeat } from '@/lib/services/extension-service';

/**
 * Sinal de vida da extensão (a cada ~30 s), autenticado por `Authorization: Bearer <token>`.
 * Corpo opcional: { version, flowSessionActive, flowAccountEmail }.
 * Fase 2: a resposta passará a carregar as tarefas de geração pendentes para a extensão executar.
 */
export const POST = api(async (req) => {
  const browser = authenticateBrowser(req.headers.get('authorization'));
  if (!browser) throw new AppError(401, 'Token inválido ou pareamento revogado');

  const text = await req.text();
  let raw: unknown = {};
  if (text) {
    try {
      raw = JSON.parse(text);
    } catch {
      throw new AppError(400, 'Corpo da requisição inválido (JSON esperado)');
    }
  }
  registerHeartbeat(browser, heartbeatSchema.parse(raw));
  return json({ ok: true, serverTime: new Date().toISOString(), rules: ROTATION_RULES, tasks: [] });
});
