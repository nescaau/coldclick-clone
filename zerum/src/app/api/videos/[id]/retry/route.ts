import { api, json } from '@/lib/http';
import { retryVideoById } from '@/lib/services/production-service';

export const dynamic = 'force-dynamic';

/** "↻ Tentar de novo" num vídeo que falhou (as cenas prontas ficam). */
export const POST = api<{ id: string }>(async (_req, { params }) => json(retryVideoById((await params).id)));
