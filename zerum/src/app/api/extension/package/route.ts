import { api } from '@/lib/http';
import { extensionZipEntries } from '@/lib/services/extension-service';
import { zipResponse } from '@/lib/stream';

export const dynamic = 'force-dynamic';

/** "Baixar a extensão": o .zip da extensão do Chrome (zerum/extensao), montado na hora — sem sair do app. */
export const GET = api(async () => {
  const z = extensionZipEntries();
  return zipResponse(z.name, z.entries);
});
