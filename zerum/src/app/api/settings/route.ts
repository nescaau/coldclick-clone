import { api, json, parseBody } from '@/lib/http';
import { SettingsPatchSchema } from '@/lib/schemas';
import { getSettings, patchSettings } from '@/lib/services/settings-service';

export const dynamic = 'force-dynamic';

export const GET = api(async () => json(getSettings()));

export const PATCH = api(async (req) => json(patchSettings(await parseBody(req, SettingsPatchSchema))));
