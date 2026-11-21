import { api, json } from '@/lib/http';
import { getExtensionOverview } from '@/lib/services/extension-service';

/** Navegadores pareados + código de pareamento ativo (consultado a cada poucos segundos pela tela). */
export const GET = api(async () => json(getExtensionOverview()));
