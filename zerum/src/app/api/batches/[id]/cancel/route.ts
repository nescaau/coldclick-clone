import { api, json } from '@/lib/http';
import { cancelBatch } from '@/lib/services/batch-service';

export const dynamic = 'force-dynamic';

export const POST = api<{ id: string }>(async (_req, { params }) => json(cancelBatch((await params).id)));
