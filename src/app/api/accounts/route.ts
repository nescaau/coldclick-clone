import { api, json, parseBody } from '@/lib/http';
import { addAccountSchema } from '@/lib/schemas';
import { addAccount, getAccountsOverview } from '@/lib/services/account-service';

export const GET = api(async () => json(getAccountsOverview()));

export const POST = api(async (req) => {
  addAccount(await parseBody(req, addAccountSchema));
  return json(getAccountsOverview(), 201);
});
