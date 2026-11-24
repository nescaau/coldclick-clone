import { api, json } from '@/lib/http';
import { confirmPlan } from '@/lib/services/director-service';

export const dynamic = 'force-dynamic';

/** "Executar N passos": o plano confirmado vira lote em PRODUÇÃO. */
export const POST = api<{ id: string }>(async (_req, { params }) => json(confirmPlan((await params).id), 201));
