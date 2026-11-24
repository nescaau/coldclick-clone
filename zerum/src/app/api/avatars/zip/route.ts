import { api } from '@/lib/http';
import { zipResponse } from '@/lib/stream';
import { avatarsZipEntries } from '@/lib/services/avatar-service';

export const dynamic = 'force-dynamic';

/** "⬇ Baixar todos (zip)": foto de cada avatar (arquivo = nome do avatar) + avatares.json. */
export const GET = api(async () => {
  const d = new Date();
  const p = (n: number) => String(n).padStart(2, '0');
  return zipResponse(`zerum-avatares-${d.getFullYear()}${p(d.getMonth() + 1)}${p(d.getDate())}-${p(d.getHours())}${p(d.getMinutes())}.zip`, avatarsZipEntries());
});
