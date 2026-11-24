import { api, json } from '@/lib/http';
import { cancelBatch } from '@/lib/services/production-service';

export const dynamic = 'force-dynamic';

/** "✕ Cancelar agora" (o 2º clique de confirmação é da interface). */
export const POST = api<{ id: string }>(async (_req, { params }) => json(cancelBatch((await params).id)));
