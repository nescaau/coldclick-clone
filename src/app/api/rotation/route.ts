import { api, json, parseBody } from '@/lib/http';
import { rotationActionSchema } from '@/lib/schemas';
import { advanceCycle, getRotationState, previewRotation } from '@/lib/services/account-service';

export const GET = api(async () => json(getRotationState()));

export const POST = api(async (req) => {
  const body = await parseBody(req, rotationActionSchema);
  return json(body.action === 'advance' ? advanceCycle() : previewRotation(body.kind, body.count));
});
