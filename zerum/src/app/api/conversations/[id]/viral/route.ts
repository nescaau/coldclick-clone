import { api, json, readViralUpload } from '@/lib/http';
import { attachViral } from '@/lib/services/conversation-service';
import { storeViral } from '@/lib/services/viral-service';

export const dynamic = 'force-dynamic';

/** Envia o viral (multipart, campo `file`) e o anexa a esta conversa. Tudo local. */
export const POST = api<{ id: string }>(async (req, { params }) => {
  const { id } = await params;
  const upload = await readViralUpload(req);
  const { viral, reused } = storeViral(upload);
  return json({ viral, reused, conversation: attachViral(id, viral.id) }, 201);
});
