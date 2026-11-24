import { api } from '@/lib/http';
import { fileResponse } from '@/lib/stream';
import { viralMedia } from '@/lib/services/viral-service';

export const dynamic = 'force-dynamic';

/** ▶ Assistir (inline, com Range) e ⬇ Baixar (`?download=1`) do viral guardado neste computador. */
export const GET = api<{ id: string }>(async (req, { params }) => {
  const m = viralMedia((await params).id);
  return fileResponse({ path: m.path, size: m.size, mime: 'video/mp4', name: m.name, download: req.nextUrl.searchParams.get('download') === '1', range: req.headers.get('range') });
});
