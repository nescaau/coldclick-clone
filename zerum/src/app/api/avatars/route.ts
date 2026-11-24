import { api, json, parseBody } from '@/lib/http';
import { AvatarSchema } from '@/lib/schemas';
import { createAvatar, listAllAvatars } from '@/lib/services/avatar-service';

export const dynamic = 'force-dynamic';

export const GET = api(async () => json(listAllAvatars()));

/** "Preencher à mão" / "Salvar sem foto mesmo". */
export const POST = api(async (req) => json(createAvatar(await parseBody(req, AvatarSchema)), 201));
