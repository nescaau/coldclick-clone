import { api } from '@/lib/http';
import { zipResponse } from '@/lib/stream';
import { readyZipEntries } from '@/lib/services/production-service';

export const dynamic = 'force-dynamic';

/** "Baixar todos os prontos (N)". */
export const GET = api<{ id: string }>(async (_req, { params }) => {
  const z = readyZipEntries((await params).id);
  return zipResponse(z.name, z.entries);
});
