import { api, json } from '@/lib/http';
import { listReadyGroups } from '@/lib/services/production-service';

export const dynamic = 'force-dynamic';

/** MEUS VÍDEOS: só os prontos, agrupados por lote (o mais novo primeiro). */
export const GET = api(async () => json(listReadyGroups()));
