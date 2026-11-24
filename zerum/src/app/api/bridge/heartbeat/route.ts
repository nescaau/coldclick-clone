import { api, json, parseBody } from '@/lib/http';
import { BridgeHeartbeatSchema } from '@/lib/schemas';
import { reportHeartbeat } from '@/lib/services/bridge-service';

export const dynamic = 'force-dynamic';

/**
 * A página informa o que viu na extensão (a cada ~5 s). Devolve se esta aba é a líder (a única que executa) e o modo de
 * execução. Só estado sanitizado: nada de token, journal ou mídia.
 */
export const POST = api(async (req) => json(reportHeartbeat(await parseBody(req, BridgeHeartbeatSchema))));
