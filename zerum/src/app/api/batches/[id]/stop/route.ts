import { api, json } from '@/lib/http';
import { stopBatch } from '@/lib/services/production-service';

export const dynamic = 'force-dynamic';

/** "Parar depois dos atuais". */
export const POST = api<{ id: string }>(async (_req, { params }) => json(stopBatch((await params).id)));
