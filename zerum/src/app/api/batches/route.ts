import { api, json, parseBody } from '@/lib/http';
import { ManualBatchSchema } from '@/lib/schemas';
import { createManualBatch } from '@/lib/services/batch-service';
import { listProduction } from '@/lib/services/production-service';

export const dynamic = 'force-dynamic';

/** PRODUÇÃO: lotes (com vídeos e cenas) que ainda não foram aprovados nem descartados. Cada leitura avança a simulação. */
export const GET = api(async () => json(listProduction()));

export const POST = api(async (req) => json(createManualBatch(await parseBody(req, ManualBatchSchema)), 201));
