import { api, json, parseBody } from '@/lib/http';
import { BridgeClaimSchema } from '@/lib/schemas';
import { claimWork } from '@/lib/services/real-service';

export const dynamic = 'force-dynamic';

/** A aba líder pede a próxima cena para executar pela extensão (uma por vez; o servidor decide e reserva). */
export const POST = api(async (req) => json(claimWork(await parseBody(req, BridgeClaimSchema))));
