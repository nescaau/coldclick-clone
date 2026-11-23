import { api, json } from '@/lib/http';

export const dynamic = 'force-dynamic';

export const GET = api(async () => json({ ok: true, app: 'zerum-001-clone' }));
