import { api, json } from '@/lib/http';
import { AppError, badRequest } from '@/lib/errors';
import { acceptClip, MAX_CLIP_BYTES } from '@/lib/services/real-service';

export const dynamic = 'force-dynamic';

/**
 * O MP4 da cena, baixado do Flow pela extensão e entregue pela página (corpo = os bytes do arquivo).
 * Query: `pumpId` (aba), `orderId` e `mediaRef` (identidade do clipe no Flow). A validação do conteúdo é do serviço.
 */
export const PUT = api<{ videoId: string; idx: string }>(async (req, { params }) => {
  const { videoId, idx } = await params;
  const n = Number(idx);
  if (!Number.isInteger(n) || n < 0 || n > 64) throw badRequest('Cena inválida.');
  const type = (req.headers.get('content-type') ?? '').split(';')[0].trim().toLowerCase();
  if (type !== 'video/mp4' && type !== 'application/octet-stream') throw new AppError(415, 'Envie o clipe como video/mp4.');
  const declared = Number(req.headers.get('content-length') ?? 0);
  if (declared > MAX_CLIP_BYTES) throw new AppError(413, 'O clipe da cena passa do limite.');
  const q = req.nextUrl.searchParams;
  const pumpId = (q.get('pumpId') ?? '').slice(0, 64);
  if (!pumpId) throw badRequest('Falta o pumpId.');
  const bytes = new Uint8Array(await req.arrayBuffer());
  return json(acceptClip({ videoId, idx: n, pumpId, orderId: (q.get('orderId') ?? '').slice(0, 128), mediaRef: q.get('mediaRef') ?? '', bytes }));
});
