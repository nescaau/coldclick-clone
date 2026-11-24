import { api, json, parseBody } from '@/lib/http';
import { AnalysisSchema } from '@/lib/schemas';
import { correctAnalysis } from '@/lib/services/viral-service';

export const dynamic = 'force-dynamic';

/** "A leitura errou? Corrigir" → "Confirmar alteração". */
export const PATCH = api<{ id: string }>(async (req, { params }) => json(correctAnalysis((await params).id, await parseBody(req, AnalysisSchema))));
