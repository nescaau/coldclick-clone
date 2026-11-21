/** Leitura do formulário multipart de avatares. A validação de conteúdo fica no avatar-service. */
import { AppError } from './errors';

export interface AvatarForm {
  name: string;
  description: string;
  voice: string;
  removePhotoIds: string[];
  photos: File[];
}

export async function readAvatarForm(req: Request): Promise<AvatarForm> {
  let form: FormData;
  try {
    form = await req.formData();
  } catch {
    throw new AppError(400, 'Formulário inválido');
  }

  let removePhotoIds: string[] = [];
  const rawRemove = form.get('removePhotoIds');
  if (typeof rawRemove === 'string' && rawRemove) {
    try {
      const parsed: unknown = JSON.parse(rawRemove);
      if (Array.isArray(parsed)) removePhotoIds = parsed.filter((v): v is string => typeof v === 'string');
    } catch {
      throw new AppError(400, 'removePhotoIds inválido');
    }
  }

  return {
    name: String(form.get('name') ?? ''),
    description: String(form.get('description') ?? ''),
    voice: String(form.get('voice') ?? ''),
    removePhotoIds,
    photos: form.getAll('photos').filter((f): f is File => typeof f !== 'string' && f.size > 0),
  };
}
