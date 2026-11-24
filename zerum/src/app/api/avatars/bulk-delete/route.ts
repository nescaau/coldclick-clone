import { api, json, parseBody } from '@/lib/http';
import { AvatarBulkDeleteSchema } from '@/lib/schemas';
import { removeAvatars } from '@/lib/services/avatar-service';

export const dynamic = 'force-dynamic';

export const POST = api(async (req) => json({ removed: removeAvatars((await parseBody(req, AvatarBulkDeleteSchema)).ids) }));
