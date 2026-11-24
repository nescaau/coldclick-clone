import { api, json } from '@/lib/http';
import { resumeBatch } from '@/lib/services/production-service';

export const dynamic = 'force-dynamic';

/** "Continuar de onde parou". */
export const POST = api<{ id: string }>(async (_req, { params }) => json(resumeBatch((await params).id)));
