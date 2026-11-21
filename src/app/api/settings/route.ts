import { api, json, parseBody } from '@/lib/http';
import { settingsSchema } from '@/lib/schemas';
import { getPublicSettings, updateSettings } from '@/lib/services/settings-service';

export const GET = api(async () => json(getPublicSettings()));

export const PUT = api(async (req) => json(updateSettings(await parseBody(req, settingsSchema))));
