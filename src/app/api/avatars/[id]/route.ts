import { readAvatarForm } from '@/lib/avatar-form';
import { api, json } from '@/lib/http';
import { getAvatar, removeAvatar, updateAvatar } from '@/lib/services/avatar-service';

type P = { id: string };

export const GET = api<P>(async (_req, { params }) => json(getAvatar((await params).id)));

/** Edita nome/descrição, adiciona fotos novas (`photos`) e remove existentes (`removePhotoIds`). */
export const PUT = api<P>(async (req, { params }) => {
  const { id } = await params;
  return json(await updateAvatar(id, await readAvatarForm(req)));
});

export const DELETE = api<P>(async (_req, { params }) => {
  removeAvatar((await params).id);
  return json({ ok: true });
});
