import { z } from 'zod';
import { api, json, parseBody } from '@/lib/http';
import { retryFailed } from '@/lib/services/production-service';

export const dynamic = 'force-dynamic';

/** "↻ Regerar todas as cenas com falha" (`{}`) ou só um vídeo (`{ videoId }`). */
export const POST = api<{ id: string }>(async (req, { params }) => {
  const body = await parseBody(req, z.object({ videoId: z.string().min(1).optional() }));
  return json(retryFailed((await params).id, body.videoId));
});
