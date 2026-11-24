import { api, json } from '@/lib/http';
import { approveBatch } from '@/lib/services/production-service';

export const dynamic = 'force-dynamic';

/** "✓ Aprovar lote → Vídeos". */
export const POST = api<{ id: string }>(async (_req, { params }) => json(approveBatch((await params).id)));
