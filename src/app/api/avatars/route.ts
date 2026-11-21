import { readAvatarForm } from '@/lib/avatar-form';
import { api, json } from '@/lib/http';
import { createAvatar, listAvatars } from '@/lib/services/avatar-service';

export const GET = api(async () => json(listAvatars()));

/** Cria um avatar. Corpo: multipart/form-data com name, description e photos (múltiplos arquivos). */
export const POST = api(async (req) => {
  const form = await readAvatarForm(req);
  return json(await createAvatar(form), 201);
});
