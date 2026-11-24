import { api, json, parseBody } from '@/lib/http';
import { AvatarGenerateSchema } from '@/lib/schemas';
import { generateAvatars } from '@/lib/services/avatar-service';

export const dynamic = 'force-dynamic';

/** "✨ Gerar 1 / Gerar 4": cartões sem foto (o rosto gerado pelo Flow é fase futura). */
export const POST = api(async (req) => json(generateAvatars((await parseBody(req, AvatarGenerateSchema)).count), 201));
