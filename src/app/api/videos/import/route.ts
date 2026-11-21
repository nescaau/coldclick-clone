import { api, json, parseBody } from '@/lib/http';
import { importVideoSchema } from '@/lib/schemas';
import { importVideoFromUrl } from '@/lib/services/video-service';

// Download pode demorar para arquivos grandes.
export const maxDuration = 600;

/** Importa um vídeo a partir de um link direto para o arquivo (MP4/MOV/WebM). */
export const POST = api(async (req) => {
  const { url } = await parseBody(req, importVideoSchema);
  return json(await importVideoFromUrl(url), 201);
});
