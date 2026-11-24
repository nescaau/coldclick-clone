import { api } from '@/lib/http';
import { bytesResponse, fileResponse } from '@/lib/stream';
import { videoMedia } from '@/lib/services/production-service';

export const dynamic = 'force-dynamic';

/** "⬇ Baixar MP4" — nesta fase a cópia SIMULADA (viral ou clipe de teste), com o nome Nome_12345.mp4. */
export const GET = api<{ id: string }>(async (req, { params }) => {
  const m = videoMedia((await params).id);
  const download = req.nextUrl.searchParams.get('inline') !== '1';
  const range = req.headers.get('range');
  return m.kind === 'file'
    ? fileResponse({ path: m.path, size: m.size, mime: 'video/mp4', name: m.name, download, range })
    : bytesResponse({ bytes: m.bytes, mime: 'video/mp4', name: m.name, download, range });
});
