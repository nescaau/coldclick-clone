import { api, json, parseBody } from '@/lib/http';
import { createJobSchema } from '@/lib/schemas';
import { previewJob } from '@/lib/services/job-service';

/** "Preparar geração": valida o pedido e devolve saídas, estimativa de gerações e contas elegíveis (nada é gravado). */
export const POST = api(async (req) => json(previewJob(await parseBody(req, createJobSchema))));
