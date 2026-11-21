import { api, json, parseBody } from '@/lib/http';
import { updateAccountSchema } from '@/lib/schemas';
import { getAccountsOverview, removeAccount, updateAccount } from '@/lib/services/account-service';

type P = { id: string };

/** Edita rótulo/créditos, ativa/pausa na rotação ou move na ordem de prioridade. */
export const PATCH = api<P>(async (req, { params }) => {
  updateAccount((await params).id, await parseBody(req, updateAccountSchema));
  return json(getAccountsOverview());
});

export const DELETE = api<P>(async (_req, { params }) => {
  removeAccount((await params).id);
  return json(getAccountsOverview());
});
