import { api, json } from '@/lib/http';
import { APP_LOG_REF, listRecentEvents } from '@/lib/repo/events';
import { tickBatches } from '@/lib/services/production-service';

export const dynamic = 'force-dynamic';

/** "DETALHES TÉCNICOS (LOG)": últimas linhas do log geral do app, da mais nova para a mais antiga. */
export const GET = api(async () => {
  tickBatches();
  return json(listRecentEvents('app', APP_LOG_REF, 60));
});
