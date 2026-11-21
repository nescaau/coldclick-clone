import { api, json } from '@/lib/http';
import { listVideos, uploadVideo } from '@/lib/services/video-service';

export const GET = api(async () => json(listVideos()));

/**
 * Upload de vídeo. O corpo da requisição é o ARQUIVO CRU (não multipart) e é gravado em
 * disco em streaming — assim um MP4 de 500 MB nunca é carregado inteiro na memória.
 *
 *   POST /api/videos?name=meu-video.mp4&duration=12.5
 *   Content-Type: video/mp4
 */
export const POST = api(async (req) => {
  if (!req.body) return json({ error: 'Nenhum arquivo enviado' }, 400);
  const length = Number(req.headers.get('content-length'));
  const duration = Number(req.nextUrl.searchParams.get('duration'));
  const video = await uploadVideo({
    name: req.nextUrl.searchParams.get('name') ?? 'video.mp4',
    body: req.body,
    contentLength: Number.isFinite(length) && length > 0 ? length : null,
    durationSec: Number.isFinite(duration) && duration > 0 ? duration : null,
  });
  return json(video, 201);
});
