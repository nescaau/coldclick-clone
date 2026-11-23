import { api, json, readViralUpload } from '@/lib/http';
import { listAllVirals, storeViral } from '@/lib/services/viral-service';

export const dynamic = 'force-dynamic';

export const GET = api(async () => json(listAllVirals()));

export const POST = api(async (req) => json(storeViral(await readViralUpload(req)), 201));
