import { api, json } from '@/lib/http';
import { removeVideo } from '@/lib/services/production-service';

export const dynamic = 'force-dynamic';

/** Descartar um vídeo (sai da Produção e de Vídeos). */
export const DELETE = api<{ id: string }>(async (_req, { params }) => {
  removeVideo((await params).id);
  return json({ ok: true });
});
