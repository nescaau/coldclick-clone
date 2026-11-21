import { api, json } from '@/lib/http';
import { getExtensionOverview, revokeBrowser } from '@/lib/services/extension-service';

/** Revoga o pareamento do navegador. */
export const DELETE = api<{ id: string }>(async (_req, { params }) => {
  revokeBrowser((await params).id);
  return json(getExtensionOverview());
});
