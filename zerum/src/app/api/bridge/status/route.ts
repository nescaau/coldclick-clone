import { api, json } from '@/lib/http';
import { getBridgeStatus } from '@/lib/services/bridge-service';

export const dynamic = 'force-dynamic';

/** Estado da ponte (nesta fase: sempre desligada — sem executor). */
export const GET = api(async () => json(await getBridgeStatus()));
