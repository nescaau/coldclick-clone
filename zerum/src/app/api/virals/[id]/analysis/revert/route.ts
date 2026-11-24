import { api, json } from '@/lib/http';
import { revertAnalysis } from '@/lib/services/viral-service';

export const dynamic = 'force-dynamic';

/** "voltar à original". */
export const POST = api<{ id: string }>(async (_req, { params }) => json(revertAnalysis((await params).id)));
