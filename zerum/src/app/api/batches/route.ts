import { api, json, parseBody } from '@/lib/http';
import { ManualBatchSchema } from '@/lib/schemas';
import { createManualBatch, listAllBatches } from '@/lib/services/batch-service';

export const dynamic = 'force-dynamic';

export const GET = api(async () => json(listAllBatches()));

export const POST = api(async (req) => json(createManualBatch(await parseBody(req, ManualBatchSchema)), 201));
