import { api, json, readPhotoUpload } from '@/lib/http';
import { createAvatarFromPhoto } from '@/lib/services/avatar-service';

export const dynamic = 'force-dynamic';

/** "Enviar minha foto". */
export const POST = api(async (req) => {
  const up = await readPhotoUpload(req);
  return json(createAvatarFromPhoto({ fileName: up.name, bytes: up.bytes }), 201);
});
