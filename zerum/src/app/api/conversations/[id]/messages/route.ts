import { api, json, parseBody } from '@/lib/http';
import { SendMessageSchema } from '@/lib/schemas';
import { sendMessage } from '@/lib/services/director-service';

export const dynamic = 'force-dynamic';

/** Pedido ao Diretor: vira um PLANO (requer confirmação) — ou, com "Aprovar tudo automaticamente", já executa. */
export const POST = api<{ id: string }>(async (req, { params }) =>
  json(sendMessage((await params).id, await parseBody(req, SendMessageSchema)), 201),
);
